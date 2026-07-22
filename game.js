'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // 1  I - cyan
  '#ffd54f', // 2  O - yellow
  '#ba68c8', // 3  T - purple
  '#81c784', // 4  S - green
  '#e57373', // 5  Z - red
  '#64b5f6', // 6  J - pale blue
  '#ffb74d', // 7  L - orange
  '#f06292', // 8  + pentominó - rosa
  '#aed581', // 9  U pentominó - verde claro
  '#4db6ac', // 10 Y pentominó - verde azulado
  '#fff176', // 11 single (recompensa tras Tetris) - amarillo claro
  '#9575cd', // 12 3x3 hueca (reto) - lila
  '#ffe082', // 13 power-up (color base; se sobreescribe visualmente con glifo)
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // 1  I
  [[2,2],[2,2]],                               // 2  O
  [[0,3,0],[3,3,3],[0,0,0]],                  // 3  T
  [[0,4,4],[4,4,0],[0,0,0]],                  // 4  S
  [[5,5,0],[0,5,5],[0,0,0]],                  // 5  Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // 6  J
  [[0,0,7],[7,7,7],[0,0,0]],                  // 7  L
  [[0,8,0],[8,8,8],[0,8,0]],                  // 8  + pentominó
  [[9,0,9],[9,9,9]],                          // 9  U pentominó
  [[0,10,0,0],[10,10,10,10]],                 // 10 Y pentominó
  [[11]],                                      // 11 single (recompensa)
  [[12,12,12],[12,0,12],[12,12,12]],          // 12 3x3 hueca
  [[13]],                                      // 13 power-up (1x1)
];

const LINE_SCORES = [0, 100, 300, 500, 800];
const TSPIN_SCORES = [100, 400, 800, 1200]; // indexado por líneas limpiadas con T-spin (0-3)
const COMBO_BONUS = 50;
const B2B_MULT = 1.5;
const PERFECT_CLEAR_BONUS = 1000;

const POWERUP_EVERY = 8;      // líneas necesarias para que aparezca un power-up
const PENTOMINO_CHANCE = 0.12;
const HOLLOW_CHANCE = 0.04;
const FREEZE_MS = 5000;

const SINGLE_TYPE = 11;
const HOLLOW_TYPE = 12;
const POWERUP_TYPE = 13;
const PENTOMINO_TYPES = [8, 9, 10];
const POWERUPS = ['bomb', 'ray', 'tint', 'gravity', 'freeze'];
const POWERUP_COLOR = '#fff59d';
const POWERUP_GLYPHS = { bomb: '💣', ray: '⚡', tint: '🎨', gravity: '⬇️', freeze: '❄️' };

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const holdCanvas = document.getElementById('hold-canvas');
const holdCtx = holdCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const flashEl = document.getElementById('flash');

let board, current, next, hold, holdUsed, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let combo, b2b, lastMoveRotation, frozenUntil, linesForPowerup, pendingSingle;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function pieceFromType(type, powerup) {
  const shape = PIECES[type].map(row => [...row]);
  const piece = { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
  if (powerup) piece.powerup = powerup;
  return piece;
}

function randomPiece() {
  const type = Math.floor(Math.random() * 7) + 1;
  return pieceFromType(type);
}

// Punto único de inyección de piezas especiales (pentominós, hueca, single de
// recompensa, power-ups) por encima de las 7 piezas estándar.
function nextPiece() {
  if (pendingSingle) {
    pendingSingle = false;
    return pieceFromType(SINGLE_TYPE);
  }
  if (linesForPowerup >= POWERUP_EVERY) {
    linesForPowerup -= POWERUP_EVERY;
    const kind = POWERUPS[Math.floor(Math.random() * POWERUPS.length)];
    return pieceFromType(POWERUP_TYPE, kind);
  }
  if (Math.random() < HOLLOW_CHANCE) {
    return pieceFromType(HOLLOW_TYPE);
  }
  if (Math.random() < PENTOMINO_CHANCE) {
    const type = PENTOMINO_TYPES[Math.floor(Math.random() * PENTOMINO_TYPES.length)];
    return pieceFromType(type);
  }
  return randomPiece();
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      lastMoveRotation = true;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  return cleared;
}

// Compacta cada columna de forma independiente, dejando caer los bloques que
// quedaron flotando tras un power-up (bomba/rayo/tinte) hacia el fondo.
function compactColumns() {
  for (let c = 0; c < COLS; c++) {
    const colVals = [];
    for (let r = 0; r < ROWS; r++) if (board[r][c]) colVals.push(board[r][c]);
    for (let r = ROWS - 1, i = colVals.length - 1; r >= 0; r--, i--) {
      board[r][c] = i >= 0 ? colVals[i] : 0;
    }
  }
}

// Detección aproximada de T-spin (regla de las 3 esquinas): solo aplica a la
// pieza T, y solo si la última acción del jugador fue una rotación exitosa.
function detectTSpin() {
  if (current.type !== 3 || !lastMoveRotation) return false;
  const cx = current.x, cy = current.y;
  const corners = [[cx, cy], [cx + 2, cy], [cx, cy + 2], [cx + 2, cy + 2]];
  let filled = 0;
  for (const [x, y] of corners) {
    let occupied;
    if (x < 0 || x >= COLS || y >= ROWS) occupied = true;
    else if (y < 0) occupied = false;
    else occupied = !!board[y][x];
    if (occupied) filled++;
  }
  return filled >= 3;
}

function applyPowerup(kind, cx, cy) {
  switch (kind) {
    case 'bomb':
      for (let r = cy - 1; r <= cy + 1; r++) {
        for (let c = cx - 1; c <= cx + 1; c++) {
          if (r >= 0 && r < ROWS && c >= 0 && c < COLS) board[r][c] = 0;
        }
      }
      flashMessage('¡BOMBA!');
      beep(150, 0.3, 'sawtooth');
      break;
    case 'ray':
      for (let c = 0; c < COLS; c++) board[cy][c] = 0;
      for (let r = 0; r < ROWS; r++) board[r][cx] = 0;
      flashMessage('¡RAYO!');
      beep(1000, 0.15, 'square');
      break;
    case 'tint': {
      // Comodín: limpia todos los bloques del color que hay justo debajo de
      // donde cayó (o, si no hay nada debajo, el color más común del tablero).
      let targetColor = 0;
      for (let r = cy + 1; r < ROWS; r++) {
        if (board[r][cx] && board[r][cx] !== POWERUP_TYPE) { targetColor = board[r][cx]; break; }
      }
      if (!targetColor) {
        const counts = {};
        for (let r = 0; r < ROWS; r++)
          for (let c = 0; c < COLS; c++) {
            const v = board[r][c];
            if (v && v !== POWERUP_TYPE) counts[v] = (counts[v] || 0) + 1;
          }
        let best = 0, bestCount = 0;
        for (const k in counts) if (counts[k] > bestCount) { bestCount = counts[k]; best = +k; }
        targetColor = best;
      }
      board[cy][cx] = 0;
      if (targetColor) {
        for (let r = 0; r < ROWS; r++)
          for (let c = 0; c < COLS; c++)
            if (board[r][c] === targetColor) board[r][c] = 0;
      }
      flashMessage('¡TINTE!');
      beep(500, 0.2, 'sine');
      break;
    }
    case 'gravity':
      flashMessage('GRAVEDAD');
      beep(200, 0.2, 'triangle');
      break;
    case 'freeze':
      frozenUntil = performance.now() + FREEZE_MS;
      flashMessage('¡CONGELADO!');
      beep(800, 0.4, 'sine');
      break;
  }
  if (kind !== 'freeze') compactColumns();
}

function applyScore(cleared, tspin) {
  const prevB2B = b2b;
  let gained = 0;

  if (tspin) {
    gained += (TSPIN_SCORES[cleared] || 0) * level;
  } else if (cleared > 0) {
    gained += (LINE_SCORES[cleared] || 0) * level;
  }

  if (cleared > 0) {
    combo++;
    if (combo >= 1) gained += COMBO_BONUS * combo * level;
  } else {
    combo = -1;
  }

  const isHard = cleared === 4 || (tspin && cleared > 0);
  if (isHard) {
    if (prevB2B) gained = Math.floor(gained * B2B_MULT);
    b2b = true;
  } else if (cleared > 0) {
    b2b = false;
  }

  let perfectClear = false;
  if (cleared > 0 && board.every(row => row.every(v => v === 0))) {
    gained += PERFECT_CLEAR_BONUS * level;
    perfectClear = true;
  }

  if (gained > 0) score += gained;

  const msgs = [];
  if (tspin) msgs.push(cleared > 0 ? `T-SPIN x${cleared}` : 'T-SPIN');
  if (cleared === 4) msgs.push('¡TETRIS!');
  if (isHard && prevB2B) msgs.push('B2B');
  if (combo >= 1) msgs.push(`COMBO x${combo}`);
  if (perfectClear) msgs.push('¡PERFECT CLEAR!');
  if (msgs.length) flashMessage(msgs.join(' · '));

  if (perfectClear) beep(900, 0.3, 'square');
  else if (cleared === 4) beep(700, 0.25, 'square');
  else if (tspin) beep(650, 0.2, 'triangle');
  else if (combo >= 1) beep(500 + 30 * combo, 0.1);
  else if (cleared > 0) beep(350, 0.1);
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    lastMoveRotation = false;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  const tspin = detectTSpin();
  merge();
  if (current.powerup) {
    applyPowerup(current.powerup, current.x, current.y);
  }
  const cleared = clearLines();
  applyScore(cleared, tspin);
  if (cleared) {
    lines += cleared;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    linesForPowerup += cleared;
    if (cleared === 4) pendingSingle = true;
  }
  updateHUD();
  spawn();
}

function spawn() {
  current = next;
  next = nextPiece();
  holdUsed = false;
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
  drawHold();
}

// Reserva/intercambia la pieza actual. Solo se puede usar una vez por pieza
// (bloqueado hasta que la pieza actual se asiente) para evitar abusos.
function holdPiece() {
  if (holdUsed || gameOver || paused) return;
  const curType = current.type;
  const curPowerup = current.powerup;
  if (hold === null) {
    hold = { type: curType, powerup: curPowerup };
    current = next;
    next = nextPiece();
  } else {
    const heldType = hold.type;
    const heldPowerup = hold.powerup;
    hold = { type: curType, powerup: curPowerup };
    current = pieceFromType(heldType, heldPowerup);
  }
  holdUsed = true;
  if (collide(current.shape, current.x, current.y)) {
    endGame();
    return;
  }
  drawNext();
  drawHold();
  draw();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha, powerupKind) {
  if (!colorIndex) return;
  const color = powerupKind ? POWERUP_COLOR : COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = blockHighlightColor;
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  if (powerupKind) {
    context.fillStyle = '#000';
    context.font = `${Math.floor(size * 0.55)}px sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(POWERUP_GLYPHS[powerupKind], x * size + size / 2, y * size + size / 2 + 1);
  }
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = gridLineColor;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK, 1, current.powerup);
}

// Dibuja una pieza "suelta" (no en el tablero) centrada en un canvas de
// vista previa de 4x4 celdas; usado tanto por NEXT como por HOLD.
function drawPreview(context, previewCanvas, pieceLike, dim) {
  const NB = 30;
  context.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  if (!pieceLike) return;
  const shape = PIECES[pieceLike.type];
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  const alpha = dim ? 0.35 : 1;
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      if (shape[r][c])
        drawBlock(context, offX + c, offY + r, shape[r][c], NB, alpha, pieceLike.powerup);
}

function drawNext() {
  drawPreview(nextCtx, nextCanvas, next, false);
}

function drawHold() {
  drawPreview(holdCtx, holdCanvas, hold, holdUsed);
  holdCanvas.classList.toggle('hold-locked', holdUsed);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  const frozen = ts < frozenUntil;
  if (!frozen) {
    dropAccum += dt;
    if (dropAccum >= dropInterval) {
      dropAccum = 0;
      if (!collide(current.shape, current.x, current.y + 1)) {
        current.y++;
        lastMoveRotation = false;
      } else {
        lockPiece();
      }
    }
  }
  if (gameOver || paused) return;
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  hold = null;
  holdUsed = false;
  combo = -1;
  b2b = false;
  lastMoveRotation = false;
  frozenUntil = 0;
  linesForPowerup = 0;
  pendingSingle = false;
  next = nextPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) { current.x--; lastMoveRotation = false; }
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) { current.x++; lastMoveRotation = false; }
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
    case 'KeyC':
    case 'ShiftLeft':
    case 'ShiftRight':
      holdPiece();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

// ---- Theme (light/dark) ----
const THEME_KEY = 'tetris-theme';
const themeToggleBtn = document.getElementById('theme-toggle');
let gridLineColor = '#22222e';
let blockHighlightColor = 'rgba(255,255,255,0.12)';

function refreshThemeColors() {
  const styles = getComputedStyle(document.documentElement);
  gridLineColor = styles.getPropertyValue('--grid-line').trim();
  blockHighlightColor = styles.getPropertyValue('--block-highlight').trim();
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeToggleBtn.textContent = theme === 'light' ? '☀️' : '🌙';
  refreshThemeColors();
  if (board) draw();
}

function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}

themeToggleBtn.addEventListener('click', toggleTheme);
applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');

// ---- Toast de mensajes (combo, T-spin, power-ups...) ----
let flashTimeout = null;
function flashMessage(text) {
  flashEl.textContent = text;
  flashEl.classList.remove('hidden');
  flashEl.classList.remove('flash-anim');
  void flashEl.offsetWidth; // fuerza reflow para reiniciar la animación
  flashEl.classList.add('flash-anim');
  clearTimeout(flashTimeout);
  flashTimeout = setTimeout(() => flashEl.classList.add('hidden'), 1200);
}

// ---- Audio (efectos mínimos vía WebAudio) ----
const MUTE_KEY = 'tetris-muted';
const muteToggleBtn = document.getElementById('mute-toggle');
let audioCtx = null;
let muted = localStorage.getItem(MUTE_KEY) === '1';

function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function beep(freq = 440, dur = 0.1, type = 'sine') {
  if (muted) return;
  try {
    const ac = ensureAudio();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.15, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start();
    osc.stop(ac.currentTime + dur);
  } catch (err) {
    // AudioContext no disponible (p.ej. antes de interacción del usuario); ignorar.
  }
}

function applyMuteUI() {
  muteToggleBtn.textContent = muted ? '🔇' : '🔊';
}

function toggleMute() {
  muted = !muted;
  localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  applyMuteUI();
}

muteToggleBtn.addEventListener('click', toggleMute);
applyMuteUI();

init();
