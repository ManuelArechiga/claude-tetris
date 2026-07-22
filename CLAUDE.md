# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

A single-page vanilla JavaScript Tetris implementation. No dependencies, no build step, no package.json. Three files cooperate directly:

- `index.html` — DOM structure: main `<canvas id="board">` (300×600, i.e. `COLS×BLOCK` by `ROWS×BLOCK`) wrapped in `.board-wrap` together with the `#flash` toast overlay, a `<canvas id="hold-canvas">` and `<canvas id="next-canvas">` preview pair, HUD spans (`#score`, `#lines`, `#level`), the pause/game-over `#overlay`, and `#theme-toggle`/`#mute-toggle` buttons.
- `style.css` — dark/retro arcade visual theme, with light-theme overrides via `[data-theme="light"]` and CSS custom properties (`--grid-line`, `--block-highlight`, etc.). Also styles the `#flash` toast (`.flash-anim` keyframe pop) and the dimmed `#hold-canvas.hold-locked` state.
- `game.js` — all game logic, loaded as a plain `<script>` (no modules/bundler).

## Running the game

No install/build required. Either open `index.html` directly, or serve it statically, e.g.:

```bash
python3 -m http.server 8000
```

There is no test suite, linter, or CI config that runs against the game code (the `.github/workflows/` in this repo are Claude Code issue-triage automations, not a test/build pipeline).

## Architecture (`game.js`)

- **Board model**: `board` is a `ROWS × COLS` matrix; each cell is `0` (empty) or a color index `1–13` identifying which piece type locked there (see Pieces below).
- **Pieces**: `PIECES` are hardcoded matrices. Indices 1–7 = standard I, O, T, S, Z, J, L. Indices 8–10 = pentominós (`+`, `U`, `Y`) that spawn occasionally. Index 11 = a 1×1 "single" reward piece, auto-queued after a Tetris (4-line clear). Index 12 = a hollow 3×3 "reto" piece (a ring). Index 13 = a 1×1 power-up piece; power-up pieces carry an extra `powerup` field (`'bomb' | 'ray' | 'tint' | 'gravity' | 'freeze'`) alongside `type: 13`. `current`, `next`, and `hold` are plain objects `{ type, shape, x, y, powerup? }` (`hold` only stores `{ type, powerup }` — it's reinstantiated via `pieceFromType` when swapped back in). `pieceFromType(type, powerup)` is the single constructor used everywhere a piece is created; `randomPiece()` picks among the 7 standard types, and `nextPiece()` is the single injection point that decides — in priority order — whether the upcoming piece should be the pending reward single, a power-up (once `linesForPowerup >= POWERUP_EVERY`), a hollow/pentominó (`HOLLOW_CHANCE`/`PENTOMINO_CHANCE` rolls), or a standard piece.
- **Rotation**: `rotateCW` transposes + reverses rows to rotate 90° CW — works unchanged for the irregular pentominó/hollow shapes since they're just rectangular matrices. `tryRotate` applies the rotation and, on collision, attempts wall kicks by shifting `x` through `[0, -1, 1, -2, 2]` before giving up; on success it also sets `lastMoveRotation = true` (consumed by T-spin detection).
- **Collision**: `collide(shape, ox, oy)` is the single source of truth for both boundary and stack-overlap checks; it's reused for movement, rotation, ghost-piece projection, and spawn checks.
- **Game loop**: `loop(ts)` runs via `requestAnimationFrame`, accumulates elapsed time in `dropAccum`, and advances the piece one row (or locks it) once `dropAccum >= dropInterval` — skipped entirely while `ts < frozenUntil` (the "congelar" power-up), though drawing/scheduling still happens so the player can keep moving/rotating during a freeze. After the drop/lock step it checks `if (gameOver || paused) return;` before drawing and re-scheduling the next frame — this guard is required because `lockPiece()` can synchronously trigger `endGame()` (or a pause can land) mid-tick, and without it the loop would draw and re-schedule itself one extra time, causing a piece to visibly render/drop after game over. Don't remove it when touching pause/game-over/loop code.
- **Locking/line clears**: `lockPiece` → `detectTSpin()` (reads `current`/`board` before merging) → `merge` (writes piece into `board`) → `applyPowerup(kind, x, y)` if the locked piece was a power-up → `clearLines` (scans bottom-up, splices full rows, unshifts empty rows at top, re-checks the same row index after a splice; now returns just the `cleared` count) → `applyScore(cleared, tspin)` (all scoring/combo/B2B/perfect-clear logic) → `lines`/`level`/`dropInterval`/`linesForPowerup` bookkeeping → `spawn`.
- **Scoring/leveling**: `LINE_SCORES = [0, 100, 300, 500, 800]` (or `TSPIN_SCORES` for T-spins) multiplied by `level`; hard drop adds 2 pts/row dropped, soft drop 1 pt/row. Consecutive clearing turns increment `combo` (reset to `-1` on a turn with no clear), adding `COMBO_BONUS * combo * level` from the 2nd consecutive clear onward. `b2b` tracks back-to-back "hard" clears (Tetris or T-spin-with-lines) and multiplies the next hard clear's score by `B2B_MULT`. A clear that empties the board entirely adds `PERFECT_CLEAR_BONUS * level`. `applyScore` also triggers `flashMessage(...)` (toast) and `beep(...)` (WebAudio) for these events. `level` increments every 10 lines; `dropInterval = max(100, 1000 - (level-1)*90)`.
- **T-spin detection**: `detectTSpin()` is an approximate 3-corner-rule check — only fires for the T piece (`type === 3`) when `lastMoveRotation` is true (set by `tryRotate`, cleared by any left/right move or gravity/soft-drop step); it inspects the 4 corners of the T's 3×3 bounding box against `board`/walls/floor.
- **Power-ups**: triggered by `applyPowerup(kind, cx, cy)` at the exact cell where a power-up piece (always 1×1) locked. `bomb` clears a 3×3 area; `ray` clears the full row and column through that cell; `tint` clears every board cell matching the color found just below the landing cell (falls back to the board's most common color if nothing's below) — effectively a "make this color a wildcard and clear it" effect; `gravity` is a no-op beyond the shared post-effect compaction; `freeze` sets `frozenUntil = now + FREEZE_MS` and does *not* run compaction. All non-freeze effects call `compactColumns()` (drops each column's remaining blocks down independently, closing gaps) followed by the normal `clearLines()`/`applyScore()` pass in `lockPiece`. New power-up pieces are queued by `nextPiece()` once `linesForPowerup` (incremented by lines cleared) reaches `POWERUP_EVERY`.
- **Hold**: `holdPiece()` (bound to `KeyC`/`Shift`) swaps `current` with `hold` (or stashes `current` into an empty `hold` and promotes `next`), reinstantiating via `pieceFromType` so shape/position/powerup are fresh. Gated by `holdUsed`, which `spawn()` resets to `false` on every natural piece spawn — so a hold can only happen once per piece before it locks. `drawHold()` dims the hold preview (`.hold-locked` class) while `holdUsed` is true.
- **Preview rendering**: `drawPreview(context, canvas, pieceLike, dim)` is the shared renderer for both `#next-canvas` and `#hold-canvas` (centers the piece's `PIECES[type]` shape in a 4×4 cell grid); `drawNext`/`drawHold` are thin wrappers over it.
- **Ghost piece**: `ghostY()` projects `current` straight down via repeated `collide` checks; drawn at `globalAlpha = 0.2`.
- **Game over**: detected in `spawn()` when the freshly promoted `current` immediately collides at its spawn position (also checked directly in `holdPiece()` after a swap); `endGame()` sets `gameOver = true` and shows the overlay. Because `cancelAnimationFrame` can't reliably stop the frame currently executing, the `gameOver`/`paused` check inside `loop()` (see above) is what actually halts the loop — don't remove it when touching pause/game-over/loop code.
- **Theme toggle**: `applyTheme`/`toggleTheme` set `data-theme` on `<html>` and persist the choice to `localStorage` (`tetris-theme`); `refreshThemeColors()` re-reads the `--grid-line`/`--block-highlight` CSS variables so canvas-drawn grid lines and block highlights (which can't use CSS) stay in sync with the active theme.
- **Mute toggle**: `toggleMute`/`applyMuteUI` mirror the theme toggle's pattern — persist to `localStorage` (`tetris-muted`), flip `#mute-toggle`'s emoji; `beep()` is a no-op while `muted` and lazily creates a single shared `AudioContext`.
- **Toast messages**: `flashMessage(text)` sets `#flash`'s text and restarts its CSS `.flash-anim` keyframe pop (via a forced reflow) to surface combo/T-spin/B2B/perfect-clear/power-up events without blocking gameplay.

Global mutable game state (`board`, `current`, `next`, `hold`, `holdUsed`, `score`, `lines`, `level`, `paused`, `gameOver`, `dropInterval`, `combo`, `b2b`, `lastMoveRotation`, `frozenUntil`, `linesForPowerup`, `pendingSingle`, etc.) lives as top-level `let` variables reset in `init()` — there is no state container/class.

## Tunable constants (top of `game.js`)

`COLS`, `ROWS`, `BLOCK`, `COLORS`, `PIECES`, `LINE_SCORES`/`TSPIN_SCORES`, `COMBO_BONUS`, `B2B_MULT`, `PERFECT_CLEAR_BONUS`, `POWERUP_EVERY`, `PENTOMINO_CHANCE`, `HOLLOW_CHANCE`, `FREEZE_MS`, `POWERUPS`, `dropInterval` (initial value). If `COLS`/`ROWS`/`BLOCK` change, update the `width`/`height` attributes of `<canvas id="board">` in `index.html` to match (`COLS×BLOCK`, `ROWS×BLOCK`).
