# Mon the Cones code audit

Date: 2026-10-14
Scope: isolated checkout only; no network access, installs, deployment, pushes, or changes outside this directory.
Runtime changes: none. One dependency-free smoke suite was added at `test/gameplay-performance-smoke.test.mjs`.

## Executive summary

The runner fundamentals are better defended than the original test surface suggested. Source inspection and the new smoke checks found 105 ms of coyote time, 130 ms of jump buffering, a 170 ms variable-height hold, a double jump, consistent first-jump envelopes across the game's 25–60 fps integration range, safe ground entrances/exits in all 13 authored route connectors, and monotonic Adventure difficulty caps.

The highest-impact work is elsewhere:

1. **P0 — Worldwide scores are not trustworthy.** The Worker accepts caller-selected player IDs and essentially caller-asserted results, then publishes player IDs. Anyone able to call the public endpoint can forge top scores or submit as a visible player. Campaign times as low as 1 ms and Adventure values near the very large generic caps are accepted.
2. **P1 — Startup is dominated by a 6,046,140-byte HTML file.** It contains 18 base64 WebP images representing 4,407,268 compressed image bytes. Maximum local compression still produced 4,473,236-byte gzip and 4,442,537-byte Brotli payloads. Several additional PNGs are requested immediately even when their character is locked or unselected.
3. **P1 — The checked-in migration chain fails on a fresh database.** `0001_initial.sql` already creates `enemy_hits` and `gull_hits`; `0002_reliability.sql` adds them again. A dependency-free in-memory SQLite run failed with `duplicate column name: enemy_hits`.
4. **P1 — Main-thread work can undermine mobile feel.** Every ordinary cone pickup synchronously serializes the save to `localStorage`, and the full canvas continues rendering at 12 fps on compact menus / 20 fps on larger menus. Actual jank and battery cost require browser profiling, but the work is source-observed.
5. **P1/P2 — Mobile layout has good height handling but incomplete safe-area/accessibility handling.** The full-screen panels scroll and have short-height/landscape rules, but horizontal notch insets are not used, zoom is disabled, and several secondary controls are only 38–40 px high.

## Prioritized findings and fixes

### P0: leaderboard identity and results can be forged

**Observed in source**

- The browser generates and persists its own UUID (`index.html:91-112`) and sends it with every result.
- The Worker only checks UUID shape and broad integer ceilings (`cloudflare-worker/src/index.js:45-65`). It does not authenticate the player, bind a run to a server-issued challenge, validate a Campaign completion distance, impose a useful minimum duration, or validate a result against the shipped build's reachable envelope.
- Existing tests explicitly accept `score=9,999,999`, `distance=999,999`, `cones=99,999`, a nearly one-day duration, and a 1 ms Adventure run (`cloudflare-worker/test/worker.test.mjs:38`).
- Leaderboard responses expose every top player's UUID (`cloudflare-worker/src/index.js:91-93`). Because POST accepts any well-formed UUID, a caller can reuse a UUID learned from GET.
- CORS allows every origin (`cloudflare-worker/src/index.js:1`), and no rate-limit or abuse control is represented in this checkout.

**Impact**

The queue is reliable transport for honest clients, but it is not a reliable competitive leaderboard. Rankings, identity ownership, and records can all be fabricated. This should be fixed before promoting or rewarding worldwide results.

**Recommended fix**

1. Stop returning raw `playerId`; have the Worker return an `isOwn` field for the requesting credential.
2. Introduce a server-issued opaque install credential and signed run challenge. This prevents direct impersonation, though a fully modified client can still cheat.
3. Enforce per-mode invariants: Campaign distance/build/level consistency, realistic duration floors and ceilings, prize-mask constraints, and Adventure relationships among score, distance, cones, hits, and duration. Version the validation rules by accepted build.
4. Add rate limiting and anomaly quarantine. Do not silently mix suspect records into the public top 50.
5. If strong competitive integrity matters, submit a compact event/replay trace and validate it server-side; client-attested totals alone cannot be cheat-proof.

### P1: startup payload and eager image work are excessive

**Measured without a browser**

| Item | Result |
|---|---:|
| `index.html` raw | 6,046,140 bytes |
| Locally simulated gzip level 9 | 4,473,236 bytes |
| Locally simulated Brotli quality 11 | 4,442,537 bytes |
| Embedded data images | 18 WebPs |
| Decoded embedded *compressed files* | 4,407,268 bytes |
| Additional Courtney PNG files | 2,014,527 bytes |

The five world source records are embedded at `index.html:733-740`. The comment says active worlds are decoded on demand, and `ensureScene` does limit the scene cache to two (`index.html:741-748`), but all source strings still have to be transferred and parsed as part of the initial HTML.

All four character atlases are assigned to `Image.src` immediately (`index.html:811-813`), the separate 493,871-byte Courtney run sheet is assigned immediately (`index.html:814-815`), and the rolling-bin and three rival images are also assigned immediately (`index.html:949`, `index.html:970`). This happens regardless of selected character, unlock state, game mode, or whether those hazards have appeared.

If every assigned startup image is decoded to an RGBA-like surface, the source dimensions imply roughly **49.4 MiB** of pixel surfaces before browser overhead. That figure is an estimate, not an observed browser-memory measurement; browsers may defer, discard, or represent decoded images differently.

**Recommended fix**

- Move executable code to cacheable external JS and move every data URI to a separately cacheable WebP/PNG.
- Make `SCENE_SOURCES` a URL manifest and load only the current scene plus the next likely scene.
- Load only the selected character's atlas. Load the character-grid thumbnails on entering the character screen, and load Courtney's run sheet only when Courtney is selected and play starts.
- Give hashed assets immutable caching. Keep the shell HTML small enough to parse and paint quickly; an initial HTML target below 100 KiB is reasonable.
- Add real mobile measurements for transfer size, first contentful paint, time to interactive/play, image decode time, long tasks, and peak memory. The smoke test's 6.1 MB ceiling is explicitly a no-regression baseline, not an acceptable target.

### P1: sequential database migrations are broken

`cloudflare-worker/migrations/0001_initial.sql:14-15` creates `enemy_hits` and `gull_hits`. `cloudflare-worker/migrations/0002_reliability.sql:3-4` adds the same columns. Running 0001 followed by 0002 in Node 24's in-memory SQLite produced:

```text
duplicate column name: enemy_hits
```

Choose one coherent history:

- If 0001 is the historical production schema, restore it to that state and let 0002 add the v3 columns.
- If 0001 is only a current bootstrap schema, do not place 0002 in a chain that a fresh database will apply after it; document separate bootstrap and production-upgrade paths.

Add a test that creates an empty database and applies every migration in order. Also test upgrading a fixture matching the actual pre-v3 production schema.

### P1: synchronous saving and idle rendering threaten mobile smoothness

**Observed in source**

- Every normal cone pickup calls `persist()`, which synchronously runs `JSON.stringify` and `localStorage.setItem` (`index.html:172`, `index.html:619`). Drops and golden cones also persist (`index.html:619`, `index.html:650-655`).
- `updateHud()` writes multiple DOM properties every simulation tick (`index.html:563`, called from `index.html:620`).
- The animation loop redraws the complete scene at 45 fps on compact devices during play and continues at 12 fps while not playing; larger screens use 60/20 fps (`index.html:998-1000`). Menus therefore keep background canvas, scenery, hero, and image work active.
- Stage 0 platform art includes many per-frame texture `fillRect` operations (`index.html:696-731`).

**Recommended fix**

- Update counters in memory and debounce persistence, while still forcing a save on unlock, pause, visibility loss, run end, and page lifecycle events. A one-second checkpoint is enough to limit loss without an I/O call per pickup.
- Only write HUD values when their displayed value changes.
- Render menus on invalidation (screen transition, image load, resize, animation actually visible) instead of running the full world indefinitely.
- Profile before simplifying art. Browser flame charts and long-task data are needed to determine whether storage, canvas detail, decode, or DOM writes dominate on target phones.

### P1/P2: mobile safe areas, zoom, and compact controls need a pass

**Positive source evidence**

- The canvas and panels use dynamic viewport height (`index.html:2`, `index.html:32`).
- Panels scroll and use `overscroll-behavior`, and short-height/landscape rules avoid clipping (`index.html:69`, `index.html:72-83`).
- Most primary controls meet or exceed a 44 px touch height.
- Resize adjusts canvas backing resolution, ground, hero position, and caps device pixel ratio to 1.5 on compact screens (`index.html:182`).
- Gameplay accepts one active pointer and clears held input on pointer cancel and visibility change (`index.html:570-572`).

**Risks observed in source, visual effect unverified**

- The viewport disables pinch zoom with `maximum-scale=1,user-scalable=no` (`index.html:1`). This is an accessibility regression on menus and scoreboards.
- Top and bottom safe-area insets are used, but left/right insets are not. HUD edges, pause, and panel content can sit in a landscape notch area (`index.html:2`, `index.html:32`, `index.html:71`).
- There is no narrow-width breakpoint for the two HUD blocks. The final HUD has small text and tight spacing, but fit at 320 px was not rendered in this audit.
- Score filter/select controls and toggles are 38–40 px high (`index.html:4`, `index.html:47`, `index.html:85`).
- Canvas CSS uses `100dvh` while its backing size uses `innerHeight`; actual browser chrome, virtual-keyboard, and `visualViewport` behavior was not exercised.

**Recommended fix**

Use horizontal `env(safe-area-inset-left/right)` padding, restore user zoom on non-game screens, bring interactive controls to at least 44 CSS px, and add screenshots/input checks at 320×568, 360×800, 390×844, and 844×390, including a notched landscape device and a scoreboard with the keyboard open.

### P1/P2: runner feel is promising, but deterministic simulation should precede tuning

**Observed and tested**

- Jump configuration: 105 ms coyote time, 130 ms input buffer, first impulse 525 px/s, second impulse 475 px/s, 170 ms hold acceleration at 820 px/s², and gravity at 1,650 px/s² (`index.html:555`, `index.html:564-565`, `index.html:606`).
- A dependency-free integration smoke at 60, 45, 30, and 25 fps produced held first-jump apexes of approximately 117.3–120.1 px and airtimes of 0.778–0.800 s. The small spread is a good sign.
- Collision geometry is deliberately character-independent. The hero uses one radius/state, platform landing uses a forgiving horizontal inset, and obstacle contacts use a smaller central box (`index.html:175`, `index.html:606`, `index.html:609-619`).
- Pickups use a swept segment/AABB contact test, reducing missed collectibles on long frames (`index.html:591-605`).
- All 13 authored route connectors passed their built-in ground-entry, ground-exit, first-decision, bounds, and low-ceiling-clearance checks (`index.html:308-335`).

**Residual fairness risks**

- Simulation uses variable `dt` clamped to 40 ms, not a fixed-step accumulator (`index.html:1000`). Landing and hazard contacts are discrete; only pickups are swept. The smoke test covers ordinary frame rates, not bursty long frames or moving-platform edge cases.
- Campaign and Adventure times advance by clamped simulation time (`index.html:606`), not wall time. That keeps travel and timer internally aligned, but slow-frame behavior and competitive timing should be a deliberate policy.
- Visual sprites are much larger than the forgiving collision box. This is fair across characters but can feel like apparent body contact did or did not count. A debug overlay is needed to tune perception against geometry.

**Recommended fix**

First introduce a fixed simulation step with an accumulator and swept obstacle/platform tests. Then run deterministic input traces at 30/45/60/120 Hz and tune jump impulses only after the outcomes match. Add reachability assertions for every mandatory Campaign transition rather than relying only on route connector shape.

### P2: campaign/adventure hazard progression is thoughtful but under-tested

**Observed strengths**

- Campaign unlocks a level only after the previous record is complete (`index.html:174`), and authored routes preserve a ground recovery path.
- Adventure starts with lower template pools and suppresses generated pressure combinations in intro/recovery/breather roles (`index.html:134-155`, `index.html:443-452`).
- Adventure hazard placement excludes route interiors unless explicitly authored, separates active hazards, avoids solid platform bodies/relics, and removes unsafe combinations as a final pass (`index.html:408-466`).
- The new smoke check confirms monotonic scaling. At 0 m the profile is 235 px/s, 1,050 ms nominal reaction, 365 px hazard gap, density 0. At 50 km it is about 314.6 px/s, 663.5 ms, 246.4 px, density 3. Speed caps at 317; nominal reaction bottoms at 620 ms; hazard gaps bottom at 225 px (`index.html:129-132`).
- Local-only deterministic debug targets exist at 1, 5, 10, 15, 25, and 50 km (`index.html:133`, `index.html:158-160`).

**Open design/fairness questions**

- `saveAttempt()` permanently merges prize cones and best collection stats even after a failed Campaign attempt (`index.html:557-561`). That makes collection cumulative across deaths. Confirm this is intentional progression, not a run-completion requirement.
- Every carried speed stack, slow stack, shield, remaining leap time, and giant state transfers to the next Campaign level after a win (`index.html:528-530`, `index.html:560`). This can create snowballing difficulty/advantage. Caps are applied when loading saved carry state, not when forming it.
- The safety model uses profile/world speed for nominal reaction spacing, while enemies, gulls, and bins also advance toward the player (`index.html:130-131`, `index.html:421-425`, `index.html:606`). Actual encounter time for moving hazards needs deterministic simulation; the nominal millisecond field alone does not prove it.
- Existing tests did not build every complete Campaign course, seed thousands of Adventure chunks, prove prize-cone reachability, or run collision traces.

Add seeded generation tests across every difficulty band, assert no blocking overlap and minimum actual time-to-contact, and simulate representative short/held/double-jump traces through every mandatory Campaign segment.

### P2: animation geometry is valid; loading and one state sequence need attention

**Observed**

- The three embedded character atlases plus Courtney's external atlas have explicit source rectangles (`index.html:811-812`). The new smoke test confirms all referenced rectangles fit their declared images and each character has enough states.
- Courtney's dedicated 1,448×362 run sheet has four clean, transparent run phases and the file/rect geometry matches (`assets/courtney/courtney-run-cycle-v3.png`, `index.html:814-815`). The 1,448×1,086 atlas contains distinct idle, run, jump/land/fall, and victory poses.
- Runtime state selection covers rising, falling, landing, playing, victory, failure, cone fire, giant scale, shield, and power effects (`index.html:832-859`). Run speed scales frame rate, and visual dimensions do not change collision geometry.
- Courtney's failure expression always selects state 10, whereas the other runners use a short first failure state and a later final state (`index.html:835`). This is a source-observed single-pose exception; whether it looks wrong in the game was not rendered.

**Recommended fix**

Lazy-load atlases as described above. If Courtney should have a two-stage failure, add/choose a grounded final pose and make the state sequence data-driven rather than nested index-specific ternaries. Add a dev overlay showing state name, source rect, rendered bounds, anchor, and collision box.

### P2: leaderboard transport is robust, but ranking semantics and scale need tightening

**Observed strengths**

- Runs are queued before upload, survive restart, retry on `online`, use a 4.5 s timeout, preserve terminal errors for user retry, and do not let a terminal failure block a later valid run (`index.html:88-113`).
- Local score saving remains available when the endpoint is offline, and recent Adventure runs have an explicit recovery path (`index.html:176-181`, `index.html:566-567`).
- Run IDs are idempotent and recovery matches equivalent submissions (`cloudflare-worker/src/index.js:66-70`). Existing client and Worker tests cover these paths.

**Issues**

- Name availability always returns `available:true`, even when used (`cloudflare-worker/src/index.js:36-43`). The client contains a “name already taken” path that this Worker can never trigger (`index.html:568`), and tests intentionally allow multiple players with the same displayed name. The UI should say names are labels, or the server should actually reserve them.
- `ownRank` is searched only inside the top-50 response (`cloudflare-worker/src/index.js:86-93`). A legitimate rank below 50 becomes `null`, and the UI says “Finish a run” rather than “Outside top 50” (`index.html:523`).
- The window queries rank every qualifying row before applying `LIMIT 50` (`cloudflare-worker/src/index.js:84-91`). Existing indexes do not include the full partition/order shape (`cloudflare-worker/schema.sql:20-23`). Performance at production row counts was not measured.
- Duplicate detection is a SELECT followed by INSERT (`cloudflare-worker/src/index.js:66-73`). Concurrent identical submissions can race at the unique constraint and temporarily return 500 instead of the intended idempotent 200.
- Only Adventure history stores worldwide status for later reconciliation. Campaign results rely on the separate queue and have no local recovery reconstruction if that queue is lost.

Return explicit rank state, align name semantics, inspect query plans with realistic data, catch unique-insert races as duplicates, and add queue/save reconciliation tests.

## Browser-observed versus unverified

No browser was launched in this audit. Therefore none of the following is claimed as observed: mobile layout fit, notch overlap, orientation/URL-bar/keyboard behavior, touch latency, actual first paint, live transfer headers/compression/cache behavior, image decode timing, browser memory, frame rate, long tasks, audio behavior, animation crop/anchor in the canvas, gameplay feel, or live Worker/D1 behavior.

What **was** observed: repository source, exact file/payload/image dimensions, Node syntax compilation, pure-function gameplay outputs, a numerical jump integration using extracted runtime constants, route validation, animation sheet pixels, in-memory SQLite migration behavior, and all dependency-free test results below.

## Checks run

The sandbox blocks Node's default test-file subprocess isolation, so the first plain `node --test …` attempt failed with `spawn EPERM` before any assertion ran. The same suites were rerun in Node 24.19.0's in-process mode:

```text
node --test --test-isolation=none test/gameplay-performance-smoke.test.mjs test/leaderboard-client.test.mjs
14 passed, 0 failed

node --test --test-isolation=none cloudflare-worker/test/worker.test.mjs
13 passed, 0 failed

node --check cloudflare-worker/src/index.js
passed
```

The added smoke suite covers:

- compilation of the complete inline script;
- audited payload/image-count regression ceilings;
- Adventure progression monotonicity and safety floors;
- held-jump consistency at 25/30/45/60 fps;
- all route connector bounds/entrances/exits/clearances;
- character atlas frame bounds and Courtney run-sheet geometry.

The payload ceilings preserve the current baseline only. They should be ratcheted sharply downward after assets leave `index.html`.

## Recommended implementation order

1. Protect or clearly label the worldwide leaderboard as untrusted; remove public player IDs immediately.
2. Repair and test the migration chain before any Worker/schema release.
3. Split and lazy-load assets/code, then collect real mobile startup/memory traces.
4. Batch saves and stop unnecessary menu rendering; profile low-end phones.
5. Add fixed-step deterministic gameplay tests and full-course/generator safety tests before changing jump or hazard balance.
6. Complete the mobile safe-area/accessibility matrix and animation state QA.
