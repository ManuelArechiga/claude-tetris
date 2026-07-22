# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

A single-page vanilla JavaScript Tetris implementation. No dependencies, no build step, no package.json. Three files cooperate directly:

- `index.html` — DOM structure: main `<canvas id="board">` (300×600, i.e. `COLS×BLOCK` by `ROWS×BLOCK`), a `<canvas id="next-canvas">` preview, HUD spans (`#score`, `#lines`, `#level`), the pause/game-over `#overlay`, and a `#theme-toggle` button.
- `style.css` — dark/retro arcade visual theme, with light-theme overrides via `[data-theme="light"]` and CSS custom properties (`--grid-line`, `--block-highlight`, etc.).
- `game.js` — all game logic (~330 lines), loaded as a plain `<script>` (no modules/bundler).

## Running the game

No install/build required. Either open `index.html` directly, or serve it statically, e.g.:

```bash
python3 -m http.server 8000
```

There is no test suite, linter, or CI config that runs against the game code (the `.github/workflows/` in this repo are Claude Code issue-triage automations, not a test/build pipeline).

## Architecture (`game.js`)

- **Board model**: `board` is a `ROWS × COLS` matrix; each cell is `0` (empty) or a color index `1–7` identifying which piece type locked there.
- **Pieces**: `PIECES` are hardcoded square matrices (indices 1–7 = I, O, T, S, Z, J, L). `current` and `next` pieces are plain objects `{ type, shape, x, y }`.
- **Rotation**: `rotateCW` transposes + reverses rows to rotate 90° CW. `tryRotate` applies the rotation and, on collision, attempts wall kicks by shifting `x` through `[0, -1, 1, -2, 2]` before giving up.
- **Collision**: `collide(shape, ox, oy)` is the single source of truth for both boundary and stack-overlap checks; it's reused for movement, rotation, ghost-piece projection, and spawn checks.
- **Game loop**: `loop(ts)` runs via `requestAnimationFrame`, accumulates elapsed time in `dropAccum`, and advances the piece one row (or locks it) once `dropAccum >= dropInterval`. After the drop/lock step it checks `if (gameOver || paused) return;` before drawing and re-scheduling the next frame — this guard is required because `lockPiece()` can synchronously trigger `endGame()` (or a pause can land) mid-tick, and without it the loop would draw and re-schedule itself one extra time, causing a piece to visibly render/drop after game over.
- **Locking/line clears**: `lockPiece` → `merge` (writes piece into `board`) → `clearLines` (scans bottom-up, splices full rows, unshifts empty rows at top, re-checks the same row index after a splice) → `spawn`.
- **Scoring/leveling**: `LINE_SCORES = [0, 100, 300, 500, 800]` multiplied by `level`; hard drop adds 2 pts/row dropped, soft drop 1 pt/row. `level` increments every 10 lines; `dropInterval = max(100, 1000 - (level-1)*90)`.
- **Ghost piece**: `ghostY()` projects `current` straight down via repeated `collide` checks; drawn at `globalAlpha = 0.2`.
- **Game over**: detected in `spawn()` when the freshly promoted `current` immediately collides at its spawn position; `endGame()` sets `gameOver = true` and shows the overlay. Because `cancelAnimationFrame` can't reliably stop the frame currently executing, the `gameOver`/`paused` check inside `loop()` (see above) is what actually halts the loop — don't remove it when touching pause/game-over/loop code.
- **Theme toggle**: `applyTheme`/`toggleTheme` set `data-theme` on `<html>` and persist the choice to `localStorage` (`tetris-theme`); `refreshThemeColors()` re-reads the `--grid-line`/`--block-highlight` CSS variables so canvas-drawn grid lines and block highlights (which can't use CSS) stay in sync with the active theme.

Global mutable game state (`board`, `current`, `next`, `score`, `lines`, `level`, `paused`, `gameOver`, `dropInterval`, etc.) lives as top-level `let` variables reset in `init()` — there is no state container/class.

## Tunable constants (top of `game.js`)

`COLS`, `ROWS`, `BLOCK`, `COLORS`, `LINE_SCORES`, `dropInterval` (initial value). If `COLS`/`ROWS`/`BLOCK` change, update the `width`/`height` attributes of `<canvas id="board">` in `index.html` to match (`COLS×BLOCK`, `ROWS×BLOCK`).
