# Mon the Cones — deployed release 2026-10-15

Source feature commit: `f55d3ed` on `fix/mon-the-cones-release-hardening`. Baseline before implementation: `be5fe7b`.

## Production
- Game: https://mon-the-cones-phone-test.pages.dev/
- Pages production deployment: `00733e7b` (https://00733e7b.mon-the-cones-phone-test.pages.dev/), branch `phone-test`, Direct Upload.
- Pages prior production deployment: `cfaa9381-d4fd-4874-8c10-85cd17ea15b2`.
- Worker: https://mon-the-cones-leaderboard.rossfernie.workers.dev/
- Worker new version: `850be936-2b64-41b2-bcd7-7361403e2a1a`.
- Worker prior version: `8ebae2e8-9283-43d4-a3e3-47abdf17e36b`.
- Build marker: `20261015-mobile-hardening-01`.

## Post-deploy checks
- 32 Node tests passed; Worker bundled in a successful dry run.
- Production game HTTP 200, HTML 170529 bytes, 18/18 extracted WebP assets HTTP 200 with correct MIME and immutable cache headers.
- Production browser emulation passed iPhone 11 (375x812), iPhone 13 (390x844), Android (412x915), landscape (844x390), with main -> map -> playing -> paused and no JavaScript exceptions or horizontal overflow.
- Worker health reports release marker, leaderboard responds with no other players raw IDs, and D1 score count was **151 before and 151 after**.
- Live database schema was NOT modified. A SQL export of the original D1 database and the prior production HTML are retained on the laptop in `Desktop/AI-Workshop/Backups/` (not included in Git).

## Limits and rollback
- Genuine physical-device touch, audio, persistence and performance need feedback; emulation does not prove all hardware behaviours.
- Score totals are still client-submitted and cannot be considered cheat-proof. Strong ownership/authentication and replay validation are future work.
- To revert, redeploy the prior Pages immutable deployment and roll back Worker to the prior version; do not erase browser local storage or restore D1 by default.