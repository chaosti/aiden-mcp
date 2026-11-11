# Tasks — aiden-mcp

## Now
- **Verify multi-Aiden (v1.2.0) against real hardware** once the Italy Aiden is linked: rename both brewers in the Fellow app (e.g. "Canada" / "Italy"), run `list_devices`, then a `sync_profiles` dry run, then a real sync of one disposable profile. So far only tested against a fake Fellow API.

## Next
- Confirm the **Brew Talks 145-profile dataset** is fully wired into `brewing_guidelines` temperature priors, not just the older 69-profile Fellow Drops set.
- Set repo variable `WORKER_URL` so the deploy workflow reports the live version.

## Someday
- Revisit brewing heuristics in `brewing_guidelines` as real-world brews disagree with tool output.
