import {
  FaceLandmarker,
  FilesetResolver,
} from './vendor/tasks-vision/vision_bundle.mjs';

const SMILE_THRESHOLD = 0.35;
const NOSE_LANDMARK = 1;
const TILT_ENTER_DELTA = 0.045;
const TILT_EXIT_DELTA = 0.03;
const TILT_BASELINE_EMA = 0.02;
const MIN_JUMP = 6;
const MAX_JUMP = 14;
const GRAVITY = 0.5;
const GROUND_Y = 150;
const CHAR_X = 40;
const CHAR_W = 16;
const CHAR_H = 20;
const SQUAT_H = 10;
const BASE_SPEED = 1.5;
const MAX_SPEED = 6;
const SPEED_RAMP = 0.0015;

const video = document.getElementById('camera');
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const smileBarFill = document.getElementById('smile-bar-fill');
const tiltBarFill = document.getElementById('tilt-bar-fill');
const statusEl = document.getElementById('status');

const GAME_ASPECT = canvas.width / canvas.height;

function resizeCanvas() {
  const availW = window.innerWidth;
  const availH = window.innerHeight;
  let w = availW;
  let h = w / GAME_ASPECT;
  if (h > availH) {
    h = availH;
    w = h * GAME_ASPECT;
  }
  canvas.style.width = `${Math.floor(w)}px`;
  canvas.style.height = `${Math.floor(h)}px`;
}

window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', resizeCanvas);
resizeCanvas();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      // Check for a new version right away, and again whenever the app is
      // brought back to the foreground (e.g. reopened from the home
      // screen) so an installed PWA doesn't sit on a stale build.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }).catch(() => {});
  });

  // sw.js calls skipWaiting()/clients.claim() unconditionally, so once a
  // new service worker takes over an already-controlled page, reload to
  // pick up the matching HTML/JS. The very first controllerchange (fresh
  // install, no prior controller) is not an update, so it's ignored.
  const hadController = !!navigator.serviceWorker.controller;
  let reloadedForUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloadedForUpdate) return;
    reloadedForUpdate = true;
    window.location.reload();
  });
}

let charY = GROUND_Y - CHAR_H;
let velocityY = 0;
let jumping = false;

const LAND_SQUASH_FRAMES = 10;
let landSquashTimer = 0;

let obstacles = [];
let spawnTimer = 60;
let score = 0;
let gameOver = false;
let gameOverTimer = 0;

const RESTART_DELAY = 60;
const HIGH_SCORE_KEY = 'smileJumpHighScore';
let highScore = Number(localStorage.getItem(HIGH_SCORE_KEY)) || 0;

const MAX_LIVES = 3;
const INVULN_FRAMES = 90;
const HIT_FLASH_FRAMES = 10;
let lives = MAX_LIVES;
let invulnTimer = 0;
let hitFlashTimer = 0;
let particles = [];

let prevSmiling = false;
let jumpRequested = false;
let jumpPower = 0;
let squatting = false;

let bgFar = 0;
let bgMid = 0;
let bgNear = 0;
let bgCloud = 0;
let dayT = 0;
let biome = 'forest';
let biomeBlend = 0;

// One day/night half-phase lasts PHASE_LEN score-frames (~30s at 60fps);
// a full forest era (day+night) and a full city era (day+night) each last
// 2*PHASE_LEN, and the two eras alternate forever as score climbs - this
// keeps cycling long after speed itself has maxed out. TRANSITION_LEN is
// how much of the end of each era is spent smoothly blending into the
// next one (trees and buildings mixed together) instead of a hard cut.
const PHASE_LEN = 1800;
const ERA_LEN = PHASE_LEN * 2;
const TRANSITION_LEN = 700;

const MONSTER_COLORS = ['#3a2545', '#2b3a2e', '#4a1f23'];
const SPARROW_COLORS = ['#5b8fd6', '#d6935b', '#8fbf6f'];
const BUILDING_COLORS = ['#8a7a6a', '#6d7a86', '#7a6d78', '#5e6b5a', '#9c6b5a', '#5a7a85'];
const CAR_COLORS = ['#c0392b', '#2d6cc0', '#e0b23c', '#4a4f55'];
const OUTLINE = 'rgba(20, 18, 14, 0.85)';
const NO_JUMP_TYPES = new Set(['sparrow', 'crow', 'dragon', 'branch']);

function smileScore(blendshapes) {
  const categories = blendshapes.categories;
  const left = categories.find((c) => c.categoryName === 'mouthSmileLeft')?.score ?? 0;
  const right = categories.find((c) => c.categoryName === 'mouthSmileRight')?.score ?? 0;
  return (left + right) / 2;
}

let noseBaselineY = null;

// Tracks the nose tip's vertical position in the video frame (y grows
// downward) against a slow-moving baseline of "neutral" head position, so
// it auto-calibrates to however the phone is propped up. Tilting/ducking
// the head down moves the nose down in frame relative to that baseline;
// crossing the enter threshold starts a squat, dropping back under the
// (lower) exit threshold ends it, which avoids flicker right at the edge.
function updateTilt(landmarks) {
  if (!landmarks) {
    squatting = false;
    return 0;
  }

  const noseY = landmarks[NOSE_LANDMARK].y;
  if (noseBaselineY === null) noseBaselineY = noseY;
  const delta = noseY - noseBaselineY;

  if (!squatting && delta > TILT_ENTER_DELTA) squatting = true;
  else if (squatting && delta < TILT_EXIT_DELTA) squatting = false;

  if (!squatting) {
    noseBaselineY += (noseY - noseBaselineY) * TILT_BASELINE_EMA;
  }

  return delta;
}

function resetGame() {
  charY = GROUND_Y - CHAR_H;
  velocityY = 0;
  jumping = false;
  squatting = false;
  obstacles = [];
  spawnTimer = 60;
  score = 0;
  gameOver = false;
  gameOverTimer = 0;
  lives = MAX_LIVES;
  invulnTimer = 0;
  hitFlashTimer = 0;
  landSquashTimer = 0;
  particles = [];
}

const EXPLOSION_COLORS = ['#c0432f', '#7a2318', '#200a06', '#e0735a'];

function spawnExplosion(cx, cy) {
  for (let i = 0; i < 14; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * 2.5;
    const life = 20 + Math.random() * 12;
    particles.push({
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1,
      size: 1.5 + Math.random() * 2.5,
      color: EXPLOSION_COLORS[Math.floor(Math.random() * EXPLOSION_COLORS.length)],
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.6,
      life,
      maxLife: life,
    });
  }
}

const FOREST_GROUND_TYPES = ['rock', 'bin', 'monster', 'sheep', 'wolf', 'elephant', 'fox'];
const CITY_GROUND_TYPES = ['rock', 'bin', 'monster', 'car', 'phoneBooth', 'hydrant'];

function pickGroundType() {
  const pool = Math.random() < biomeBlend ? CITY_GROUND_TYPES : FOREST_GROUND_TYPES;
  return pool[Math.floor(Math.random() * pool.length)];
}

function pickFlyerType() {
  const r = Math.random();
  if (r < 0.45) return 'sparrow';
  if (r < 0.8) return 'crow';
  return 'dragon';
}

function pickCategory() {
  const r = Math.random();
  if (r < 0.5) return 'ground';
  if (r < 0.78) return 'flyer';
  return 'duck';
}

function spawnFlyer(type) {
  let h, w, gapRange, flapInterval;
  if (type === 'sparrow') {
    h = 8 + Math.random() * 3;
    w = 13 + Math.random() * 4;
    gapRange = [2, 4];
    flapInterval = 5;
  } else if (type === 'crow') {
    h = 10 + Math.random() * 3;
    w = 17 + Math.random() * 5;
    gapRange = [3, 7];
    flapInterval = 7;
  } else {
    h = 15 + Math.random() * 5;
    w = 28 + Math.random() * 10;
    gapRange = [6, 12];
    flapInterval = 10;
  }

  const gap = gapRange[0] + Math.random() * (gapRange[1] - gapRange[0]);
  const y = GROUND_Y - CHAR_H - gap - h;
  const color = type === 'sparrow' ? SPARROW_COLORS[Math.floor(Math.random() * SPARROW_COLORS.length)] : undefined;

  obstacles.push({ x: canvas.width, y, w, h, type, color, flapSeed: Math.random() * 10, flapInterval });
}

function spawnGround(type) {
  if (type === 'rock') {
    const h = 12 + Math.random() * 14;
    const w = 14 + Math.random() * 10;
    const bumps = Array.from({ length: 8 }, () => 0.78 + Math.random() * 0.3);
    obstacles.push({ x: canvas.width, y: GROUND_Y - h, w, h, type, bumps });
    return;
  }

  if (type === 'bin') {
    const h = 18 + Math.random() * 8;
    const w = 14 + Math.random() * 4;
    obstacles.push({ x: canvas.width, y: GROUND_Y - h, w, h, type });
    return;
  }

  if (type === 'monster') {
    const h = 22 + Math.random() * 12;
    const w = 18 + Math.random() * 8;
    const color = MONSTER_COLORS[Math.floor(Math.random() * MONSTER_COLORS.length)];
    const spikes = Array.from({ length: 10 }, (_, i) =>
      i % 2 === 0 ? 0.6 + Math.random() * 0.25 : 1.05 + Math.random() * 0.3
    );
    obstacles.push({ x: canvas.width, y: GROUND_Y - h, w, h, type, color, bobSeed: Math.random() * 10, spikes });
    return;
  }

  if (type === 'sheep') {
    const h = 16 + Math.random() * 6;
    const w = 20 + Math.random() * 6;
    obstacles.push({ x: canvas.width, y: GROUND_Y - h, w, h, type, bobSeed: Math.random() * 10 });
    return;
  }

  if (type === 'wolf') {
    const h = 16 + Math.random() * 4;
    const w = 20 + Math.random() * 4;
    obstacles.push({ x: canvas.width, y: GROUND_Y - h, w, h, type, bobSeed: Math.random() * 10 });
    return;
  }

  if (type === 'fox') {
    const h = 12 + Math.random() * 4;
    const w = 16 + Math.random() * 4;
    obstacles.push({ x: canvas.width, y: GROUND_Y - h, w, h, type, bobSeed: Math.random() * 10 });
    return;
  }

  if (type === 'elephant') {
    // the biggest, hardest ground obstacle
    const h = 30 + Math.random() * 8;
    const w = 32 + Math.random() * 8;
    obstacles.push({ x: canvas.width, y: GROUND_Y - h, w, h, type, bobSeed: Math.random() * 10 });
    return;
  }

  if (type === 'car') {
    const h = 16 + Math.random() * 4;
    const w = 26 + Math.random() * 8;
    const color = CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
    obstacles.push({ x: canvas.width, y: GROUND_Y - h, w, h, type, color });
    return;
  }

  if (type === 'phoneBooth') {
    const h = 24 + Math.random() * 6;
    const w = 12 + Math.random() * 3;
    obstacles.push({ x: canvas.width, y: GROUND_Y - h, w, h, type });
    return;
  }

  // hydrant - small and easy, same role as the fox: a quick low obstacle
  const h = 10 + Math.random() * 4;
  const w = 9 + Math.random() * 2;
  obstacles.push({ x: canvas.width, y: GROUND_Y - h, w, h, type });
}

function spawnDuck() {
  // A long hanging branch: you must stay squatted (blink) for the whole
  // time it crosses, not just a single frame.
  const h = 8 + Math.random() * 6;
  const w = 50 + Math.random() * 30;
  const bottom = 136;
  obstacles.push({ x: canvas.width, y: bottom - h, w, h, type: 'branch' });
}

function spawnObstacle() {
  let category = pickCategory();

  const recentNoJump = obstacles.some((o) => canvas.width - o.x < 90 && NO_JUMP_TYPES.has(o.type));
  const recentGround = obstacles.some((o) => canvas.width - o.x < 90 && !NO_JUMP_TYPES.has(o.type));
  if (category === 'ground' && recentNoJump) {
    category = Math.random() < 0.6 ? 'flyer' : 'duck';
  } else if (category !== 'ground' && recentGround) {
    category = 'ground';
  }

  if (category === 'ground') spawnGround(pickGroundType());
  else if (category === 'flyer') spawnFlyer(pickFlyerType());
  else spawnDuck();
}

function update() {
  if (gameOver) {
    gameOverTimer += 1;
    if (jumpRequested && gameOverTimer > RESTART_DELAY) resetGame();
    jumpRequested = false;
    return;
  }

  // Smiling while squatted just stands the spider back up - it does not
  // also jump. A second smile (now that it's standing) jumps normally.
  if (jumpRequested && !jumping) {
    if (squatting) {
      squatting = false;
    } else {
      velocityY = -(MIN_JUMP + jumpPower * (MAX_JUMP - MIN_JUMP));
      jumping = true;
    }
  }
  jumpRequested = false;

  velocityY += GRAVITY;
  charY += velocityY;
  if (charY >= GROUND_Y - CHAR_H) {
    charY = GROUND_Y - CHAR_H;
    velocityY = 0;
    if (jumping) landSquashTimer = LAND_SQUASH_FRAMES;
    jumping = false;
  }
  if (landSquashTimer > 0) landSquashTimer -= 1;

  const squatNow = squatting && !jumping;

  const speed = Math.min(MAX_SPEED, BASE_SPEED + score * SPEED_RAMP);

  // Day/night keeps cycling off score (not speed, which caps out), so the
  // game doesn't get stuck in permanent night once at top speed.
  const cyclePos = score % (PHASE_LEN * 2);
  dayT = (1 - Math.cos((Math.PI * cyclePos) / PHASE_LEN)) / 2;

  // biomeBlend ramps 0->1 approaching a forest->city switch and 1->0
  // approaching a city->forest switch, so there's a long stretch of mixed
  // scenery (trees and buildings together) around each era boundary
  // instead of a hard cut.
  const erasPos = score % (ERA_LEN * 2);
  const inForestEra = erasPos < ERA_LEN;
  biome = inForestEra ? 'forest' : 'city';
  const distToBoundary = inForestEra ? ERA_LEN - erasPos : ERA_LEN * 2 - erasPos;
  if (distToBoundary < TRANSITION_LEN) {
    const t = 1 - distToBoundary / TRANSITION_LEN;
    const eased = t * t * (3 - 2 * t);
    biomeBlend = inForestEra ? eased : 1 - eased;
  } else {
    biomeBlend = inForestEra ? 0 : 1;
  }

  bgFar += speed * 0.15;
  bgMid += speed * 0.4;
  bgNear += speed;
  bgCloud += speed * 0.05;

  spawnTimer -= 1;
  if (spawnTimer <= 0) {
    spawnObstacle();
    const interval = Math.max(35, 90 - speed * 10);
    spawnTimer = interval + Math.random() * interval;
  }

  obstacles.forEach((o) => (o.x -= speed));
  obstacles = obstacles.filter((o) => o.x + o.w > 0);

  if (invulnTimer > 0) invulnTimer -= 1;
  if (hitFlashTimer > 0) hitFlashTimer -= 1;

  const charBox = squatNow
    ? { x: CHAR_X, y: GROUND_Y - SQUAT_H, w: CHAR_W, h: SQUAT_H }
    : { x: CHAR_X, y: charY, w: CHAR_W, h: CHAR_H };

  let hit = false;
  if (invulnTimer <= 0) {
    for (const o of obstacles) {
      if (
        charBox.x < o.x + o.w &&
        charBox.x + charBox.w > o.x &&
        charBox.y < o.y + o.h &&
        charBox.y + charBox.h > o.y
      ) {
        hit = true;
        break;
      }
    }
  }

  if (hit) {
    spawnExplosion(charBox.x + charBox.w / 2, charBox.y + charBox.h / 2);
    if (lives > 0) {
      lives -= 1;
      invulnTimer = INVULN_FRAMES;
      hitFlashTimer = HIT_FLASH_FRAMES;
    } else {
      gameOver = true;
    }
  }

  particles.forEach((p) => {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.15;
    p.rotation += p.rotSpeed;
    p.life -= 1;
  });
  particles = particles.filter((p) => p.life > 0);

  score += 1;

  if (gameOver && score > highScore) {
    highScore = score;
    localStorage.setItem(HIGH_SCORE_KEY, String(highScore));
  }
}

function drawTiled(unitWidth, offset, drawUnit) {
  const startX = -(((offset % unitWidth) + unitWidth) % unitWidth);
  for (let x = startX; x < canvas.width + unitWidth; x += unitWidth) {
    const tileIndex = Math.round((x + offset) / unitWidth);
    drawUnit(x, tileIndex);
  }
}

function hashRand(seed) {
  const v = Math.sin(seed * 12.9898) * 43758.5453;
  return v - Math.floor(v);
}

function parseColor(c) {
  if (c[0] === '#') {
    const n = parseInt(c.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = c.match(/[\d.]+/g).map(Number);
  return [m[0], m[1], m[2]];
}

function lerpColor(colorA, colorB, t) {
  const a = parseColor(colorA);
  const b = parseColor(colorB);
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

// Blends a color across both the day/night axis (dayT) and the
// forest/city axis (biomeBlend) in one go, given each of the 4 corners.
function biomeColor(forestDay, forestNight, cityDay, cityNight) {
  const forest = lerpColor(forestDay, forestNight, dayT);
  const city = lerpColor(cityDay, cityNight, dayT);
  return lerpColor(forest, city, biomeBlend);
}

const STARS = Array.from({ length: 18 }, (_, i) => ({
  x: hashRand(i) * 320,
  y: hashRand(i + 90) * (GROUND_Y - 20),
  r: 0.6 + hashRand(i + 180) * 0.8,
}));

function drawSky() {
  const topColor = lerpColor('#79c3ee', '#111b33', dayT);
  const bottomColor = lerpColor('#d9f1df', '#2c3350', dayT);
  const grad = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  grad.addColorStop(0, topColor);
  grad.addColorStop(1, bottomColor);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, GROUND_Y);

  if (dayT < 0.97) {
    ctx.globalAlpha = 1 - dayT;
    ctx.fillStyle = 'rgba(255, 247, 194, 0.9)';
    ctx.beginPath();
    ctx.arc(canvas.width - 36, 30, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  if (dayT > 0.03) {
    ctx.globalAlpha = dayT;
    STARS.forEach((s) => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(s.x, s.y, s.r, s.r);
    });

    ctx.fillStyle = '#eef0e0';
    ctx.beginPath();
    ctx.arc(canvas.width - 36, 28, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(20, 24, 48, 0.9)';
    ctx.beginPath();
    ctx.arc(canvas.width - 31, 24, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  drawTiled(140, bgCloud, (x) => {
    ctx.fillStyle = dayT < 0.5 ? 'rgba(255,255,255,0.85)' : 'rgba(120,130,160,0.5)';
    ctx.beginPath();
    ctx.ellipse(x + 30, 28, 16, 7, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 44, 24, 11, 6, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 18, 24, 10, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawHills() {
  const hillColor = lerpColor('#9fd3a6', '#1f2b3a', dayT);
  drawTiled(90, bgFar, (x) => {
    ctx.fillStyle = hillColor;
    ctx.beginPath();
    ctx.moveTo(x, GROUND_Y);
    ctx.quadraticCurveTo(x + 22, GROUND_Y - 44, x + 45, GROUND_Y);
    ctx.quadraticCurveTo(x + 68, GROUND_Y - 30, x + 90, GROUND_Y);
    ctx.closePath();
    ctx.fill();
  });
}

function drawPineTree(x, r2, r3) {
  const pineColor = r2 < 0.5 ? '#3f8f52' : '#2e6e3f';
  const trunkH = 12 + r3 * 6;
  const scale = 0.85 + r3 * 0.3;

  ctx.fillStyle = '#6b4a30';
  ctx.fillRect(x + 17, GROUND_Y - trunkH, 4, trunkH);

  ctx.fillStyle = pineColor;
  ctx.beginPath();
  ctx.moveTo(x + 19, GROUND_Y - trunkH - 28 * scale);
  ctx.lineTo(x + 19 - 12 * scale, GROUND_Y - trunkH - 4);
  ctx.lineTo(x + 19 + 12 * scale, GROUND_Y - trunkH - 4);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(x + 19, GROUND_Y - trunkH - 20 * scale);
  ctx.lineTo(x + 19 - 10 * scale, GROUND_Y - trunkH + 4);
  ctx.lineTo(x + 19 + 10 * scale, GROUND_Y - trunkH + 4);
  ctx.closePath();
  ctx.fill();
}

function drawRoundTree(x, r2, r3) {
  const crownColor = r2 < 0.2 ? '#cf9a4a' : r2 < 0.6 ? '#5fa85f' : '#7cb86a';
  const trunkH = 10 + r3 * 5;
  const crownR = 11 + r3 * 4;

  ctx.fillStyle = '#6b4a30';
  ctx.fillRect(x + 18, GROUND_Y - trunkH, 3, trunkH);

  ctx.fillStyle = crownColor;
  ctx.beginPath();
  ctx.arc(x + 19, GROUND_Y - trunkH - crownR * 0.6, crownR, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + 19 - crownR * 0.6, GROUND_Y - trunkH - crownR * 0.3, crownR * 0.7, 0, Math.PI * 2);
  ctx.arc(x + 19 + crownR * 0.6, GROUND_Y - trunkH - crownR * 0.3, crownR * 0.7, 0, Math.PI * 2);
  ctx.fill();
}

function drawBush(x, r2) {
  const bushColor = r2 < 0.5 ? '#4f9a56' : '#6bb062';
  ctx.fillStyle = bushColor;
  ctx.beginPath();
  ctx.ellipse(x + 10, GROUND_Y - 6, 9, 7, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 22, GROUND_Y - 7, 10, 8, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 30, GROUND_Y - 5, 7, 6, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawSkyline() {
  const farColor = lerpColor('#b7c3d6', '#141a2b', dayT);
  drawTiled(70, bgFar, (x, idx) => {
    const h = 30 + hashRand(idx) * 50;
    ctx.fillStyle = farColor;
    ctx.fillRect(x + 6, GROUND_Y - h, 58, h);
  });
}

function drawBuilding(x, idx) {
  const r1 = hashRand(idx);
  const r2 = hashRand(idx + 50);
  const r3 = hashRand(idx + 150);
  const r4 = hashRand(idx + 250);
  const h = 36 + r1 * 76;
  const w = 24 + r3 * 18;
  const color = BUILDING_COLORS[Math.floor(r2 * BUILDING_COLORS.length)];
  const style = r4 < 0.28 ? 'tiered' : r4 < 0.52 ? 'antenna' : r4 < 0.72 ? 'rounded' : 'plain';

  ctx.fillStyle = color;
  ctx.fillRect(x + 4, GROUND_Y - h, w, h);
  ctx.lineWidth = 1;
  ctx.strokeStyle = OUTLINE;
  ctx.strokeRect(x + 4, GROUND_Y - h, w, h);

  if (style === 'tiered') {
    const topW = w * 0.6;
    const topH = h * 0.22;
    ctx.fillRect(x + 4 + (w - topW) / 2, GROUND_Y - h - topH, topW, topH);
    ctx.strokeRect(x + 4 + (w - topW) / 2, GROUND_Y - h - topH, topW, topH);
  } else if (style === 'antenna') {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + 4 + w / 2, GROUND_Y - h);
    ctx.lineTo(x + 4 + w / 2, GROUND_Y - h - 10);
    ctx.stroke();
  } else if (style === 'rounded') {
    ctx.beginPath();
    ctx.arc(x + 4 + w / 2, GROUND_Y - h, w / 2, Math.PI, 0);
    ctx.fill();
    ctx.stroke();
  }

  const litChance = dayT > 0.3 ? 0.55 : 0.92;
  let col = 0;
  for (let wx = x + 10; wx < x + 4 + w - 6; wx += 8, col++) {
    let row = 0;
    for (let wy = GROUND_Y - h + 8; wy < GROUND_Y - 6; wy += 12, row++) {
      const lit = dayT > 0.3 && hashRand(idx * 97 + col * 13 + row * 7) < litChance * dayT;
      ctx.fillStyle = lit ? '#ffe9a8' : 'rgba(20, 20, 30, 0.35)';
      ctx.fillRect(wx, wy, 4, 6);
    }
  }
}

function drawMidLayer() {
  drawTiled(44, bgMid, (x, idx) => {
    const isBuilding = hashRand(idx + 999) < biomeBlend;
    if (isBuilding) {
      drawBuilding(x, idx);
      return;
    }
    const r1 = hashRand(idx);
    const r2 = hashRand(idx + 50);
    const r3 = hashRand(idx + 150);
    if (r1 < 0.45) drawPineTree(x, r2, r3);
    else if (r1 < 0.8) drawRoundTree(x, r2, r3);
    else drawBush(x, r2);
  });
}

function drawGroundLayer() {
  ctx.fillStyle = biomeColor('#7a5231', '#7a5231', '#8a8f94', '#2b2e33');
  ctx.fillRect(0, GROUND_Y, canvas.width, canvas.height - GROUND_Y);

  ctx.fillStyle = biomeColor('#4caf50', '#4caf50', '#bfc4c9', '#1c1e22');
  ctx.fillRect(0, GROUND_Y, canvas.width, 4);

  if (biomeBlend < 0.999) {
    ctx.globalAlpha = 1 - biomeBlend;
    ctx.fillStyle = '#39873d';
    drawTiled(10, bgNear, (x) => {
      ctx.fillRect(x, GROUND_Y - 2, 2, 4);
      ctx.fillRect(x + 5, GROUND_Y - 3, 2, 5);
    });
    ctx.globalAlpha = 1;
  }

  if (biomeBlend > 0.001) {
    ctx.globalAlpha = biomeBlend;
    ctx.fillStyle = 'rgba(255, 214, 51, 0.8)';
    drawTiled(20, bgNear, (x) => {
      ctx.fillRect(x, GROUND_Y + 10, 10, 2);
    });
    ctx.globalAlpha = 1;
  }
}

function drawBackground() {
  drawSky();

  if (biomeBlend < 0.999) {
    ctx.globalAlpha = 1 - biomeBlend;
    drawHills();
    ctx.globalAlpha = 1;
  }
  if (biomeBlend > 0.001) {
    ctx.globalAlpha = biomeBlend;
    drawSkyline();
    ctx.globalAlpha = 1;
  }

  drawMidLayer();
  drawGroundLayer();

  if (dayT > 0.01) {
    ctx.fillStyle = `rgba(8, 10, 28, ${0.45 * dayT})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

const BLOB_COLOR = '#c0432f';
const BLOB_SHADE = '#7a2318';
const BLOB_INK = '#200a06';

// A fixed irregular silhouette (generated once, not per-frame, so it
// doesn't jitter) and a few hanging ooze drips - gives the blob a lumpy,
// melting look instead of a clean circle.
const BLOB_BUMPS = Array.from({ length: 11 }, (_, i) =>
  i % 2 === 0 ? 0.82 + hashRand(i * 3.7) * 0.16 : 1.04 + hashRand(i * 3.7 + 40) * 0.26
);
const BLOB_DRIPS = [
  { x: -0.5, len: 0.55 },
  { x: 0.05, len: 0.85 },
  { x: 0.55, len: 0.4 },
];

function drawCharacter() {
  const x = CHAR_X;
  const squatNow = squatting && !jumping;
  const y = squatNow ? GROUND_Y - SQUAT_H : charY;
  const h = squatNow ? SQUAT_H : CHAR_H;
  const cx = x + CHAR_W / 2;

  // Squash & stretch: wide+flat squatting, stretched while shooting up or
  // falling fast, squashed again at the hang-time peak of a jump, plus a
  // gentle breathing pulse at rest so the blob never looks fully static.
  let scaleX = 1;
  let scaleY = 1;

  if (squatNow) {
    scaleX = 1.35;
    scaleY = 0.68;
  } else if (jumping) {
    const speedFactor = Math.min(1, Math.abs(velocityY) / 9);
    if (Math.abs(velocityY) < 1.5) {
      scaleX = 1.18;
      scaleY = 0.85;
    } else {
      scaleY = 1 + speedFactor * 0.22;
      scaleX = 1 - speedFactor * 0.14;
    }
  } else {
    const breathe = Math.sin(score * 0.1) * 0.035;
    scaleY = 1 + breathe;
    scaleX = 1 - breathe;
  }

  if (landSquashTimer > 0) {
    const t = landSquashTimer / LAND_SQUASH_FRAMES;
    scaleX += 0.3 * t;
    scaleY -= 0.22 * t;
  }

  const bodyW = CHAR_W * scaleX;
  const bodyH = (h - 4) * scaleY;
  const bodyCy = y + h - bodyH / 2 - 3;
  const rx = bodyW / 2;
  const ry = bodyH / 2;

  // feet
  ctx.fillStyle = BLOB_SHADE;
  ctx.beginPath();
  ctx.ellipse(cx - bodyW * 0.22, y + h - 2, 3 * scaleX, 2.2, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + bodyW * 0.22, y + h - 2, 3 * scaleX, 2.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // ooze drips hanging off the underside
  ctx.fillStyle = BLOB_SHADE;
  BLOB_DRIPS.forEach((d) => {
    const dx = cx + d.x * rx;
    const dripLen = d.len * ry * 0.7;
    const baseY = bodyCy + ry * 0.75;
    ctx.beginPath();
    ctx.moveTo(dx - 1.4, baseY);
    ctx.quadraticCurveTo(dx, baseY + dripLen * 0.6, dx, baseY + dripLen);
    ctx.quadraticCurveTo(dx, baseY + dripLen * 0.6, dx + 1.4, baseY);
    ctx.closePath();
    ctx.fill();
  });

  // jagged, lumpy body instead of a clean circle
  ctx.fillStyle = BLOB_COLOR;
  ctx.lineWidth = 1;
  ctx.strokeStyle = OUTLINE;
  ctx.beginPath();
  BLOB_BUMPS.forEach((r, i) => {
    const angle = (i / BLOB_BUMPS.length) * Math.PI * 2;
    const px = cx + Math.cos(angle) * rx * r;
    const py = bodyCy + Math.sin(angle) * ry * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // sickly mottled patches
  ctx.fillStyle = 'rgba(32, 10, 6, 0.18)';
  ctx.beginPath();
  ctx.ellipse(cx + rx * 0.3, bodyCy + ry * 0.35, rx * 0.22, ry * 0.16, 0.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.beginPath();
  ctx.ellipse(cx - bodyW * 0.18, bodyCy - bodyH * 0.24, bodyW * 0.16, bodyH * 0.12, -0.3, 0, Math.PI * 2);
  ctx.fill();

  // heavy, asymmetric angry brows
  const eyeY = bodyCy - bodyH * 0.06;
  ctx.strokeStyle = BLOB_INK;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - bodyW * 0.3, eyeY - bodyH * 0.26);
  ctx.lineTo(cx - bodyW * 0.07, eyeY - bodyH * 0.1);
  ctx.moveTo(cx + bodyW * 0.3, eyeY - bodyH * 0.28);
  ctx.lineTo(cx + bodyW * 0.09, eyeY - bodyH * 0.14);
  ctx.stroke();

  // glowing, uneven, slit-pupil eyes
  [
    { ex: -0.17, ey: 0, er: 0.105 },
    { ex: 0.2, ey: 0.03, er: 0.075 },
  ].forEach(({ ex, ey, er }) => {
    const exPos = cx + bodyW * ex;
    const eyPos = eyeY + bodyH * ey;
    const erAbs = bodyW * er;

    ctx.fillStyle = 'rgba(255, 60, 40, 0.3)';
    ctx.beginPath();
    ctx.arc(exPos, eyPos, erAbs * 1.7, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#f2e3dc';
    ctx.beginPath();
    ctx.ellipse(exPos, eyPos, erAbs, bodyH * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = BLOB_INK;
    ctx.beginPath();
    ctx.ellipse(exPos, eyPos, erAbs * 0.3, bodyH * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  // jagged fanged mouth
  const mouthY = bodyCy + bodyH * 0.3;
  ctx.fillStyle = BLOB_INK;
  ctx.beginPath();
  ctx.moveTo(cx - bodyW * 0.17, mouthY);
  for (let i = 0; i <= 4; i++) {
    const tx = cx - bodyW * 0.17 + bodyW * 0.34 * (i / 4);
    const ty = mouthY + (i % 2 === 0 ? 3 : -1.5);
    ctx.lineTo(tx, ty);
  }
  ctx.lineTo(cx + bodyW * 0.17, mouthY);
  ctx.closePath();
  ctx.fill();
}

function drawRock(o) {
  const cx = o.x + o.w / 2;
  const cy = o.y + o.h / 2;
  const rx = o.w / 2;
  const ry = o.h / 2;
  ctx.fillStyle = '#8a8a8a';
  ctx.beginPath();
  o.bumps.forEach((r, i) => {
    const angle = (i / o.bumps.length) * Math.PI * 2;
    const px = cx + Math.cos(angle) * rx * r;
    const py = cy + Math.sin(angle) * ry * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();

  ctx.fillStyle = '#b5b5b5';
  ctx.beginPath();
  ctx.ellipse(cx - rx * 0.25, cy - ry * 0.3, rx * 0.3, ry * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawBin(o) {
  ctx.fillStyle = '#596268';
  ctx.fillRect(o.x + 1, o.y + 4, o.w - 2, o.h - 4);
  ctx.lineWidth = 1;
  ctx.strokeStyle = OUTLINE;
  ctx.strokeRect(o.x + 1, o.y + 4, o.w - 2, o.h - 4);

  ctx.fillStyle = '#3f464b';
  ctx.fillRect(o.x, o.y, o.w, 4);
  ctx.strokeRect(o.x, o.y, o.w, 4);

  ctx.fillStyle = '#75808a';
  ctx.fillRect(o.x + 4, o.y + 8, 2, o.h - 12);
  ctx.fillRect(o.x + o.w - 6, o.y + 8, 2, o.h - 12);
}

function drawMonster(o, frame) {
  const bob = Math.sin((frame + o.bobSeed) * 0.2) * 1.2;
  const twitch = Math.sin((frame + o.bobSeed) * 1.7) * 0.5;
  const x = o.x + twitch;
  const y = o.y + bob;
  const cx = x + o.w / 2;
  const cy = y + o.h / 2;
  const rx = o.w / 2;
  const ry = o.h / 2;

  // jagged, irregular silhouette instead of a smooth blob
  ctx.fillStyle = o.color;
  ctx.beginPath();
  o.spikes.forEach((r, i) => {
    const angle = (i / o.spikes.length) * Math.PI * 2;
    const px = cx + Math.cos(angle) * rx * r;
    const py = cy + Math.sin(angle) * ry * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();

  // glowing, asymmetric slit eyes
  const eyeY = cy - o.h * 0.1;
  [
    { ex: cx - o.w * 0.2, er: 3.4 },
    { ex: cx + o.w * 0.26, er: 2.3 },
  ].forEach(({ ex, er }) => {
    ctx.fillStyle = 'rgba(255, 40, 40, 0.35)';
    ctx.beginPath();
    ctx.arc(ex, eyeY, er * 1.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#e8d8d8';
    ctx.beginPath();
    ctx.arc(ex, eyeY, er, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#1a0a0a';
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, er * 0.25, er * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  // jagged fanged maw
  const mouthY = cy + o.h * 0.28;
  ctx.fillStyle = '#140808';
  ctx.beginPath();
  ctx.moveTo(cx - o.w * 0.24, mouthY);
  for (let i = 0; i <= 4; i++) {
    const tx = cx - o.w * 0.24 + (o.w * 0.48) * (i / 4);
    const ty = mouthY + (i % 2 === 0 ? 3 : -1.5);
    ctx.lineTo(tx, ty);
  }
  ctx.lineTo(cx + o.w * 0.24, mouthY);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#eee';
  ctx.beginPath();
  ctx.moveTo(cx - o.w * 0.15, mouthY);
  ctx.lineTo(cx - o.w * 0.1, mouthY + 5);
  ctx.lineTo(cx - o.w * 0.05, mouthY);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + o.w * 0.05, mouthY);
  ctx.lineTo(cx + o.w * 0.1, mouthY + 5);
  ctx.lineTo(cx + o.w * 0.15, mouthY);
  ctx.closePath();
  ctx.fill();
}

function drawSheep(o, frame) {
  const bob = Math.sin((frame + o.bobSeed) * 0.15) * 0.8;
  const x = o.x;
  const y = o.y + bob;
  const cy = y + o.h * 0.45;

  ctx.fillStyle = '#2b2320';
  ctx.fillRect(x + o.w * 0.12, y + o.h * 0.78, 3, o.h * 0.22);
  ctx.fillRect(x + o.w * 0.72, y + o.h * 0.78, 3, o.h * 0.22);

  ctx.fillStyle = '#f5f0e6';
  ctx.lineWidth = 1;
  ctx.strokeStyle = OUTLINE;
  [0.22, 0.4, 0.58, 0.76].forEach((f, i) => {
    ctx.beginPath();
    ctx.ellipse(x + o.w * f, cy - (i % 2 === 0 ? 1.5 : 0), o.w * 0.16, o.h * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.beginPath();
  ctx.ellipse(x + o.w * 0.46, cy, o.w * 0.42, o.h * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#2b2320';
  ctx.beginPath();
  ctx.ellipse(x + o.w * 0.9, cy - o.h * 0.02, o.w * 0.12, o.h * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + o.w * 0.88, cy - o.h * 0.22, o.w * 0.06, o.h * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawWolf(o, frame) {
  const bob = Math.sin((frame + o.bobSeed) * 0.2) * 0.6;
  const x = o.x;
  const y = o.y + bob;
  const bodyColor = '#4a4f55';
  const cy = y + o.h * 0.5;

  ctx.fillStyle = bodyColor;
  [0.15, 0.35, 0.62, 0.82].forEach((f) => {
    ctx.fillRect(x + o.w * f - 1, cy + o.h * 0.18, 2, o.h * 0.42);
  });

  ctx.beginPath();
  ctx.moveTo(x + o.w * 0.04, cy);
  ctx.lineTo(x - o.w * 0.14, cy - o.h * 0.18);
  ctx.lineTo(x + o.w * 0.08, cy + o.h * 0.08);
  ctx.closePath();
  ctx.fill();

  ctx.lineWidth = 1;
  ctx.strokeStyle = OUTLINE;
  ctx.beginPath();
  ctx.ellipse(x + o.w * 0.48, cy, o.w * 0.44, o.h * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(x + o.w * 0.9, cy - o.h * 0.14, o.w * 0.14, o.h * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x + o.w * 0.84, cy - o.h * 0.3);
  ctx.lineTo(x + o.w * 0.79, cy - o.h * 0.48);
  ctx.lineTo(x + o.w * 0.89, cy - o.h * 0.32);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#ffd34d';
  ctx.beginPath();
  ctx.arc(x + o.w * 0.96, cy - o.h * 0.14, 1.2, 0, Math.PI * 2);
  ctx.fill();
}

function drawFox(o, frame) {
  const bob = Math.sin((frame + o.bobSeed) * 0.22) * 0.6;
  const x = o.x;
  const y = o.y + bob;
  const bodyColor = '#d4712f';
  const cy = y + o.h * 0.5;

  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.moveTo(x + o.w * 0.04, cy - o.h * 0.05);
  ctx.quadraticCurveTo(x - o.w * 0.28, cy - o.h * 0.12, x - o.w * 0.1, cy + o.h * 0.28);
  ctx.quadraticCurveTo(x + o.w * 0.08, cy + o.h * 0.14, x + o.w * 0.05, cy);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fdf3e4';
  ctx.beginPath();
  ctx.ellipse(x - o.w * 0.14, cy + o.h * 0.2, o.w * 0.07, o.h * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#2b2320';
  [0.22, 0.42, 0.6, 0.8].forEach((f) => {
    ctx.fillRect(x + o.w * f - 1, cy + o.h * 0.16, 2, o.h * 0.34);
  });

  ctx.fillStyle = bodyColor;
  ctx.lineWidth = 1;
  ctx.strokeStyle = OUTLINE;
  ctx.beginPath();
  ctx.ellipse(x + o.w * 0.46, cy, o.w * 0.4, o.h * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#fdf3e4';
  ctx.beginPath();
  ctx.ellipse(x + o.w * 0.72, cy + o.h * 0.1, o.w * 0.14, o.h * 0.15, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.ellipse(x + o.w * 0.88, cy - o.h * 0.1, o.w * 0.12, o.h * 0.15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + o.w * 0.82, cy - o.h * 0.22);
  ctx.lineTo(x + o.w * 0.78, cy - o.h * 0.4);
  ctx.lineTo(x + o.w * 0.87, cy - o.h * 0.25);
  ctx.closePath();
  ctx.fill();
}

function drawElephant(o, frame) {
  const bob = Math.sin((frame + o.bobSeed) * 0.13) * 0.6;
  const x = o.x;
  const y = o.y + bob;
  const bodyColor = '#9099a0';
  const cy = y + o.h * 0.42;

  ctx.fillStyle = '#767f86';
  [0.12, 0.3, 0.62, 0.8].forEach((f) => {
    ctx.fillRect(x + o.w * f - 2, y + o.h * 0.6, 5, o.h * 0.4);
  });

  ctx.fillStyle = bodyColor;
  ctx.lineWidth = 1;
  ctx.strokeStyle = OUTLINE;
  ctx.beginPath();
  ctx.ellipse(x + o.w * 0.46, cy, o.w * 0.46, o.h * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(x + o.w * 0.76, cy - o.h * 0.04, o.w * 0.18, o.h * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(x + o.w * 0.88, cy - o.h * 0.06, o.w * 0.14, o.h * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = bodyColor;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x + o.w * 0.96, cy - o.h * 0.02);
  ctx.quadraticCurveTo(x + o.w * 1.04, cy + o.h * 0.26, x + o.w * 0.92, cy + o.h * 0.34);
  ctx.stroke();

  ctx.strokeStyle = '#eee';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x + o.w * 0.92, cy + o.h * 0.06);
  ctx.lineTo(x + o.w * 0.98, cy + o.h * 0.15);
  ctx.stroke();
}

function drawCar(o) {
  const x = o.x;
  const y = o.y;

  ctx.fillStyle = '#1a1512';
  ctx.beginPath();
  ctx.arc(x + o.w * 0.26, y + o.h, o.h * 0.22, 0, Math.PI * 2);
  ctx.arc(x + o.w * 0.78, y + o.h, o.h * 0.22, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = o.color;
  ctx.beginPath();
  ctx.moveTo(x + 2, y + o.h);
  ctx.lineTo(x + 2, y + o.h * 0.55);
  ctx.quadraticCurveTo(x + o.w * 0.14, y + o.h * 0.12, x + o.w * 0.36, y + o.h * 0.12);
  ctx.lineTo(x + o.w * 0.64, y + o.h * 0.12);
  ctx.quadraticCurveTo(x + o.w * 0.88, y + o.h * 0.12, x + o.w - 2, y + o.h * 0.55);
  ctx.lineTo(x + o.w - 2, y + o.h);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();

  ctx.fillStyle = 'rgba(180, 222, 255, 0.85)';
  ctx.fillRect(x + o.w * 0.34, y + o.h * 0.2, o.w * 0.32, o.h * 0.26);

  ctx.fillStyle = '#ffe9a8';
  ctx.beginPath();
  ctx.arc(x + o.w - 3, y + o.h * 0.68, 1.6, 0, Math.PI * 2);
  ctx.fill();
}

function drawPhoneBooth(o) {
  const x = o.x;
  const y = o.y;

  ctx.fillStyle = '#b23a2e';
  ctx.fillRect(x + 2, y + 5, o.w - 4, o.h - 5);
  ctx.lineWidth = 1;
  ctx.strokeStyle = OUTLINE;
  ctx.strokeRect(x + 2, y + 5, o.w - 4, o.h - 5);

  ctx.fillStyle = '#8a2a20';
  ctx.fillRect(x, y, o.w, 5);
  ctx.strokeRect(x, y, o.w, 5);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = 0.8;
  for (let i = 1; i < 3; i++) {
    const lx = x + 2 + ((o.w - 4) * i) / 3;
    ctx.beginPath();
    ctx.moveTo(lx, y + 7);
    ctx.lineTo(lx, y + o.h - 2);
    ctx.stroke();
  }

  ctx.fillStyle = '#fff';
  ctx.fillRect(x + o.w * 0.5 - 1, y + o.h * 0.55, 2, 2);
}

function drawHydrant(o) {
  const x = o.x;
  const y = o.y;

  ctx.fillStyle = '#8a2a20';
  ctx.beginPath();
  ctx.arc(x + o.w * 0.12, y + o.h * 0.5, o.w * 0.14, 0, Math.PI * 2);
  ctx.arc(x + o.w * 0.88, y + o.h * 0.5, o.w * 0.14, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#c0392b';
  ctx.fillRect(x + o.w * 0.26, y + o.h * 0.22, o.w * 0.48, o.h * 0.68);
  ctx.lineWidth = 1;
  ctx.strokeStyle = OUTLINE;
  ctx.strokeRect(x + o.w * 0.26, y + o.h * 0.22, o.w * 0.48, o.h * 0.68);

  ctx.beginPath();
  ctx.ellipse(x + o.w * 0.5, y + o.h * 0.08, o.w * 0.2, o.h * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function fillStroke() {
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
}

function drawWingBird(o, frame, bodyColor, beakColor) {
  const up = Math.floor((frame + o.flapSeed) / o.flapInterval) % 2 === 0;
  const cx = o.x + o.w / 2;
  const cy = o.y + o.h / 2;

  ctx.beginPath();
  if (up) {
    ctx.moveTo(cx - o.w * 0.15, cy);
    ctx.lineTo(cx - o.w * 0.55, cy - o.h * 0.6);
    ctx.lineTo(cx - o.w * 0.1, cy - o.h * 0.1);
  } else {
    ctx.moveTo(cx - o.w * 0.15, cy);
    ctx.lineTo(cx - o.w * 0.55, cy + o.h * 0.5);
    ctx.lineTo(cx - o.w * 0.1, cy + o.h * 0.1);
  }
  ctx.closePath();
  ctx.fillStyle = bodyColor;
  fillStroke();

  ctx.beginPath();
  if (up) {
    ctx.moveTo(cx + o.w * 0.15, cy);
    ctx.lineTo(cx + o.w * 0.55, cy - o.h * 0.6);
    ctx.lineTo(cx + o.w * 0.1, cy - o.h * 0.1);
  } else {
    ctx.moveTo(cx + o.w * 0.15, cy);
    ctx.lineTo(cx + o.w * 0.55, cy + o.h * 0.5);
    ctx.lineTo(cx + o.w * 0.1, cy + o.h * 0.1);
  }
  ctx.closePath();
  ctx.fillStyle = bodyColor;
  fillStroke();

  ctx.beginPath();
  ctx.ellipse(cx, cy, o.w * 0.3, o.h * 0.38, 0, 0, Math.PI * 2);
  ctx.fillStyle = bodyColor;
  fillStroke();

  ctx.fillStyle = beakColor;
  ctx.beginPath();
  ctx.moveTo(cx + o.w * 0.3, cy);
  ctx.lineTo(cx + o.w * 0.48, cy + 1.5);
  ctx.lineTo(cx + o.w * 0.3, cy + 3);
  ctx.closePath();
  ctx.fill();
}

function drawSparrow(o, frame) {
  drawWingBird(o, frame, o.color || '#5b8fd6', '#e8963a');
}

function drawCrow(o, frame) {
  drawWingBird(o, frame, '#2b2a28', '#5a5a5a');
}

function drawDragon(o, frame) {
  const up = Math.floor((frame + o.flapSeed) / o.flapInterval) % 2 === 0;
  const cx = o.x + o.w / 2;
  const cy = o.y + o.h / 2;
  const bodyColor = '#4a9b5e';
  const wingColor = '#2f6e42';

  ctx.beginPath();
  const wingY = up ? cy - o.h * 0.75 : cy + o.h * 0.3;
  ctx.moveTo(cx - o.w * 0.1, cy - o.h * 0.1);
  ctx.lineTo(cx - o.w * 0.5, wingY);
  ctx.lineTo(cx - o.w * 0.35, cy + o.h * 0.1);
  ctx.lineTo(cx - o.w * 0.15, cy + o.h * 0.15);
  ctx.closePath();
  ctx.fillStyle = wingColor;
  fillStroke();

  ctx.beginPath();
  ctx.moveTo(cx + o.w * 0.1, cy - o.h * 0.1);
  ctx.lineTo(cx + o.w * 0.5, wingY);
  ctx.lineTo(cx + o.w * 0.35, cy + o.h * 0.1);
  ctx.lineTo(cx + o.w * 0.15, cy + o.h * 0.15);
  ctx.closePath();
  ctx.fillStyle = wingColor;
  fillStroke();

  // tail
  ctx.beginPath();
  ctx.moveTo(cx - o.w * 0.35, cy + o.h * 0.1);
  ctx.lineTo(cx - o.w * 0.55, cy + o.h * 0.05);
  ctx.lineTo(cx - o.w * 0.35, cy + o.h * 0.3);
  ctx.closePath();
  ctx.fillStyle = bodyColor;
  fillStroke();

  // body
  ctx.beginPath();
  ctx.ellipse(cx, cy, o.w * 0.3, o.h * 0.3, 0, 0, Math.PI * 2);
  ctx.fillStyle = bodyColor;
  fillStroke();

  // underbelly
  ctx.fillStyle = '#d67a5b';
  ctx.beginPath();
  ctx.ellipse(cx, cy + o.h * 0.12, o.w * 0.2, o.h * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();

  // head
  ctx.beginPath();
  ctx.ellipse(cx + o.w * 0.34, cy - o.h * 0.05, o.w * 0.14, o.h * 0.2, 0, 0, Math.PI * 2);
  ctx.fillStyle = bodyColor;
  fillStroke();

  // horn
  ctx.beginPath();
  ctx.moveTo(cx + o.w * 0.3, cy - o.h * 0.22);
  ctx.lineTo(cx + o.w * 0.36, cy - o.h * 0.4);
  ctx.lineTo(cx + o.w * 0.4, cy - o.h * 0.2);
  ctx.closePath();
  ctx.fillStyle = '#e8d6a0';
  fillStroke();

  // eye
  ctx.fillStyle = '#20231f';
  ctx.beginPath();
  ctx.arc(cx + o.w * 0.4, cy - o.h * 0.08, 1.3, 0, Math.PI * 2);
  ctx.fill();
}

function drawBranch(o) {
  // thorny hanging branch, anchored by vines off the top of the screen
  ctx.strokeStyle = '#3c2a1a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(o.x + 4, o.y);
  ctx.lineTo(o.x + 4, 0);
  ctx.moveTo(o.x + o.w - 4, o.y);
  ctx.lineTo(o.x + o.w - 4, 0);
  ctx.stroke();

  ctx.fillStyle = '#5a3c26';
  ctx.fillRect(o.x, o.y, o.w, o.h);
  ctx.lineWidth = 1;
  ctx.strokeStyle = OUTLINE;
  ctx.strokeRect(o.x, o.y, o.w, o.h);

  ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.lineWidth = 1;
  for (let i = 1; i < Math.floor(o.w / 10); i++) {
    const lx = o.x + i * 10;
    ctx.beginPath();
    ctx.moveTo(lx, o.y + 1);
    ctx.lineTo(lx, o.y + o.h - 1);
    ctx.stroke();
  }

  ctx.fillStyle = '#3c2a1a';
  for (let tx = o.x + 4; tx < o.x + o.w - 4; tx += 9) {
    ctx.beginPath();
    ctx.moveTo(tx, o.y + o.h);
    ctx.lineTo(tx + 3, o.y + o.h + 5);
    ctx.lineTo(tx + 6, o.y + o.h);
    ctx.closePath();
    ctx.fill();
  }
}

function drawParticles() {
  particles.forEach((p) => {
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
    ctx.restore();
  });
}

function drawObstacle(o, frame) {
  if (o.type === 'rock') drawRock(o);
  else if (o.type === 'bin') drawBin(o);
  else if (o.type === 'monster') drawMonster(o, frame);
  else if (o.type === 'sheep') drawSheep(o, frame);
  else if (o.type === 'wolf') drawWolf(o, frame);
  else if (o.type === 'fox') drawFox(o, frame);
  else if (o.type === 'elephant') drawElephant(o, frame);
  else if (o.type === 'car') drawCar(o);
  else if (o.type === 'phoneBooth') drawPhoneBooth(o);
  else if (o.type === 'hydrant') drawHydrant(o);
  else if (o.type === 'sparrow') drawSparrow(o, frame);
  else if (o.type === 'crow') drawCrow(o, frame);
  else if (o.type === 'dragon') drawDragon(o, frame);
  else if (o.type === 'branch') drawBranch(o);
}

function draw() {
  drawBackground();

  obstacles.forEach((o) => drawObstacle(o, score));

  const flashHidden = invulnTimer > 0 && Math.floor(invulnTimer / 4) % 2 === 0;
  if (!flashHidden) drawCharacter();

  drawParticles();

  if (hitFlashTimer > 0) {
    ctx.fillStyle = `rgba(220, 40, 40, ${0.35 * (hitFlashTimer / HIT_FLASH_FRAMES)})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.fillStyle = '#20231f';
  ctx.font = '10px monospace';
  const scoreText = `Score: ${score}`;
  ctx.fillText(scoreText, 6, 12);

  const heartsX = 6 + ctx.measureText(scoreText).width + 8;
  ctx.font = '11px sans-serif';
  for (let i = 0; i < MAX_LIVES; i++) {
    ctx.fillStyle = i < lives ? '#e0455c' : 'rgba(255, 255, 255, 0.4)';
    ctx.fillText(i < lives ? '♥' : '♡', heartsX + i * 12, 12);
  }

  if (gameOver) {
    const isNewRecord = score > 0 && score === highScore;
    const ready = gameOverTimer > RESTART_DELAY;
    const cx = canvas.width / 2;

    ctx.save();
    ctx.fillStyle = 'rgba(8, 10, 20, 0.8)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.textAlign = 'center';

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 15px monospace';
    ctx.fillText('GAME OVER', cx, 42);

    ctx.fillStyle = '#ffd34d';
    ctx.font = 'bold 26px monospace';
    ctx.fillText(String(score), cx, 76);

    ctx.fillStyle = '#cfd8e3';
    ctx.font = '10px monospace';
    ctx.fillText(`Best: ${highScore}`, cx, 94);

    if (isNewRecord) {
      ctx.fillStyle = '#4caf50';
      ctx.font = 'bold 10px monospace';
      ctx.fillText('NEW RECORD!', cx, 108);
    }

    ctx.fillStyle = ready ? '#9be89b' : '#777';
    ctx.font = '10px monospace';
    ctx.fillText(ready ? 'Smile to restart' : 'Get ready…', cx, 146);

    ctx.restore();
  }
}

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true });
  video.srcObject = stream;
}

async function initFaceLandmarker() {
  const filesetResolver = await FilesetResolver.forVisionTasks('./vendor/tasks-vision/wasm');
  return FaceLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath: './models/face_landmarker.task',
      delegate: 'GPU',
    },
    outputFaceBlendshapes: true,
    runningMode: 'VIDEO',
    numFaces: 1,
  });
}

(async () => {
  try {
    await startCamera();
    statusEl.textContent = 'Loading smile detector...';
    const faceLandmarker = await initFaceLandmarker();
    statusEl.textContent = 'Smile to jump • stay still under birds & dragons 🐦🐉 • tilt your head down to squat under branches';
    setTimeout(() => {
      statusEl.textContent = '';
    }, 4500);

    const tick = () => {
      if (video.readyState >= 2) {
        const result = faceLandmarker.detectForVideo(video, performance.now());
        const blendshapes = result.faceBlendshapes[0];
        const score = blendshapes ? smileScore(blendshapes) : 0;
        smileBarFill.style.width = `${Math.round(score * 100)}%`;

        const isSmilingNow = score > SMILE_THRESHOLD;
        if (isSmilingNow && !prevSmiling) {
          jumpRequested = true;
          jumpPower = score;
        }
        prevSmiling = isSmilingNow;

        const landmarks = result.faceLandmarks[0];
        const tiltDelta = updateTilt(landmarks);
        tiltBarFill.style.width = `${Math.max(0, Math.min(100, Math.round((tiltDelta / TILT_ENTER_DELTA) * 100)))}%`;
        tiltBarFill.classList.toggle('active', squatting);
      }

      update();
      draw();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  }
})();
