# Mon the Cones — mobile hardening release record

Date: 2026-10-15. Source: GitHub `rossfernie-arch/Mon-the-cones`; baseline `be5fe7b`; audit `109c60d`.

## Implemented
- 18 original embedded WebP images extracted without recompression to hashed `assets/embedded` files. Main HTML about 170 KB; image content hashes verified.
- Asset cache headers for immutable hashed artwork. Existing standalone Courtney images preserved.
- Leaderboard responses hide other players UUIDs; only an ID supplied by the requester may be echoed back to its matching entry for old-client compatibility. New clients use the `isOwn` flag.
- Conservative server-side plausibility checks, plus idempotent handling of a concurrent unique run-ID race. Old stored scores remain untouched.
- Initial and upgrade D1 migrations now apply sequentially to a fresh DB and preserve historical records in tests. No production schema migrations applied.
- Ordinary cone pickups use a 750ms deferred local save; pause, run completion, unlocks, visibility loss, and pagehide retain immediate save paths.
- Fewer idle menu frames, mobile safe-area horizontal padding, accessible browser zoom and 44px secondary control height.
- Public phone-test Adventure debug enabling from the previous deployment is intentionally not retained; localhost debug remains.
- Worldwide leaderboard displays an explicit unverified-scores note.

## Verification
- 32 Node tests passed, including browser-independent gameplay, worker, migration, privacy, duplicate submission, asset integrity, and plausibility coverage.
- Cloudflare Worker bundle passed `wrangler deploy --dry-run`, D1 binding resolved.
- Real production D1 schema read-only PRAGMA confirms `enemy_hits` and `gull_hits`. No remote DB write or migration performed.
- Cloudflare Pages preview uploaded; main HTML and sampled WebP asset returned HTTP 200 and appropriate MIME/caching.
- Headless Edge with Chrome DevTools Protocol mobile emulation: 375x812, 390x844, 412x915, 844x390. Menu, campaign map, gameplay, pause transitions passed; no runtime exceptions; no horizontal overflow.
- Preview screenshots and QA scripts are stored outside the repository under Desktop/AI-Workshop.
- Existing production HTML was backed up. Pre-release D1 SQL export stored outside the repository under Desktop/AI-Workshop/Backups.

## Honest limitations
- Browser emulation does not replace physical iOS/Android touch, sound, storage and PWA testing.
- Scores remain client-reported; conservative validation and hidden UUIDs reduce obvious abuse but do NOT prove gameplay or prevent modified clients from cheating. Cryptographic install credentials / replay validation need an independently designed future server protocol.
- Removing embedded images reduces HTML parsing and permits separate caching; total first-visit artwork transfer still depends on which images load. Measured frame rates and battery savings on actual phones remain unverified.
- No claim of offline install support is made: there is no new service worker added in this release.

## Deployment and rollback
- Pages project: `mon-the-cones-phone-test`; upload only index.html, `_headers` and assets/ (not source tests, Git or D1 backup).
- Worker: `cloudflare-worker` binding DB `mon-the-cones-scores`; existing production columns already present, so deploy Worker code with no schema operation.
- Preserve `victorSave2` and existing leaderboard queue keys; do not clear browser site data.
- Rollback source: GitHub baseline `be5fe7b` and pre-release Cloudflare Pages deployment; previous Worker code can be rebuilt from baseline. D1 SQL backup is recovery-only, NOT to restore by default.
Pre-release read-only scoreboard count: 151 rows. Prior Cloudflare Worker version: 8ebae2e8-9283-43d4-a3e3-47abdf17e36b. Prior Pages production deployment: cfaa9381-d4fd-4874-8c10-85cd17ea15b2.
