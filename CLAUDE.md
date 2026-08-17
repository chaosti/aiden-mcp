# aiden-mcp — project map

Unofficial **MCP server for the Fellow Aiden coffee brewer**. Lets Claude push/list/delete/share brew profiles on the Aiden over Fellow's private API, scrape coffee details from roaster product pages, and apply Aiden-specific brewing heuristics to design a recipe. TypeScript, runs as a **Cloudflare Worker** (Streamable-HTTP MCP transport + OAuth 2.0). Pairs with the **Fellow_Aiden** MCP connector; vault notes live at `05) maker/aiden-mcp`.

> Auto-loads when Claude opens `~/dev/aiden-mcp`. Read this first, then use the routing table. This repo has a GitHub remote (`ravenintheforrest/aiden-mcp`) — commit `TASKS.md`/`SESSIONS.md` so resume travels.

## Where things live
- **Machine:** 🐧 dev/build on **ravelab**. **Deploys to Cloudflare Workers** (`npx wrangler deploy`) — live at `https://aidenmcp.ravenhoward.org/mcp`. There is no long-running local server; the Worker is the runtime.
- **State:** none persistent. Cloudflare KV (`AIDEN_OAUTH`) holds only short-lived records — auth codes ≤10min, access tokens ≤1hr, client regs ≤90d. **Only Fellow-issued JWTs are stored, never the Fellow password.**
- **Secrets:** Cloudflare Worker secrets (`npx wrangler secret put …`) — canary account creds + webhook. Local dev vars in `.dev.vars` (untracked). Never in-repo.
- **Auth model:** OAuth 2.0 auth-code + PKCE, or `X-Fellow-Email`/`X-Fellow-Password` headers. Password reaches server once at `/oauth/authorize`, exchanged for a Fellow JWT, then discarded.
- **Profile data** (temperature/ratio priors) is harvested, not folk wisdom — see `data/`.

## Folder map
- `src/index.ts` — Worker entry: HTTP routing, MCP server, tool registration, header auth.
- `src/fellow-api.ts` — calls to Fellow's private API (list/create/update/delete/share, device info).
- `src/auth.ts` — Fellow `/auth/login` → JWT.
- `src/fellow-schemas.ts` — zod contracts for Fellow API responses (drift detection).
- `src/validation.ts` — client-side profile validation before write (clear errors, not 400s).
- `src/coffee-fetcher.ts` — `fetch_coffee_details`: scrape Shopify roaster pages → structured coffee data.
- `src/brewing-guidelines.ts` — `brewing_guidelines`: Aiden brewing heuristics + starting recipe.
- `src/grinders.ts` — grind-setting conversions across grinder models.
- `src/flash-brew.ts` — `flash_brew`: Japanese iced coffee plan + dose workaround.
- `src/canary.ts` — hourly cron probe of Fellow API for drift; fingerprinted alerts to webhook.
- `src/oauth/` — OAuth flow: `authorize.ts`, `token.ts`, `register.ts` (dynamic client reg), `discovery.ts` (well-known metadata), `kv.ts` (KV helpers).
- `data/` — profile datasets (`brew-talks-profiles.csv` = primary 145, `fellow-drops-profiles.csv`) + `README.md`.
- `scripts/` — `fetch-brew-talks.py`, `drops-stats.py` — regenerate/analyze the datasets.
- `wrangler.toml` — Worker config: KV binding, hourly cron trigger, custom domain notes.

## Naming / never-commit
- **Never commit:** `.dev.vars`, `.env*` (except `.env.example`), `node_modules/`, `.wrangler/`, `dist/`, `*.log`. No Fellow passwords, JWTs, or KV ids-as-secrets in source.
- Tool logic files are named after the tool they back (`flash-brew.ts` → `flash_brew`).

## Routing table
| Working on… | Read | Skip |
|---|---|---|
| A tool's behavior / MCP registration | `src/index.ts` + the tool's file | `oauth/`, `canary.ts` |
| Fellow API call broke / new endpoint | `src/fellow-api.ts`, `src/auth.ts`, `src/fellow-schemas.ts` | `coffee-fetcher.ts`, brewing files |
| Profile rejected / validation errors | `src/validation.ts`, `README.md` (schema table) | `oauth/`, scraping |
| Roaster page won't parse | `src/coffee-fetcher.ts` | Fellow API, oauth |
| Brewing heuristics / recipe output | `src/brewing-guidelines.ts`, `src/grinders.ts`, `data/README.md` | `oauth/`, `fellow-api.ts` |
| Flash / iced brew math | `src/flash-brew.ts` | oauth, api |
| OAuth / connector sign-in | `src/oauth/*`, `src/index.ts` (routing) | brewing/scraping |
| API drift alerts | `src/canary.ts`, `src/fellow-schemas.ts`, `wrangler.toml` (cron) | tool files |
| Dataset refresh | `scripts/*.py`, `data/` | `src/` |
| Deploy / KV / domain / cron config | `wrangler.toml`, `README.md` (self-hosting) | `src/` logic |

## Commands
`npm run dev` (local Worker at :8787) · `npm run deploy` (ship to Cloudflare) · `npm run tail` (live logs) · `npm run types` (regen Worker types) · `npx wrangler secret put <NAME>` (set a secret).

## Files that ARE the memory
`TASKS.md` (current focus) · `SESSIONS.md` (distilled past chats, if present). Read both at session start; run `end-session` to update + push.
