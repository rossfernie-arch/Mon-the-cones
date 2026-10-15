# Mon the Cones - public TikTok launch

Public link: https://mon-the-cones.pages.dev/
Previous player link: https://mon-the-cones-phone-test.pages.dev/ (kept active, not redirected).
Cloudflare Pages project: mon-the-cones, production branch main; direct upload, original source release 16460d1.
Shared leaderboard Worker: https://mon-the-cones-leaderboard.rossfernie.workers.dev/

Verification
- HTTP 200; correct release marker 20261015-mobile-hardening-01.
- All 18 externally hosted game image files returned HTTP 200 with expected MIME and cache headers.
- Leaderboard returned valid entries.
- Mobile Chromium emulation passed 375x812, 390x844, 412x915 and landscape: main -> map -> playing -> paused; 0 JS exceptions.

Important notes
- localStorage/browser save is origin-specific; do not automatically redirect existing players to the new domain.
- Shared scores appear on either site. Browser site data for individual players remains on their original website.
- Real TikTok in-app browser, touch and score-submission acceptance remain to be confirmed with a device.
- Capacity under viral load has not been tested; account usage limits have not been verified.
- Ordinary TikTok comment URLs may not be clickable, use profile link when eligible.
