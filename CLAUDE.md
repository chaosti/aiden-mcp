# aiden-mcp — project map

Unofficial **MCP server for the Fellow Aiden coffee brewer**. Lets Claude push/list/delete/share brew profiles and schedules on the Aiden over Fellow's private API, and apply brewing heuristics personalized for **milk-forward batch brews on a Fellow Ode Gen 2** to design a recipe. TypeScript, runs as a **Cloudflare Worker** (Streamable-HTTP MCP transport + OAuth 2.0). Personalized fork of `ravenintheforrest/aiden-mcp`.

> Read this first, then use the routing table. GitHub remote: `chaosti/aiden-mcp` — commit `TASKS.md` so resume travels.

## Where things live
- **Deploys to Cloudflare Workers** (`npm run deploy`, or the manual `Deploy to Cloudflare Workers` GitHub Action). Pushing to `main` does not deploy. There is no long-running local server; the Worker is the runtime.
- **State:** none persistent. Cloudflare KV (`AIDEN_OAUTH`) holds only short-lived records — auth codes ≤10min, access tokens until the Fellow JWT expires (≤30d), refresh tokens + client regs ≤90d, rate-limit counters 5min. **Only Fellow-issued JWTs are stored, never the Fellow password.**
- **Secrets:** Cloudflare Worker secrets (`npx wrangler secret put …`) — canary account creds + webhook. Local dev vars in `.dev.vars` (untracked). Never in-repo.
- **Auth model:** OAuth 2.0 auth-code + PKCE, or `X-Fellow-Email`/`X-Fellow-Password` headers. Password reaches server once at `/oauth/authorize`, exchanged for a Fellow JWT, then discarded.
- **Profile data** (temperature/ratio priors) is harvested, not folk wisdom — see `data/`.

## Folder map
- `src/index.ts` — Worker entry: HTTP routing, MCP server, tool registration, header auth.
- `src/fellow-api.ts` — calls to Fellow's private API (list/create/update/delete/share, device info).
- `src/auth.ts` — Fellow `/auth/login` → JWT.
- `src/fellow-schemas.ts` — zod contracts for Fellow API responses (drift detection).
- `src/validation.ts` — client-side profile validation before write (clear errors, not 400s).
- `src/brewing-guidelines.ts` — `brewing_guidelines`: personalized heuristics (batch basket default, cone experimental, ratio 1:14–1:16, 94–96°C) + starting recipe.
- `src/grinders.ts` — Fellow Ode Gen 2 grind ranges (batch 8.0–8.2, cone 5.0–5.3). Only supported grinder.
- `src/flash-brew.ts` — `flash_brew`: Japanese iced coffee plan + dose workaround.
- `src/canary.ts` — hourly cron probe of Fellow API for drift; fingerprinted alerts to webhook.
- `src/oauth/` — OAuth flow: `authorize.ts`, `token.ts`, `register.ts` (dynamic client reg), `discovery.ts` (well-known metadata), `cors.ts` (claude.ai origin allowlist), `kv.ts` (KV helpers).
- `src/rate-limit.ts` — KV-backed rate limiting for OAuth endpoints (10 attempts / 5 min).
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
| Fellow API call broke / new endpoint | `src/fellow-api.ts`, `src/auth.ts`, `src/fellow-schemas.ts` | brewing files |
| Profile rejected / validation errors | `src/validation.ts`, `README.md` (schema table) | `oauth/` |
| Brewing heuristics / recipe output | `src/brewing-guidelines.ts`, `src/grinders.ts`, `data/README.md` | `oauth/`, `fellow-api.ts` |
| Flash / iced brew math | `src/flash-brew.ts` | oauth, api |
| OAuth / connector sign-in / rate limits | `src/oauth/*`, `src/rate-limit.ts`, `src/index.ts` (routing) | brewing files |
| API drift alerts | `src/canary.ts`, `src/fellow-schemas.ts`, `wrangler.toml` (cron) | tool files |
| Dataset refresh | `scripts/*.py`, `data/` | `src/` |
| Deploy / KV / domain / cron config | `wrangler.toml`, `.github/workflows/deploy.yml`, `README.md` (self-hosting) | `src/` logic |

## Commands
`npm run dev` (local Worker at :8787) · `npm run deploy` (ship to Cloudflare) · `npm run tail` (live logs) · `npm run types` (regen Worker types) · `npx wrangler secret put <NAME>` (set a secret).

## Files that ARE the memory
`TASKS.md` (current focus). Read it at session start and update it when work lands.
