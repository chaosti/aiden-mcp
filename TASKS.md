# Tasks — aiden-mcp

## Now
- **Deploy v0.6.1** (`npm run deploy`) — token-burn + error fixes are committed but NOT yet live.
- **Aiden is at 14/14 custom profile slots.** Every `create_profile` fails until a slot is freed. `p7 Flash Test 1to9 (ok to delete)` is flagged as disposable.
- **8 dead schedules on the device** (`s0`–`s7`) — all have no days set, so none can ever fire. Clear them with `delete_schedule`.

## Next
- **More roaster parsers** for `fetch_coffee_details` — Sey, Heart, Tim Wendelboe pages are untested and may not parse cleanly.
- Confirm the **Brew Talks 145-profile dataset** (latest harvest) is fully wired into `brewing_guidelines` temperature priors, not just the older 69 Fellow Drops set the README still cites.

## Someday
- **Multi-device Aiden support** — currently picks the first device the account returns.
- Revisit brewing heuristics in `brewing_guidelines` as real-world brews disagree with tool output.
- Broaden `fetch_coffee_details` beyond Shopify-shaped product pages.
