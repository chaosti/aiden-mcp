/**
 * Fellow Aiden API client.
 *
 * Talks to the same private API the official Fellow iOS app uses.
 * No public docs — endpoints discovered from the iOS app traffic.
 * Could change without notice.
 *
 * Auth model: each MCP request brings its own Fellow email/password
 * via headers, we exchange them for a JWT, use it for one batch of
 * calls, discard. Nothing is stored server-side.
 *
 * Devices: one Fellow account can own several Aidens. Profiles and
 * schedules live per device, so every profile/schedule method takes the
 * device id explicitly — resolve it with resolveDevice() first.
 */

const BASE_URL = "https://l8qtmnc692.execute-api.us-west-2.amazonaws.com/v1";
const USER_AGENT = "Fellow/5 CFNetwork/1568.300.101 Darwin/24.2.0";

export interface FellowProfile {
  id?: string;
  profileType: number;
  title: string;
  ratio: number;
  bloomEnabled: boolean;
  bloomRatio: number;
  bloomDuration: number;
  bloomTemperature: number;
  ssPulsesEnabled: boolean;
  ssPulsesNumber: number;
  ssPulsesInterval: number;
  ssPulseTemperatures: number[];
  batchPulsesEnabled: boolean;
  batchPulsesNumber: number;
  batchPulsesInterval: number;
  batchPulseTemperatures: number[];
}

export interface FellowDevice {
  id: string;
  displayName?: string;
}

/**
 * Profile categories (Fellow doesn't expose this; inferred from id prefix):
 *   - "custom":    p0…p13 — user-created profiles, capped at 14
 *   - "stock":     plocal* — built-in (Light/Medium/Dark/Cold Brew), can't delete
 *   - "shared":    d* — community/Brew Studio profiles others have shared
 */
export type ProfileCategory = "custom" | "stock" | "shared" | "unknown";

export function categorize(profile: FellowProfile): ProfileCategory {
  const id = profile.id ?? "";
  if (/^p\d+$/.test(id)) return "custom";
  if (id.startsWith("plocal")) return "stock";
  if (/^d\d+$/.test(id)) return "shared";
  return "unknown";
}

export const CUSTOM_PROFILE_CAP = 14;

/**
 * The fields that make up a recipe — what create/update accept. Anything
 * else on a read (server-managed fields, unknown additions) is dropped
 * before writing a profile read from one device onto another.
 */
export const WRITABLE_PROFILE_FIELDS = [
  "profileType",
  "title",
  "ratio",
  "bloomEnabled",
  "bloomRatio",
  "bloomDuration",
  "bloomTemperature",
  "ssPulsesEnabled",
  "ssPulsesNumber",
  "ssPulsesInterval",
  "ssPulseTemperatures",
  "batchPulsesEnabled",
  "batchPulsesNumber",
  "batchPulsesInterval",
  "batchPulseTemperatures",
] as const satisfies readonly (keyof FellowProfile)[];

export function writableProfile(p: FellowProfile): Omit<FellowProfile, "id"> {
  const out: Record<string, unknown> = {};
  for (const f of WRITABLE_PROFILE_FIELDS) out[f] = p[f];
  return out as Omit<FellowProfile, "id">;
}

/** Human-readable device label: the name set in the Fellow app, else the id. */
export function deviceLabel(d: FellowDevice): string {
  return d.displayName?.trim() || d.id;
}

/**
 * Bad or missing device selector. Deliberately not a FellowApiError: it's
 * a usage mistake the model should correct, not an auth/API failure.
 */
export class DeviceSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeviceSelectionError";
  }
}

/**
 * Fields Fellow manages server-side; they come back in profile reads and
 * must not be sent in writes. List mirrors 9b/fellow-aiden.
 */
export const SERVER_SIDE_PROFILE_FIELDS = [
  "id",
  "createdAt",
  "deletedAt",
  "lastUsedTime",
  "sharedFrom",
  "isDefaultProfile",
  "instantBrew",
  "folder",
  "duration",
  "lastGBQuantity",
  // Not in 9b/fellow-aiden's list; Fellow's PATCH validation rejects these
  // by name ("property deviceId should not exist", observed live 2026-06)
  "deviceId",
  "synced",
  "updatedAt",
];

/**
 * Encode an id for use as one URL path segment. Ids reach the path from tool
 * input (schedule ids) as well as from Fellow, and an unencoded "../" would be
 * normalized away by URL parsing — redirecting the call to another device's
 * resources and bypassing device targeting.
 */
const seg = encodeURIComponent;

export class FellowApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = "FellowApiError";
  }
}

export class FellowClient {
  private token: string | null = null;
  private devices: FellowDevice[] | null = null;

  constructor(
    private email: string,
    private password: string,
  ) {}

  /**
   * Construct a client from an existing Fellow JWT (no email/password).
   * Used by the OAuth flow: we already authenticated during /oauth/authorize,
   * the JWT is in KV, we hand it back to a fresh client for resource requests.
   */
  static fromJwt(jwt: string): FellowClient {
    const c = new FellowClient("", "");
    c.token = jwt;
    return c;
  }

  getToken(): string | null {
    return this.token;
  }

  private headers(): HeadersInit {
    const h: HeadersInit = {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    };
    if (this.token) h["Authorization"] = `Bearer ${this.token}`;
    return h;
  }

  refreshToken: string | null = null;

  async authenticate(): Promise<void> {
    if (this.token) return; // already authenticated (e.g. via fromJwt)
    const r = await fetch(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ email: this.email, password: this.password }),
    });
    const body = (await r.json()) as {
      accessToken?: string;
      refreshToken?: string;
      message?: string;
      [key: string]: unknown;
    };
    if (!body.accessToken) {
      throw new FellowApiError(
        body.message || "Login failed (check Fellow email/password)",
        r.status,
        body,
      );
    }
    this.token = body.accessToken;
    if (typeof body.refreshToken === "string") this.refreshToken = body.refreshToken;
  }

  /**
   * Exchange a Fellow refresh token for a fresh access token via
   * POST /auth/refresh-token.
   *
   * Contract (discovered empirically): the (possibly expired) access JWT goes
   * in the Authorization header — Fellow validates its signature, not its
   * expiry — and the refresh token goes in the body. Returns the new access
   * JWT. Fellow does not rotate the refresh token, so we carry it forward.
   */
  static async refresh(
    accessJwt: string,
    refreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const r = await fetch(`${BASE_URL}/auth/refresh-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        Authorization: `Bearer ${accessJwt}`,
      },
      body: JSON.stringify({ refreshToken }),
    });
    const body = (await r.json()) as {
      accessToken?: string;
      refreshToken?: string;
      message?: string;
    };
    if (!r.ok || !body.accessToken) {
      throw new FellowApiError(body.message || "Fellow refresh failed", r.status, body);
    }
    return {
      accessToken: body.accessToken,
      refreshToken: typeof body.refreshToken === "string" ? body.refreshToken : refreshToken,
    };
  }

  /**
   * Decode the JWT exp claim (seconds since epoch). Returns null if unparseable.
   */
  static jwtExpiry(jwt: string): number | null {
    try {
      const parts = jwt.split(".");
      if (parts.length < 2) return null;
      // base64url → base64
      const payload = parts[1].replaceAll("-", "+").replaceAll("_", "/");
      const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
      const decoded = JSON.parse(atob(padded)) as { exp?: number };
      return typeof decoded.exp === "number" ? decoded.exp : null;
    } catch {
      return null;
    }
  }

  /** All Aidens on the account. Cached for the life of this client (one MCP request). */
  async listDevices(): Promise<FellowDevice[]> {
    if (this.devices) return this.devices;
    const r = await fetch(`${BASE_URL}/devices?dataType=real`, {
      headers: this.headers(),
    });
    const devices = (await r.json()) as FellowDevice[];
    if (!Array.isArray(devices) || !devices.length) {
      throw new FellowApiError("No Aiden device found on this Fellow account", r.status);
    }
    this.devices = devices;
    return devices;
  }

  /**
   * Pick one Aiden by name (case-insensitive, as set in the Fellow app) or id.
   * With no selector, succeeds only when the account has exactly one Aiden —
   * with several, guessing could brew or overwrite on the wrong machine.
   */
  async resolveDevice(selector?: string): Promise<FellowDevice> {
    const devices = await this.listDevices();
    const known = () => devices.map((d) => `"${deviceLabel(d)}" (id ${d.id})`).join(", ");

    const wanted = selector?.trim();
    if (!wanted) {
      if (devices.length === 1) return devices[0];
      throw new DeviceSelectionError(
        `This account has ${devices.length} Aidens — pass device to choose one: ${known()}.`,
      );
    }

    const byId = devices.find((d) => d.id === wanted);
    if (byId) return byId;
    const byName = devices.filter(
      (d) => d.displayName?.trim().toLowerCase() === wanted.toLowerCase(),
    );
    if (byName.length === 1) return byName[0];
    if (byName.length > 1) {
      throw new DeviceSelectionError(
        `More than one Aiden is named "${wanted}" — pass its id instead, or rename one in the Fellow app: ${known()}.`,
      );
    }
    throw new DeviceSelectionError(`No Aiden matches "${wanted}". Available: ${known()}.`);
  }

  async listProfiles(deviceId: string): Promise<FellowProfile[]> {
    const r = await fetch(`${BASE_URL}/devices/${seg(deviceId)}/profiles`, {
      headers: this.headers(),
    });
    if (!r.ok) {
      throw new FellowApiError(`Failed to list profiles`, r.status, await r.text());
    }
    return (await r.json()) as FellowProfile[];
  }

  async createProfile(deviceId: string, profile: Omit<FellowProfile, "id">): Promise<FellowProfile> {
    const r = await fetch(`${BASE_URL}/devices/${seg(deviceId)}/profiles`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(profile),
    });
    const body = (await r.json()) as FellowProfile & { message?: string; error?: string };
    if (!body.id) {
      // Common case: 14-profile cap
      if (typeof body.message === "string" && body.message.includes("maximum number of profiles")) {
        throw new FellowApiError(
          "Aiden has reached its 14-profile cap. Delete an old profile first using delete_profile.",
          r.status,
          body,
        );
      }
      throw new FellowApiError(body.message || "Failed to create profile", r.status, body);
    }
    return body;
  }

  async updateProfile(
    deviceId: string,
    profileId: string,
    profile: Omit<FellowProfile, "id">,
  ): Promise<FellowProfile> {
    // Fellow's gateway only routes PATCH here — PUT falls through to AWS
    // SigV4 parsing and dies on the Bearer token ("Invalid key=value pair").
    // Server-managed fields picked up from the list response must be
    // stripped or the PATCH is rejected (field list from 9b/fellow-aiden).
    const payload: Record<string, unknown> = { ...profile };
    for (const f of SERVER_SIDE_PROFILE_FIELDS) delete payload[f];
    const r = await fetch(`${BASE_URL}/devices/${seg(deviceId)}/profiles/${seg(profileId)}`, {
      method: "PATCH",
      headers: this.headers(),
      body: JSON.stringify(payload),
    });
    const body = (await r.json()) as FellowProfile & { message?: string };
    if (!r.ok || (!body.id && body.id !== "")) {
      throw new FellowApiError(
        body.message || `Failed to update profile ${profileId}`,
        r.status,
        body,
      );
    }
    return body;
  }

  async deleteProfile(deviceId: string, profileId: string): Promise<void> {
    const r = await fetch(`${BASE_URL}/devices/${seg(deviceId)}/profiles/${seg(profileId)}`, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!r.ok) {
      throw new FellowApiError(
        `Failed to delete profile ${profileId}`,
        r.status,
        await r.text(),
      );
    }
  }

  async shareProfile(deviceId: string, profileId: string): Promise<string> {
    const r = await fetch(`${BASE_URL}/devices/${seg(deviceId)}/profiles/${seg(profileId)}/share`, {
      method: "POST",
      headers: this.headers(),
    });
    const body = (await r.json()) as { link?: string; message?: string };
    if (!body.link) {
      throw new FellowApiError(body.message || "Failed to generate brew.link", r.status, body);
    }
    return body.link;
  }

  /**
   * Find a profile by id OR title (case-sensitive). Returns null if not found.
   */
  async findProfile(deviceId: string, idOrTitle: string): Promise<FellowProfile | null> {
    const profiles = await this.listProfiles(deviceId);
    return profiles.find((p) => p.id === idOrTitle || p.title === idOrTitle) ?? null;
  }

  // ============================================================
  // Schedules — recurring brews triggered by the device
  // ============================================================

  async listSchedules(deviceId: string): Promise<FellowSchedule[]> {
    const r = await fetch(`${BASE_URL}/devices/${seg(deviceId)}/schedules`, { headers: this.headers() });
    if (!r.ok) {
      throw new FellowApiError("Failed to list schedules", r.status, await r.text());
    }
    return (await r.json()) as FellowSchedule[];
  }

  async createSchedule(
    deviceId: string,
    schedule: Omit<FellowSchedule, "id">,
  ): Promise<FellowSchedule> {
    const r = await fetch(`${BASE_URL}/devices/${seg(deviceId)}/schedules`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(schedule),
    });
    const body = (await r.json()) as FellowSchedule & { message?: string };
    if (!r.ok || !body.id) {
      throw new FellowApiError(body.message || "Failed to create schedule", r.status, body);
    }
    return body;
  }

  async deleteSchedule(deviceId: string, scheduleId: string): Promise<void> {
    const r = await fetch(`${BASE_URL}/devices/${seg(deviceId)}/schedules/${seg(scheduleId)}`, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!r.ok) {
      throw new FellowApiError(
        `Failed to delete schedule ${scheduleId}`,
        r.status,
        await r.text(),
      );
    }
  }

  async toggleSchedule(deviceId: string, scheduleId: string, enabled: boolean): Promise<void> {
    const r = await fetch(`${BASE_URL}/devices/${seg(deviceId)}/schedules/${seg(scheduleId)}`, {
      method: "PATCH",
      headers: this.headers(),
      body: JSON.stringify({ enabled }),
    });
    if (!r.ok) {
      throw new FellowApiError(
        `Failed to toggle schedule ${scheduleId}`,
        r.status,
        await r.text(),
      );
    }
  }
}

export interface FellowSchedule {
  id?: string;
  /** 7 booleans, Sunday through Saturday */
  days: boolean[];
  /** seconds since midnight in the device's local time, 0–86399 */
  secondFromStartOfTheDay: number;
  enabled: boolean;
  /** brew volume in milliliters, 150–1500 */
  amountOfWater: number;
  /** profile id, must match /^(p|plocal)\d+$/ */
  profileId: string;
}
