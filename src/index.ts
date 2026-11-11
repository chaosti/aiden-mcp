/**
 * aiden-mcp — Cloudflare Worker hosting an MCP server for the Fellow Aiden coffee brewer.
 *
 * Unofficial — not affiliated with or endorsed by Fellow Industries.
 * Uses the same private API the Fellow iOS app uses; could break without notice.
 *
 * Architecture:
 *   - Streamable HTTP MCP transport at /mcp
 *   - OAuth 2.0 (auth code + PKCE, RFC 6749 + 7636) at /oauth/*
 *   - Discovery metadata at /.well-known/* (RFC 9728 + 8414)
 *   - Per-user Fellow auth: user signs in once, JWT refreshed via Fellow refresh token
 *   - Stateless beyond short-lived KV records (codes ≤10min, access tokens track Fellow JWT exp, refresh ≤90d)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

import { clientFromHeaders, NoCredentialsError, ExpiredTokenError } from "./auth.js";
import { profileInputSchema, checkPulseConsistency, boolish } from "./validation.js";
import {
  FellowApiError,
  FellowClient,
  FellowDevice,
  FellowProfile,
  categorize,
  deviceLabel,
  writableProfile,
  WRITABLE_PROFILE_FIELDS,
  CUSTOM_PROFILE_CAP,
} from "./fellow-api.js";
import { diffProfileEcho } from "./fellow-schemas.js";
import { brewingGuidelines } from "./brewing-guidelines.js";
import { flashBrewPlan } from "./flash-brew.js";
import { SUPPORTED_GRINDERS } from "./grinders.js";
import { runCanary } from "./canary.js";
import {
  protectedResourceMetadata,
  authorizationServerMetadata,
} from "./oauth/discovery.js";
import { handleRegister } from "./oauth/register.js";
import { handleAuthorizeGet, handleAuthorizePost } from "./oauth/authorize.js";
import { handleToken } from "./oauth/token.js";
import { Env } from "./oauth/kv.js";
import { handleCorsPreflightRequest, addCorsHeaders } from "./oauth/cors.js";

const VERSION = "2.0.0";

/** Recipe fields (everything but the title) that differ, as "field target → source". */
function settingsDiff(source: FellowProfile, target: FellowProfile): string[] {
  const show = (v: unknown) => (Array.isArray(v) ? v.join("/") : String(v));
  return WRITABLE_PROFILE_FIELDS.filter((f) => f !== "title")
    .filter((f) => JSON.stringify(source[f]) !== JSON.stringify(target[f]))
    .map((f) => `${f} ${show(target[f])} → ${show(source[f])}`);
}

/**
 * @param seed  Client already built by the /mcp pre-flight auth check. Reusing
 *              it means one Fellow /auth/login (or one KV read) per request
 *              instead of two, and lets the device-id cache inside the client
 *              survive across the calls a single tool makes.
 */
function makeServer(headers: Headers, env: Env, seed: FellowClient | null = null): McpServer {
  const server = new McpServer({
    name: "aiden-mcp",
    version: VERSION,
  });

  // One authenticated client per request, created on first use. Tools must
  // call this rather than clientFromHeaders directly.
  let clientPromise: Promise<FellowClient> | null = seed ? Promise.resolve(seed) : null;
  const getClient = (): Promise<FellowClient> =>
    (clientPromise ??= clientFromHeaders(headers, env));

  // Which Aiden a tool acts on. Changes must name one whenever the account
  // has more than one (resolveDevice errors otherwise); reads cover them all.
  const deviceParam = z
    .string()
    .min(1)
    .optional()
    .describe(
      "Which Aiden to act on: its name from the Fellow app (case-insensitive, e.g. 'Italy') or its id. Required when the account has more than one Aiden — call list_devices to see them.",
    );
  const readDeviceParam = z
    .string()
    .min(1)
    .optional()
    .describe(
      "Which Aiden to show: its name from the Fellow app (case-insensitive, e.g. 'Italy') or its id. Omit to show every Aiden on the account.",
    );

  /** Devices a read-only tool covers: the one asked for, else all of them. */
  const devicesFor = async (client: FellowClient, device?: string): Promise<FellowDevice[]> =>
    device ? [await client.resolveDevice(device)] : client.listDevices();

  const deviceSummary = async (client: FellowClient, d: FellowDevice): Promise<string> => {
    const profiles = await client.listProfiles(d.id);
    const customCount = profiles.filter((p) => categorize(p) === "custom").length;
    return (
      `Device: ${deviceLabel(d)}\n` +
      `ID: ${d.id}\n` +
      `Custom profile slots: ${customCount}/${CUSTOM_PROFILE_CAP}\n` +
      `Total profiles visible (incl. stock + shared): ${profiles.length}`
    );
  };

  // ============================================================
  // list_devices
  // ============================================================
  server.tool(
    "list_devices",
    "List every Aiden on the Fellow account with its name, id and custom-slot usage. Pass a name (or id) from here as `device` to target one brewer in the other tools.",
    {},
    async () => {
      const client = await getClient();
      const devices = await client.listDevices();
      const blocks = await Promise.all(devices.map((d) => deviceSummary(client, d)));
      let text = `${devices.length} Aiden${devices.length === 1 ? "" : "s"} on this account:\n\n` + blocks.join("\n\n");

      const names = devices.map((d) => d.displayName?.trim().toLowerCase()).filter(Boolean);
      if (new Set(names).size < names.length) {
        text +=
          "\n\n⚠ Two or more Aidens share a name, so they can only be targeted by id. " +
          "Suggest the user rename them in the Fellow app (e.g. 'Canada' and 'Italy').";
      }
      return { content: [{ type: "text", text }] };
    },
  );

  // ============================================================
  // list_profiles
  // ============================================================
  server.tool(
    "list_profiles",
    "List all brew profiles on your Fellow Aiden, grouped by category (custom, stock, shared). The 14-profile cap applies only to user-created custom profiles, per Aiden. Profile ids are per-Aiden: the same recipe has a different id on each brewer. Shows every Aiden unless `device` is given.",
    { device: readDeviceParam },
    async ({ device }) => {
      const client = await getClient();
      const devices = await devicesFor(client, device);
      const blocks = await Promise.all(devices.map(async (d) => {
        const profiles = await client.listProfiles(d.id);

        const grouped = { custom: [], stock: [], shared: [], unknown: [] } as Record<
          ReturnType<typeof categorize>,
          typeof profiles
        >;
        for (const p of profiles) grouped[categorize(p)].push(p);

        // Stock and shared profiles can have null/missing fields, so be defensive.
        const fmt = (p: (typeof profiles)[number]) => {
          const id = p.id ?? "(no id)";
          const title = p.title ?? "(untitled)";
          const ratioPart = p.ratio != null ? `1:${p.ratio} ratio` : "";
          const bloomPart = p.bloomTemperature != null ? `${p.bloomTemperature}°C bloom` : "";
          const ss = Array.isArray(p.ssPulseTemperatures) ? p.ssPulseTemperatures : [];
          const ssPart = ss.length ? `SS ${ss.join("/")}°C` : "";
          const details = [ratioPart, bloomPart, ssPart].filter(Boolean).join(", ");
          return details ? `  ${id}  ${title}  —  ${details}` : `  ${id}  ${title}`;
        };

        const lines: string[] = [
          `Aiden: ${deviceLabel(d)}`,
          `Custom slots: ${grouped.custom.length}/${CUSTOM_PROFILE_CAP} used`,
          "",
          `Custom profiles (${grouped.custom.length}):`,
          ...grouped.custom.map(fmt),
        ];
        if (grouped.stock.length) {
          lines.push("", `Stock profiles (${grouped.stock.length}, can't delete):`, ...grouped.stock.map(fmt));
        }
        if (grouped.shared.length) {
          lines.push("", `Shared/community profiles (${grouped.shared.length}):`, ...grouped.shared.map(fmt));
        }
        return lines.join("\n");
      }));

      return {
        content: [{ type: "text", text: blocks.join("\n\n") }],
      };
    },
  );

  // ============================================================
  // create_profile
  // ============================================================
  server.tool(
    "create_profile",
    "Create a new brew profile on your Aiden and return a brew.link URL. The profile will appear in the Fellow iOS app immediately. If the device is at its 14-profile cap, you'll get an error — call delete_profile first to free a slot. With more than one Aiden on the account, `device` is required. To copy profiles between Aidens, use sync_profiles instead.",
    { ...profileInputSchema.shape, device: deviceParam },
    async ({ device, ...input }) => {
      const parsed = profileInputSchema.parse(input);
      const consistencyErrors = checkPulseConsistency(parsed);
      if (consistencyErrors.length) {
        return {
          isError: true,
          content: [
            { type: "text", text: `Profile validation failed:\n  ${consistencyErrors.join("\n  ")}` },
          ],
        };
      }

      const client = await getClient();
      const target = await client.resolveDevice(device);
      let created;
      try {
        created = await client.createProfile(target.id, parsed);
      } catch (err) {
        // The 14-slot cap is the single most common create failure. A bare
        // "you're full" costs the caller a whole design cycle to recover
        // from, so name the profiles worth deleting instead — least recently
        // used first, which is the choice the user would make anyway.
        if (err instanceof FellowApiError && /maximum number of profiles|14-profile cap/i.test(err.message)) {
          const candidates = (await client.listProfiles(target.id))
            .filter((p) => categorize(p) === "custom")
            .map((p) => p as typeof p & { lastUsedTime?: number | null })
            .sort((a, b) => (a.lastUsedTime ?? 0) - (b.lastUsedTime ?? 0))
            .slice(0, 5)
            .map((p) => {
              const used = p.lastUsedTime
                ? `last brewed ${new Date(p.lastUsedTime * 1000).toISOString().slice(0, 10)}`
                : "never brewed";
              return `  ${p.id}  ${p.title}  (${used})`;
            });
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  `${deviceLabel(target)} is at its ${CUSTOM_PROFILE_CAP}-profile cap, so "${parsed.title}" was not created.\n` +
                  `Free a slot with delete_profile, then retry this exact create_profile call.\n\n` +
                  `Least-recently-used custom profiles (safest to delete first):\n` +
                  candidates.join("\n") +
                  `\n\nAsk the user which to delete — do not delete one on your own.`,
              },
            ],
          };
        }
        throw err;
      }

      // Verify Fellow saved what we sent. The API is undocumented — if a
      // field gets renamed/dropped server-side, the create still returns an
      // id and would otherwise look like a success while brewing with wrong
      // parameters. Surface any mismatch loudly.
      const drift = diffProfileEcho(parsed, created as unknown as Record<string, unknown>);

      const link = await client.shareProfile(target.id, created.id!);

      let text =
        `Created profile "${created.title}" on ${deviceLabel(target)} (id: ${created.id}).\n` +
        `The profile is now on that Aiden — walk over and brew it directly, no extra step needed.\n\n` +
        `brew.link (optional, for sharing or QR-scanning at the device): ${link}`;
      if (drift.length) {
        text +=
          `\n\n⚠ IMPORTANT — Fellow saved different values than were sent (possible API change). ` +
          `Tell the user to verify the profile in the Fellow app before brewing:\n` +
          drift.map((d) => `  - ${d}`).join("\n");
      }

      return {
        content: [{ type: "text", text }],
      };
    },
  );

  // ============================================================
  // update_profile — dial in an existing recipe in place
  // ============================================================
  server.tool(
    "update_profile",
    "Update an existing brew profile on your Aiden in place. Pass the profile id (or exact title) plus ANY subset of the profile fields you want to change — unspecified fields keep their current values. Useful for dialing in an existing recipe (e.g. nudge ratio, drop a temperature) without delete-and-recreate. The brew.link URL stays the same since the profile id doesn't change. With more than one Aiden on the account, `device` is required; this changes the profile on that Aiden only (use sync_profiles to copy the change to the other).",
    {
      device: deviceParam,
      idOrTitle: z
        .string()
        .min(1)
        .describe("Profile id (e.g. 'p1') or exact case-sensitive title (e.g. 'Mpemba v3')"),
      title: z.string().min(1).max(50).optional().describe("New title (optional)"),
      ratio: z.coerce.number().min(8).max(20).optional(),
      bloomEnabled: boolish.optional(),
      bloomRatio: z.coerce.number().min(1).max(3).optional(),
      bloomDuration: z.coerce.number().int().min(1).max(120).optional(),
      bloomTemperature: z.coerce.number().min(50).max(99).optional(),
      ssPulsesEnabled: boolish.optional(),
      ssPulsesNumber: z.coerce.number().int().min(1).max(10).optional(),
      ssPulsesInterval: z.coerce.number().int().min(5).max(60).optional(),
      ssPulseTemperatures: z
        .preprocess((v) => (typeof v === "string" ? JSON.parse(v) : v), z.array(z.coerce.number().min(50).max(99)))
        .optional(),
      batchPulsesEnabled: boolish.optional(),
      batchPulsesNumber: z.coerce.number().int().min(1).max(10).optional(),
      batchPulsesInterval: z.coerce.number().int().min(5).max(60).optional(),
      batchPulseTemperatures: z
        .preprocess((v) => (typeof v === "string" ? JSON.parse(v) : v), z.array(z.coerce.number().min(50).max(99)))
        .optional(),
    },
    async (input) => {
      const { device, idOrTitle, ...changes } = input;
      const client = await getClient();
      const target = await client.resolveDevice(device);
      const existing = await client.findProfile(target.id, idOrTitle);
      if (!existing) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `No profile matched "${idOrTitle}" on ${deviceLabel(target)}. Run list_profiles first — note that titles are case-sensitive and ids differ per Aiden.`,
            },
          ],
        };
      }
      // Merge changes with the existing profile so unspecified fields keep their values
      const merged = { ...existing, ...changes };
      // Drop the id from the body — it's in the URL path
      const { id, ...body } = merged;

      // Sanity: keep pulse counts and temperature arrays consistent
      const consistencyErrors = checkPulseConsistency({
        ...body,
        // zod parsed the optional fields, so set defaults the validator expects
        bloomEnabled: body.bloomEnabled ?? true,
        ssPulsesEnabled: body.ssPulsesEnabled ?? true,
        batchPulsesEnabled: body.batchPulsesEnabled ?? true,
        profileType: body.profileType ?? 0,
      } as never);
      if (consistencyErrors.length) {
        return {
          isError: true,
          content: [
            { type: "text", text: `Update would create inconsistent profile:\n  ${consistencyErrors.join("\n  ")}` },
          ],
        };
      }

      const updated = await client.updateProfile(
        target.id,
        existing.id!,
        body as Omit<typeof existing, "id">,
      );
      // Same echo verification as create_profile — catch the API silently
      // ignoring fields rather than reporting a clean update.
      const drift = diffProfileEcho(
        body as Record<string, unknown>,
        updated as unknown as Record<string, unknown>,
      );
      const changedFields = Object.keys(changes);
      let text =
        `Updated "${updated.title}" on ${deviceLabel(target)} (id: ${existing.id}).\n` +
        `Changed: ${changedFields.length ? changedFields.join(", ") : "(no field changes — title only)"}\n` +
        `Profile id unchanged, so existing brew.link still works.`;
      if (drift.length) {
        text +=
          `\n\n⚠ IMPORTANT — Fellow saved different values than were sent (possible API change). ` +
          `Tell the user to verify the profile in the Fellow app before brewing:\n` +
          drift.map((d) => `  - ${d}`).join("\n");
      }
      return {
        content: [{ type: "text", text }],
      };
    },
  );

  // ============================================================
  // delete_profile
  // ============================================================
  server.tool(
    "delete_profile",
    "Delete a brew profile from your Aiden. Pass either the profile id (e.g. 'p10') or the exact title (e.g. 'Mpemba v2'). Use list_profiles first if you don't know the id. With more than one Aiden on the account, `device` is required; only that Aiden's copy is deleted.",
    {
      device: deviceParam,
      idOrTitle: z
        .string()
        .min(1)
        .describe("Either the profile id (e.g. 'p10') or the exact case-sensitive title"),
    },
    async ({ device, idOrTitle }) => {
      const client = await getClient();
      const target = await client.resolveDevice(device);
      const profile = await client.findProfile(target.id, idOrTitle);
      if (!profile) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `No profile matched "${idOrTitle}" on ${deviceLabel(target)}. Run list_profiles to see what's available — note that titles are case-sensitive and ids differ per Aiden.`,
            },
          ],
        };
      }
      await client.deleteProfile(target.id, profile.id!);
      return {
        content: [
          { type: "text", text: `Deleted profile "${profile.title}" from ${deviceLabel(target)} (id: ${profile.id}).` },
        ],
      };
    },
  );

  // ============================================================
  // share_profile
  // ============================================================
  server.tool(
    "share_profile",
    "Generate a brew.link URL for an existing profile on your Aiden. Use this to re-share a profile you already have. (create_profile already returns a brew.link, so you only need this for profiles created via the Fellow app or another tool.) With more than one Aiden on the account, `device` is required.",
    {
      device: deviceParam,
      idOrTitle: z
        .string()
        .min(1)
        .describe("Profile id (e.g. 'p10') or exact case-sensitive title"),
    },
    async ({ device, idOrTitle }) => {
      const client = await getClient();
      const target = await client.resolveDevice(device);
      const profile = await client.findProfile(target.id, idOrTitle);
      if (!profile) {
        return {
          isError: true,
          content: [
            { type: "text", text: `No profile matched "${idOrTitle}" on ${deviceLabel(target)}. Run list_profiles first.` },
          ],
        };
      }
      const link = await client.shareProfile(target.id, profile.id!);
      return {
        content: [{ type: "text", text: `brew.link for "${profile.title}": ${link}` }],
      };
    },
  );

  // ============================================================
  // brewing_guidelines — encoded heuristics for designing profiles
  // ============================================================
  server.tool(
    "brewing_guidelines",
    "Get Aiden-specific brewing guidelines tailored to a coffee's characteristics. Optimized for milk-forward batch brewing with Fellow Ode Gen 2 (stock burrs). Returns brewing principles + a starting-point recipe. Use this when user provides coffee details (typically from photos of coffee bags). IMPORTANT: if the user already has a profile made for this exact coffee (Fellow Drops or a roaster-shared profile), do NOT redesign it from these principles — it was dialed by people who tasted this coffee. Adjust it one variable at a time (1–2°C max) toward what the user disliked. Does NOT require Aiden auth.",
    {
      process: z.string().optional().describe("Process: washed, natural, honey, anaerobic, etc."),
      roast: z
        .string()
        .optional()
        .describe(
          "Roast level from the bag: light, medium-light, medium, medium-dark, dark. The strongest temperature driver in expert profiles — ASK the user if not stated.",
        ),
      varieties: z.array(z.string()).optional().describe("Varietal names, e.g. ['Bourbon', 'SL28']"),
      elevation: z.string().optional().describe("Elevation, e.g. '1,800–2,000 masl' or '1750m'"),
      tasting_notes: z.array(z.string()).optional().describe("Notes on the bag, e.g. ['fig', 'strawberry', 'honey']"),
      user_preference_ratio: z
        .number()
        .optional()
        .describe("User's typical ratio (e.g. 15 for 1:15). Defaults to 1:15 washed, 1:16 natural."),
      grinder: z
        .string()
        .default("Fellow Ode Gen 2 (stock burrs)")
        .optional()
        .describe(
          `User's grinder (fixed to Fellow Ode Gen 2 with stock 64mm flat burrs for this setup).`,
        ),
      brew_basket: z
        .string()
        .optional()
        .describe(
          "Only for modded brew chambers: 'v60', 'orea', or 'kalita' if the user has swapped the stock flat-bottom basket for a dripper via an adapter. Omit for a stock Aiden. Adjusts grind and pulse pacing for the different drawdown geometry.",
        ),
    },
    async (input) => {
      const guidelines = brewingGuidelines(input);
      const lines = [
        guidelines.summary,
        "",
        "Principles:",
        ...guidelines.principles.map((p, i) => `  ${i + 1}. ${p}`),
        "",
        "Starting-point recipe (BATCH BASKET - adjust based on principles above):",
        `  Ratio:   ${guidelines.starting_recipe.ratio}`,
        `  Bloom:   ${guidelines.starting_recipe.bloom}`,
        `  Batch:   ${guidelines.starting_recipe.batch_pulses}`,
        `  Grind:   ${guidelines.starting_recipe.grind_setting}`,
      ];
      if (guidelines.warnings.length) {
        lines.push("", "Warnings:", ...guidelines.warnings.map((w) => `  ⚠ ${w}`));
      }
      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    },
  );

  // ============================================================
  // flash_brew — Japanese iced coffee calculator
  // ============================================================
  server.tool(
    "flash_brew",
    "Plan a flash brew (Japanese iced coffee) on the Aiden: a hot, concentrated brew directly onto ice in the carafe. The default plan is honest: it sets the profile ratio to the true 1:9-1:12 hot-concentrate ratio (Fellow's API accepts ratios below the app's 1:14 minimum), so the machine's displayed dose and bloom sizing are simply correct. Returns the ice/water split, profile ratio to set, dose, grind adjustment, and technique steps. Pass machine_profile_ratio ONLY to brew with an existing 1:14+ profile unchanged — that returns the classic dose-misreport workaround instead. Pure math, no Aiden auth. Use brewing_guidelines first for the coffee's profile temps.",
    {
      dose_g: z.coerce.number().min(10).max(120).optional().describe("Coffee the user wants to use, in grams. Provide this OR target_volume_ml."),
      target_volume_ml: z.coerce.number().min(150).max(2000).optional().describe("Final drink size in ml (ice melt included). Used to derive the dose if dose_g not given."),
      total_ratio: z.coerce.number().min(10).max(20).optional().describe("True ratio including ice melt. Default 15 (Counter Culture uses 17, Lance Hedrick 12 — lower = stronger)."),
      ice_fraction: z.coerce.number().min(0.1).max(0.5).optional().describe("Share of total liquid that is ice in the carafe. Default 0.3; published recipes use 0.25-0.33."),
      machine_profile_ratio: z.coerce.number().min(8).max(20).optional().describe("Only set this to brew with an existing profile whose ratio stays as-is — the plan becomes the dose-misreport workaround for that ratio. Omit it (default) for the honest plan, where the profile ratio is set to the true hot-concentrate ratio."),
      grinder: z.string().optional().describe("User's grinder, to convert the flash-brew grind setting to their dial."),
    },
    async (input) => {
      const plan = flashBrewPlan(input);
      const lines = [...plan.lines];
      if (plan.warnings.length) {
        lines.push("", "Warnings:", ...plan.warnings.map((w) => `  ⚠ ${w}`));
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  // ============================================================
  // list_schedules
  // ============================================================
  server.tool(
    "list_schedules",
    "List all scheduled brews on your Aiden. Each schedule has a recurrence pattern (which days of the week), a time of day in that Aiden's local time, a profile to brew, and a water amount. Schedules can be enabled/disabled individually. Shows every Aiden unless `device` is given.",
    {
      device: readDeviceParam,
      include_raw: boolish
        .default(false)
        .describe(
          "Include the raw schedule JSON from Fellow. Off by default because it is very large (it embeds a full copy of each schedule's profile). Turn on only when diagnosing non-standard fields.",
        ),
    },
    async ({ device, include_raw }) => {
      const client = await getClient();
      const devices = await devicesFor(client, device);
      const blocks = await Promise.all(devices.map(async (d) => {
        const schedules = (await client.listSchedules(d.id)) as unknown as Array<Record<string, unknown>>;
        if (!schedules.length) {
          return `No scheduled brews on ${deviceLabel(d)}.`;
        }
        const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const fmt = (s: Record<string, unknown>) => {
          const days = (s.days as boolean[] | undefined)
            ?.map((on, i) => (on ? dayNames[i] : null))
            .filter(Boolean)
            .join(",");
          const sec = (s.secondFromStartOfTheDay as number | undefined) ?? 0;
          const hh = Math.floor(sec / 3600);
          const mm = Math.floor((sec % 3600) / 60);
          const time = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
          const status = s.enabled ? "enabled" : "disabled";
          // A schedule with no days set can never fire — call that out rather
          // than printing a blank column the model has to interpret.
          const when = days || "NEVER FIRES (no days set)";
          return `  ${s.id ?? "(no id)"}  ${when}  ${time}  ${s.amountOfWater}mL  profile:${s.profileId}  [${status}]`;
        };

        const lines = [
          `Schedules on ${deviceLabel(d)} (${schedules.length}, device local time):`,
          ...schedules.map(fmt),
        ];

        const inert = schedules.filter((s) => !(s.days as boolean[] | undefined)?.some(Boolean));
        if (inert.length) {
          lines.push(
            "",
            `Note: ${inert.length} schedule(s) have no days set and can never fire. ` +
              `They occupy the list but do nothing — delete_schedule will clear them.`,
          );
        }

        if (include_raw) {
          // Fellow embeds a full copy of the profile in every schedule, which
          // dwarfs the useful fields and repeats for schedules sharing a
          // profile. Drop it — profile details belong to list_profiles.
          const trimmed = schedules.map(({ profile, ...rest }) => rest);
          lines.push(
            "",
            "Raw JSON (nested `profile` copies stripped — see list_profiles for those):",
            JSON.stringify(trimmed, null, 2),
          );
        }
        return lines.join("\n");
      }));

      return { content: [{ type: "text", text: blocks.join("\n\n") }] };
    },
  );

  // ============================================================
  // create_schedule
  // ============================================================
  server.tool(
    "create_schedule",
    "Create a scheduled brew on your Aiden. The Aiden hardware fires the brew at the specified time on the specified days. Time is in DEVICE LOCAL TIME (the timezone configured on the brewer). The schedule is RECURRING — for a one-time 'today at 2pm' brew, set days[] with only today's day enabled, and either delete the schedule after it fires or use toggle_schedule to disable it. Days array indexes: [Sunday, Monday, Tuesday, Wednesday, Thursday, Friday, Saturday]. Find the profileId by calling list_profiles for the SAME Aiden first — profile ids differ per brewer. With more than one Aiden on the account, `device` is required. Each Aiden keeps its own local time, so the same HH:MM is a different moment on brewers in different time zones.",
    {
      device: deviceParam,
      profileId: z
        .string()
        .regex(/^(p|plocal)\d+$/, "profileId must look like 'p7' or 'plocal2'")
        .describe("Profile id from list_profiles, e.g. 'p1' for Mpemba v3 or 'plocal0' for Light Roast"),
      time: z
        .string()
        .regex(/^([01]?\d|2[0-3]):[0-5]\d$/, "time must be 24-hour HH:MM, e.g. '07:30' or '14:00'")
        .describe("Local time of day in 24-hour HH:MM format, e.g. '07:00' for 7am, '14:00' for 2pm"),
      days: z
        .array(boolish)
        .length(7, "days must have exactly 7 entries [Sun, Mon, Tue, Wed, Thu, Fri, Sat]")
        .refine((d) => d.some(Boolean), {
          message:
            "At least one day must be true — a schedule with no days enabled can never fire.",
        })
        .describe(
          "7 booleans for [Sun, Mon, Tue, Wed, Thu, Fri, Sat]. e.g. [false,true,true,true,true,true,false] = weekdays only.",
        ),
      amountOfWater: z
        .coerce.number()
        .int()
        .min(150, "minimum 150 mL")
        .max(1500, "maximum 1500 mL")
        .describe("Brew volume in milliliters, 150–1500. A standard cup is ~240mL, full carafe is ~1000mL."),
      enabled: boolish.default(true).describe("Whether the schedule starts active. Default: true."),
    },
    async ({ device, profileId, time, days, amountOfWater, enabled }) => {
      const [hh, mm] = time.split(":").map(Number);
      const secondFromStartOfTheDay = hh * 3600 + mm * 60;
      const client = await getClient();
      const target = await client.resolveDevice(device);
      const created = await client.createSchedule(target.id, {
        profileId,
        secondFromStartOfTheDay,
        days,
        amountOfWater,
        enabled,
      });
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const dayList = days.map((on, i) => (on ? dayNames[i] : null)).filter(Boolean).join(",") || "(no days)";
      const onlyOneDay = days.filter(Boolean).length === 1;
      const oneShotNote = onlyOneDay
        ? "\n\n⚠ One-shot caveat: This is a recurring weekly schedule with one day enabled. It will fire again next week on the same day. After it fires today, call delete_schedule or toggle_schedule(enabled=false) to prevent that — or remind the user to do so."
        : "";
      const tzNote =
        `\n\n⚠ Time zone: ${time} is in ${deviceLabel(target)}'s local time, set on the Aiden device itself. ` +
        "Verify the device clock matches the user's wall clock before relying on this for time-critical brews.";
      return {
        content: [
          {
            type: "text",
            text:
              `Scheduled brew created on ${deviceLabel(target)} (id: ${created.id}).\n` +
              `Profile ${profileId} will brew ${amountOfWater}mL at ${time} on ${dayList} (device local time).\n` +
              `${enabled ? "Active" : "Disabled — call toggle_schedule to enable when ready"}.` +
              tzNote +
              oneShotNote,
          },
        ],
      };
    },
  );

  // ============================================================
  // delete_schedule
  // ============================================================
  server.tool(
    "delete_schedule",
    "Delete a scheduled brew by its id. Use list_schedules first to find the id. With more than one Aiden on the account, `device` is required.",
    {
      device: deviceParam,
      scheduleId: z.string().min(1).describe("Schedule id from list_schedules"),
    },
    async ({ device, scheduleId }) => {
      const client = await getClient();
      const target = await client.resolveDevice(device);
      await client.deleteSchedule(target.id, scheduleId);
      return {
        content: [{ type: "text", text: `Deleted schedule ${scheduleId} from ${deviceLabel(target)}.` }],
      };
    },
  );

  // ============================================================
  // toggle_schedule
  // ============================================================
  server.tool(
    "toggle_schedule",
    "Enable or disable an existing scheduled brew without deleting it. Useful for pausing a recurring schedule (e.g. weekday morning brew) during vacation. With more than one Aiden on the account, `device` is required.",
    {
      device: deviceParam,
      scheduleId: z.string().min(1).describe("Schedule id from list_schedules"),
      enabled: boolish.describe("true to activate the schedule, false to pause it"),
    },
    async ({ device, scheduleId, enabled }) => {
      const client = await getClient();
      const target = await client.resolveDevice(device);
      await client.toggleSchedule(target.id, scheduleId, enabled);
      return {
        content: [
          {
            type: "text",
            text: `Schedule ${scheduleId} on ${deviceLabel(target)} ${enabled ? "enabled" : "disabled"}.`,
          },
        ],
      };
    },
  );

  // ============================================================
  // sync_profiles — one-way copy of custom profiles between Aidens
  // ============================================================
  server.tool(
    "sync_profiles",
    "Copy custom brew profiles from one Aiden to another, one way. Profiles are matched by exact title because ids differ per brewer: titles missing on the target are created, titles whose settings differ are overwritten (unless update_existing=false), identical ones are skipped. Never deletes anything — profiles only on the target are left alone and reported. Stock/shared profiles and schedules are not synced. DRY RUN BY DEFAULT: the first call only reports the plan; show it to the user and call again with dry_run=false only after they approve. If the target can't fit every new profile in its 14 slots, nothing is written.",
    {
      from: z.string().min(1).describe("Source Aiden: its name from the Fellow app (e.g. 'Canada') or its id"),
      to: z.string().min(1).describe("Target Aiden: its name from the Fellow app (e.g. 'Italy') or its id"),
      profiles: z
        .preprocess(
          (v) => (typeof v === "string" ? JSON.parse(v) : v),
          z.array(z.string().min(1)).min(1),
        )
        .optional()
        .describe("Exact, case-sensitive titles to sync. Omit to sync every custom profile on the source."),
      dry_run: boolish
        .default(true)
        .describe("Default true: report what would change without writing anything. Set false to apply."),
      update_existing: boolish
        .default(true)
        .describe("Overwrite target profiles that share a title but have different settings. Default true."),
    },
    async ({ from, to, profiles, dry_run, update_existing }) => {
      const client = await getClient();
      // Sequential so the second lookup hits the client's device cache.
      const source = await client.resolveDevice(from);
      const target = await client.resolveDevice(to);
      const src = deviceLabel(source);
      const dst = deviceLabel(target);

      const customOn = async (d: FellowDevice) =>
        (await client.listProfiles(d.id)).filter((p) => categorize(p) === "custom");
      const [srcProfiles, dstProfiles] = await Promise.all([customOn(source), customOn(target)]);
      const byTitle = (ps: FellowProfile[]) => {
        const m = new Map<string, FellowProfile[]>();
        for (const p of ps) m.set(p.title, [...(m.get(p.title) ?? []), p]);
        return m;
      };
      const srcByTitle = byTitle(srcProfiles);
      const dstByTitle = byTitle(dstProfiles);

      const toCreate: FellowProfile[] = [];
      const toUpdate: Array<{ source: FellowProfile; target: FellowProfile; changes: string[] }> = [];
      const identical: string[] = [];
      const skipped: string[] = [];
      const ids = (ps: FellowProfile[]) => ps.map((p) => p.id).join(", ");

      for (const title of profiles ? [...new Set(profiles)] : [...srcByTitle.keys()]) {
        const onSrc = srcByTitle.get(title) ?? [];
        const onDst = dstByTitle.get(title) ?? [];
        if (!onSrc.length) {
          skipped.push(`"${title}" — not a custom profile on ${src} (titles are case-sensitive)`);
        } else if (onSrc.length > 1) {
          skipped.push(`"${title}" — ${onSrc.length} profiles share this title on ${src} (${ids(onSrc)}); rename one`);
        } else if (onDst.length > 1) {
          skipped.push(`"${title}" — ${onDst.length} profiles share this title on ${dst} (${ids(onDst)}); rename or delete one`);
        } else if (!onDst.length) {
          toCreate.push(onSrc[0]);
        } else {
          const changes = settingsDiff(onSrc[0], onDst[0]);
          if (!changes.length) identical.push(title);
          else if (update_existing) toUpdate.push({ source: onSrc[0], target: onDst[0], changes });
          else skipped.push(`"${title}" — differs on ${dst} but update_existing=false (${changes.join("; ")})`);
        }
      }
      // Only meaningful for a full sync; with a title filter the rest of the
      // target simply wasn't asked about.
      const onlyOnTarget = profiles ? [] : [...dstByTitle.keys()].filter((t) => !srcByTitle.has(t));
      const free = CUSTOM_PROFILE_CAP - dstProfiles.length;

      const lines = [
        `Sync ${src} → ${dst}${dry_run ? " — DRY RUN, nothing written" : ""}`,
        `${dst} custom slots: ${dstProfiles.length}/${CUSTOM_PROFILE_CAP} used, ${free} free`,
      ];
      const section = (heading: string, items: string[]) => {
        if (items.length) lines.push("", `${heading} (${items.length}):`, ...items.map((i) => `  ${i}`));
      };
      section(`Create on ${dst}`, toCreate.map((p) => p.title));
      section(
        `Update on ${dst}`,
        toUpdate.map((u) => `${u.source.title} (${dst} ${u.target.id}) — ${u.changes.join("; ")}`),
      );
      section("Already identical", identical);
      section("Skipped", skipped);
      section(`Only on ${dst}, left alone`, onlyOnTarget);
      const done = (isError = false) => ({ isError, content: [{ type: "text" as const, text: lines.join("\n") }] });

      if (!toCreate.length && !toUpdate.length) {
        lines.push("", "Nothing to write.");
        return done();
      }
      // All-or-nothing on capacity: a half-synced target is harder to reason
      // about than one that clearly didn't change.
      if (toCreate.length > free) {
        lines.push(
          "",
          `✗ ${dst} has ${free} free slot${free === 1 ? "" : "s"} but ${toCreate.length} profiles need creating, so nothing ${dry_run ? "would be" : "was"} written.`,
          `  Won't fit: ${toCreate.slice(Math.max(free, 0)).map((p) => p.title).join(", ")}`,
          `  Free slots on ${dst} with delete_profile (ask the user which), or pass a shorter profiles list.`,
        );
        return done(!dry_run);
      }
      if (dry_run) {
        lines.push("", "To apply, call sync_profiles again with dry_run=false — only after the user approves this plan.");
        return done();
      }

      // Sequential: Fellow assigns the slot id on create, so parallel creates could race.
      const results: string[] = [];
      const drifted: string[] = [];
      let failures = 0;
      const attempt = async (label: string, write: () => Promise<FellowProfile>, sent: Omit<FellowProfile, "id">) => {
        try {
          const saved = await write();
          const drift = diffProfileEcho(
            sent as unknown as Record<string, unknown>,
            saved as unknown as Record<string, unknown>,
          );
          if (drift.length) drifted.push(`${label}: ${drift.join("; ")}`);
          results.push(`✓ ${label} (${dst} ${saved.id})`);
        } catch (err) {
          failures++;
          results.push(`✗ ${label}: ${err instanceof Error ? err.message : String(err)}`);
        }
      };
      for (const p of toCreate) {
        const sent = writableProfile(p);
        await attempt(`created "${p.title}"`, () => client.createProfile(target.id, sent), sent);
      }
      for (const u of toUpdate) {
        const sent = writableProfile(u.source);
        await attempt(`updated "${u.source.title}"`, () => client.updateProfile(target.id, u.target.id!, sent), sent);
      }

      lines.push("", `Results (${results.length - failures} ok, ${failures} failed):`, ...results.map((r) => `  ${r}`));
      if (drifted.length) {
        lines.push(
          "",
          `⚠ IMPORTANT — Fellow saved different values than were sent (possible API change). ` +
            `Tell the user to verify these on ${dst} in the Fellow app before brewing:`,
          ...drifted.map((d) => `  - ${d}`),
        );
      }
      return done(failures === results.length);
    },
  );

  // ============================================================
  // get_device_info
  // ============================================================
  server.tool(
    "get_device_info",
    "Get info about your Aiden brewer (name, id, profile count, slot usage). Lightweight call useful for verifying credentials work before doing heavier operations. Shows every Aiden unless `device` is given.",
    { device: readDeviceParam },
    async ({ device }) => {
      const client = await getClient();
      const devices = await devicesFor(client, device);
      const blocks = await Promise.all(devices.map((d) => deviceSummary(client, d)));
      return { content: [{ type: "text", text: blocks.join("\n\n") }] };
    },
  );

  return server;
}

// ============================================================
// Worker entry — route dispatch
// ============================================================
export default {
  /**
   * Cron-triggered API-drift canary (see src/canary.ts and wrangler.toml
   * [triggers]). No-ops unless CANARY_* secrets are configured.
   */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runCanary(env));
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = `${url.protocol}//${url.host}`;
    const pathname = url.pathname;

    try {
      // ---- Discovery (no auth) ----
      if (request.method === "GET" && pathname === "/.well-known/oauth-protected-resource") {
        return protectedResourceMetadata(origin);
      }
      if (request.method === "GET" && pathname === "/.well-known/oauth-authorization-server") {
        return authorizationServerMetadata(origin);
      }

      // ---- OAuth endpoints ----
      // Handle CORS preflight requests
      if (pathname.startsWith("/oauth/")) {
        const preflightResponse = handleCorsPreflightRequest(request);
        if (preflightResponse) {
          return preflightResponse;
        }
      }

      if (request.method === "POST" && pathname === "/oauth/register") {
        return addCorsHeaders(await handleRegister(request, env), request);
      }
      if (request.method === "GET" && pathname === "/oauth/authorize") {
        return addCorsHeaders(await handleAuthorizeGet(url, env), request);
      }
      if (request.method === "POST" && pathname === "/oauth/authorize") {
        return addCorsHeaders(await handleAuthorizePost(request, env), request);
      }
      if (request.method === "POST" && pathname === "/oauth/token") {
        return addCorsHeaders(await handleToken(request, env), request);
      }

      // ---- Health / root ----
      if (request.method === "GET" && (pathname === "/" || pathname === "/health")) {
        return Response.json({
          name: "aiden-mcp",
          version: VERSION,
          description:
            "MCP server for Fellow Aiden brewer. Unofficial — not affiliated with Fellow Industries.",
          transport: "streamable-http",
          mcp_endpoint: "/mcp",
          oauth: {
            metadata: `${origin}/.well-known/oauth-authorization-server`,
            authorize: `${origin}/oauth/authorize`,
            token: `${origin}/oauth/token`,
            register: `${origin}/oauth/register`,
          },
          docs: "https://github.com/chaosti/aiden-mcp",
        });
      }

      // ---- MCP resource endpoint ----
      if (pathname === "/mcp" || pathname === "/sse") {
        // This transport is stateless (sessionIdGenerator: undefined) and answers
        // in plain JSON (enableJsonResponse: true), so it has no standalone SSE
        // stream to hand out. Handing it a GET makes handleRequest hang forever
        // instead of replying: the Workers runtime eventually kills the request,
        // the client reads that as a dropped stream and immediately reconnects,
        // and the retry loop runs ~2 req/s indefinitely. One stuck Node client
        // did that from 2026-08-16 19:00 onward and burned ~165k requests in a
        // day, blowing the 100k/day account limit.
        //
        // The MCP spec says a server that does not offer a stream here MUST
        // answer 405, which is what stops a conforming client from retrying.
        if (request.method !== "POST") {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              error: {
                code: -32000,
                message: "Method Not Allowed: this endpoint accepts POST only (no SSE stream)",
              },
              id: null,
            }),
            {
              status: 405,
              headers: { "Content-Type": "application/json", Allow: "POST" },
            },
          );
        }

        // Tools split by whether they need Fellow credentials.
        // Pure-compute / pure-fetch tools work for anyone — no Fellow account needed.
        const FELLOW_AUTH_TOOLS = new Set([
          "list_profiles",
          "create_profile",
          "update_profile",
          "delete_profile",
          "share_profile",
          "get_device_info",
          "list_devices",
          "sync_profiles",
          "list_schedules",
          "create_schedule",
          "delete_schedule",
          "toggle_schedule",
        ]);

        // Inspect the JSON-RPC method without consuming the body
        let needsAuth = false;
        if (request.method === "POST") {
          try {
            const cloned = request.clone();
            const body = (await cloned.json()) as { method?: string; params?: { name?: string } };
            // tools/list and initialize are public so clients can discover capabilities
            if (body.method === "tools/call" && FELLOW_AUTH_TOOLS.has(body.params?.name ?? "")) {
              needsAuth = true;
            }
          } catch {
            // Couldn't parse — let transport handle the error
          }
        }

        // Reused by makeServer so the request authenticates once, not twice.
        let seededClient: FellowClient | null = null;
        if (needsAuth) {
          try {
            seededClient = await clientFromHeaders(request.headers, env);
          } catch (err) {
            // Both "no credentials" and "expired/invalid token" return HTTP 401
            // with WWW-Authenticate. This is what makes Claude attempt its
            // refresh-token grant (and fall back to re-auth only if that fails).
            // Returning 200 here would suppress refresh entirely.
            if (
              err instanceof ExpiredTokenError ||
              err instanceof NoCredentialsError ||
              (err instanceof FellowApiError && err.status === 401)
            ) {
              const desc = err instanceof Error ? err.message : "unauthorized";
              return new Response(
                JSON.stringify({ error: "invalid_token", error_description: desc }),
                {
                  status: 401,
                  headers: {
                    "Content-Type": "application/json",
                    "WWW-Authenticate": `Bearer realm="aiden-mcp", error="invalid_token", resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
                  },
                },
              );
            }
            throw err;
          }
        }

        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        const server = makeServer(request.headers, env, seededClient);
        await server.connect(transport);
        return await transport.handleRequest(request);
      }

      return new Response("Not Found", { status: 404 });
    } catch (err) {
      if (err instanceof FellowApiError) {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (err.status === 401) {
          // RFC 6750: tell the client where to authenticate
          headers["WWW-Authenticate"] = `Bearer realm="aiden-mcp", resource_metadata="${origin}/.well-known/oauth-protected-resource"`;
        }
        return new Response(JSON.stringify({ error: err.message, status: err.status }), {
          status: err.status ?? 500,
          headers,
        });
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
};
