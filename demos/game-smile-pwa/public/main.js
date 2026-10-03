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
let walkFrame = 0;
let walkTimer = 0;

let obstacles = [];
let spawnTimer = 60;
let score = 0;
let gameOver = false;
let gameOverTimer = 0;

let pickups = [];
let pickupSpawnTimer = 240;
let speedPenalty = 0;

const SHIELD_FRAMES = 180;
let shieldTimer = 0;
const SPEED_PENALTY_DECAY = 0.01;
const MAX_SPEED_PENALTY = 8;
const MIN_SPEED = 0.6;

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
  particles = [];
  pickups = [];
  pickupSpawnTimer = 240;
  speedPenalty = 0;
  shieldTimer = 0;
}

const EXPLOSION_COLORS = ['#2e2440', '#c0392b', '#4a3a66', '#1a1512'];
const PICKUP_EXPLOSION_COLORS = {
  points: ['#ffe066', '#ffbf3f', '#fff6d6'],
  slow: ['#8fd9ff', '#4fb3e0', '#eaf9ff'],
  shield: ['#baffc9', '#5fd98a', '#eafff0'],
};

function spawnExplosion(cx, cy, colors = EXPLOSION_COLORS, count = 14, opts = {}) {
  const { round = false, speedMul = 1, sizeMul = 1 } = opts;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (1 + Math.random() * 2.5) * speedMul;
    const life = 20 + Math.random() * 12;
    particles.push({
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1,
      size: (1.5 + Math.random() * 2.5) * sizeMul,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.6,
      life,
      maxLife: life,
      round,
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

function spawnPickup() {
  const r = Math.random();
  const type = r < 0.55 ? 'points' : r < 0.85 ? 'slow' : 'shield';

  const w = 14;
  const h = 14;
  // Float roughly at standing chest-height, with a little jitter, so
  // collecting them is a reward for being on the ground - not an extra
  // precision-jump challenge on top of the obstacles.
  const standingCy = GROUND_Y - CHAR_H / 2;
  const y = standingCy - h / 2 + (Math.random() * 10 - 5);

  const pickup = { x: canvas.width, y, w, h, type, bobSeed: Math.random() * 10 };
  if (type === 'points') pickup.value = 50 + Math.floor(Math.random() * 51);
  else if (type === 'slow') pickup.value = -(1 + Math.floor(Math.random() * 5));

  pickups.push(pickup);
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
    jumping = false;
  }

  const squatNow = squatting && !jumping;

  const speed = Math.max(
    MIN_SPEED,
    Math.min(MAX_SPEED, BASE_SPEED + score * SPEED_RAMP) - speedPenalty
  );
  speedPenalty = Math.max(0, speedPenalty - SPEED_PENALTY_DECAY);

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

  pickupSpawnTimer -= 1;
  if (pickupSpawnTimer <= 0) {
    spawnPickup();
    pickupSpawnTimer = 360 + Math.random() * 240;
  }

  obstacles.forEach((o) => (o.x -= speed));
  obstacles = obstacles.filter((o) => o.x + o.w > 0);

  pickups.forEach((p) => (p.x -= speed));
  pickups = pickups.filter((p) => p.x + p.w > 0);

  if (invulnTimer > 0) invulnTimer -= 1;
  if (hitFlashTimer > 0) hitFlashTimer -= 1;
  if (shieldTimer > 0) shieldTimer -= 1;

  const charBox = squatNow
    ? { x: CHAR_X, y: GROUND_Y - SQUAT_H, w: CHAR_W, h: SQUAT_H }
    : { x: CHAR_X, y: charY, w: CHAR_W, h: CHAR_H };

  let hit = false;
  if (invulnTimer <= 0 && shieldTimer <= 0) {
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

  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    if (
      charBox.x < p.x + p.w &&
      charBox.x + charBox.w > p.x &&
      charBox.y < p.y + p.h &&
      charBox.y + charBox.h > p.y
    ) {
      if (p.type === 'points') score += p.value;
      else if (p.type === 'slow') speedPenalty = Math.min(MAX_SPEED_PENALTY, speedPenalty + Math.abs(p.value));
      else if (p.type === 'shield') shieldTimer = SHIELD_FRAMES;

      spawnExplosion(p.x + p.w / 2, p.y + p.h / 2, PICKUP_EXPLOSION_COLORS[p.type], 16, {
        round: true,
        speedMul: 1.4,
        sizeMul: 0.8,
      });

      pickups.splice(i, 1);
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

  if (!jumping) {
    walkTimer += 1;
    if (walkTimer > 8) {
      walkTimer = 0;
      walkFrame = 1 - walkFrame;
    }
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

function drawSpiderLeg(attachX, attachY, dir, reach, spread, lift) {
  const kneeX = attachX + dir * spread * 0.5;
  const kneeY = attachY + reach * 0.45 - lift;
  const footX = attachX + dir * spread;
  const footY = attachY + reach;

  ctx.beginPath();
  ctx.moveTo(attachX, attachY);
  ctx.lineTo(kneeX, kneeY);
  ctx.lineTo(footX, footY);
  ctx.stroke();
}

function drawCharacter() {
  const x = CHAR_X;
  const squatNow = squatting && !jumping;
  const y = squatNow ? GROUND_Y - SQUAT_H : charY;
  const cx = x + 8;
  const bodyColor = '#2e2440';

  const tucked = jumping;
  const reach = squatNow ? 4 : tucked ? 5 : 9;
  const spread = squatNow ? 7 : tucked ? 2 : 5;
  const legAttachY = squatNow ? y + 5 : y + 11;
  const bodyCy = squatNow ? y + 4 : y + 10;
  const headCy = squatNow ? y + 3 : y + 8;
  const phase = walkFrame === 0 ? 1 : -1;

  ctx.strokeStyle = bodyColor;
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';

  const backXs = [cx - 6, cx - 3, cx];
  const frontXs = [cx + 1, cx + 4, cx + 7];

  backXs.forEach((ax, i) => {
    const lift = squatNow ? 0 : tucked ? 2 : (i % 2 === 0 ? phase : -phase) * 1.5;
    drawSpiderLeg(ax, legAttachY, -1, reach, spread, lift);
  });
  frontXs.forEach((ax, i) => {
    const lift = squatNow ? 0 : tucked ? 2 : (i % 2 === 0 ? -phase : phase) * 1.5;
    drawSpiderLeg(ax, legAttachY, 1, reach, spread, lift);
  });

  // abdomen (squashed flat when squatting)
  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.ellipse(cx - 2, bodyCy, squatNow ? 6.5 : 5.5, squatNow ? 3 : 4.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // head
  ctx.beginPath();
  ctx.ellipse(cx + 4.5, headCy, squatNow ? 3.4 : 3.2, squatNow ? 2.2 : 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // eyes
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(cx + 5.3, headCy - 1, 1, 0, Math.PI * 2);
  ctx.arc(cx + 6.3, headCy + 0.3, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1a1512';
  ctx.beginPath();
  ctx.arc(cx + 5.3, headCy - 1, 0.5, 0, Math.PI * 2);
  ctx.arc(cx + 6.3, headCy + 0.3, 0.5, 0, Math.PI * 2);
  ctx.fill();

  // abdomen marking
  ctx.fillStyle = '#c0392b';
  ctx.beginPath();
  ctx.arc(cx - 2, bodyCy, 1.3, 0, Math.PI * 2);
  ctx.fill();
}

function drawRock(o) {
  const cx = o.x + o.w / 2;
  const cy = o.y + o.h / 2;
  const rx = o.w / 2;
  const ry = o.h / 2;

  const pts = o.bumps.map((r, i) => {
    const angle = (i / o.bumps.length) * Math.PI * 2;
    return { x: cx + Math.cos(angle) * rx * r, y: cy + Math.sin(angle) * ry * r };
  });

  ctx.fillStyle = '#7d7d7d';
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();

  // lit upper-left face vs shaded lower-right face, so it reads as a solid
  // mass instead of a flat lumpy outline
  ctx.save();
  ctx.clip();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.beginPath();
  ctx.moveTo(cx - rx, cy);
  ctx.lineTo(cx - rx, cy - ry * 1.2);
  ctx.lineTo(cx + rx * 0.3, cy - ry * 1.2);
  ctx.lineTo(cx - rx * 0.2, cy);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(30, 25, 20, 0.22)';
  ctx.beginPath();
  ctx.moveTo(cx + rx * 0.1, cy + ry * 0.1);
  ctx.lineTo(cx + rx, cy - ry * 0.2);
  ctx.lineTo(cx + rx, cy + ry * 1.2);
  ctx.lineTo(cx - rx * 0.3, cy + ry * 1.2);
  ctx.closePath();
  ctx.fill();

  // crack lines
  ctx.strokeStyle = 'rgba(30, 25, 20, 0.5)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(cx - rx * 0.1, cy - ry * 0.6);
  ctx.lineTo(cx + rx * 0.15, cy - ry * 0.05);
  ctx.lineTo(cx - rx * 0.05, cy + ry * 0.5);
  ctx.stroke();

  // moss patches clinging to the base
  ctx.fillStyle = 'rgba(90, 140, 70, 0.55)';
  ctx.beginPath();
  ctx.ellipse(cx - rx * 0.4, cy + ry * 0.55, rx * 0.3, ry * 0.18, 0.2, 0, Math.PI * 2);
  ctx.ellipse(cx + rx * 0.3, cy + ry * 0.7, rx * 0.22, ry * 0.14, -0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.beginPath();
  ctx.ellipse(cx - rx * 0.3, cy - ry * 0.35, rx * 0.22, ry * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawBin(o) {
  const x = o.x;
  const y = o.y;

  // tapered body (narrower base) reads more like a bin than a plain box
  ctx.fillStyle = '#596268';
  ctx.beginPath();
  ctx.moveTo(x + 1, y + 4);
  ctx.lineTo(x + o.w - 1, y + 4);
  ctx.lineTo(x + o.w - 2, y + o.h);
  ctx.lineTo(x + 2, y + o.h);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();

  // corrugated ridges down the body
  ctx.strokeStyle = 'rgba(20, 20, 24, 0.3)';
  ctx.lineWidth = 0.8;
  for (let i = 1; i < 4; i++) {
    const lx = x + 2 + ((o.w - 4) * i) / 4;
    ctx.beginPath();
    ctx.moveTo(lx, y + 6);
    ctx.lineTo(lx - 0.6, y + o.h - 1);
    ctx.stroke();
  }

  // shaded right-hand side for volume
  ctx.fillStyle = 'rgba(20, 20, 24, 0.25)';
  ctx.beginPath();
  ctx.moveTo(x + o.w * 0.65, y + 4);
  ctx.lineTo(x + o.w - 1, y + 4);
  ctx.lineTo(x + o.w - 2, y + o.h);
  ctx.lineTo(x + o.w * 0.6, y + o.h);
  ctx.closePath();
  ctx.fill();

  // domed, slightly askew lid
  ctx.fillStyle = '#3f464b';
  ctx.beginPath();
  ctx.moveTo(x, y + 5);
  ctx.quadraticCurveTo(x + o.w / 2, y - 3, x + o.w, y + 5);
  ctx.lineTo(x + o.w, y + 6.5);
  ctx.quadraticCurveTo(x + o.w / 2, y + 1.5, x, y + 6.5);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();

  ctx.fillStyle = '#75808a';
  ctx.beginPath();
  ctx.ellipse(x + o.w * 0.4, y + 1.5, o.w * 0.18, 1.6, 0, 0, Math.PI * 2);
  ctx.fill();

  // handle + rim highlights
  ctx.fillStyle = '#20231f';
  ctx.fillRect(x + o.w / 2 - 2, y + 2, 4, 1.4);

  ctx.fillStyle = '#75808a';
  ctx.fillRect(x + 3, y + 9, 1.4, o.h - 13);
  ctx.fillRect(x + o.w - 5, y + 9, 1.4, o.h - 13);

  // grime streaks + a dent for wear
  ctx.strokeStyle = 'rgba(20, 20, 24, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + o.w * 0.3, y + 10);
  ctx.lineTo(x + o.w * 0.26, y + o.h - 2);
  ctx.stroke();

  ctx.fillStyle = 'rgba(20, 20, 24, 0.3)';
  ctx.beginPath();
  ctx.arc(x + o.w * 0.72, y + o.h * 0.6, 2, 0, Math.PI * 2);
  ctx.fill();
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

  // hooved legs with a shin shade
  ctx.fillStyle = '#4a4038';
  ctx.fillRect(x + o.w * 0.12, y + o.h * 0.78, 3, o.h * 0.22);
  ctx.fillRect(x + o.w * 0.72, y + o.h * 0.78, 3, o.h * 0.22);
  ctx.fillStyle = '#2b2320';
  ctx.fillRect(x + o.w * 0.12, y + o.h * 0.94, 3, o.h * 0.06);
  ctx.fillRect(x + o.w * 0.72, y + o.h * 0.94, 3, o.h * 0.06);

  // lumpy wool body built from overlapping puffs, lit top-left / shaded
  // bottom-right so it reads as rounded fleece, not flat blobs
  ctx.lineWidth = 1;
  ctx.strokeStyle = OUTLINE;
  const puffs = [
    { f: 0.2, dy: -2, r: 0.17 },
    { f: 0.36, dy: -4, r: 0.21 },
    { f: 0.54, dy: -3.5, r: 0.22 },
    { f: 0.7, dy: -1.5, r: 0.19 },
  ];
  ctx.fillStyle = '#f5f0e6';
  puffs.forEach((p) => {
    ctx.beginPath();
    ctx.ellipse(x + o.w * p.f, cy + p.dy, o.w * p.r, o.h * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.beginPath();
  ctx.ellipse(x + o.w * 0.46, cy, o.w * 0.42, o.h * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = 'rgba(210, 195, 165, 0.6)';
  ctx.beginPath();
  ctx.ellipse(x + o.w * 0.5, cy + o.h * 0.16, o.w * 0.3, o.h * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.beginPath();
  ctx.ellipse(x + o.w * 0.32, cy - o.h * 0.18, o.w * 0.14, o.h * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();

  // head: dark face plate, muzzle, ear, eye
  ctx.fillStyle = '#2b2320';
  ctx.beginPath();
  ctx.ellipse(x + o.w * 0.9, cy - o.h * 0.02, o.w * 0.13, o.h * 0.17, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x + o.w * 0.97, cy + o.h * 0.08, o.w * 0.07, o.h * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#423a34';
  ctx.beginPath();
  ctx.ellipse(x + o.w * 0.86, cy - o.h * 0.24, o.w * 0.07, o.h * 0.1, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#eee';
  ctx.beginPath();
  ctx.arc(x + o.w * 0.88, cy - o.h * 0.04, 1.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath();
  ctx.arc(x + o.w * 0.89, cy - o.h * 0.04, 0.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawWolf(o, frame) {
  const bob = Math.sin((frame + o.bobSeed) * 0.2) * 0.6;
  const x = o.x;
  const y = o.y + bob;
  const bodyColor = '#545a61';
  const cy = y + o.h * 0.5;

  // legs with paws
  ctx.fillStyle = '#3a3e43';
  [0.15, 0.35, 0.62, 0.82].forEach((f) => {
    ctx.fillRect(x + o.w * f - 1, cy + o.h * 0.18, 2, o.h * 0.4);
  });
  ctx.fillStyle = '#20231f';
  [0.15, 0.35, 0.62, 0.82].forEach((f) => {
    ctx.fillRect(x + o.w * f - 1.3, cy + o.h * 0.56, 2.6, o.h * 0.06);
  });

  // tail
  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.moveTo(x + o.w * 0.04, cy);
  ctx.lineTo(x - o.w * 0.16, cy - o.h * 0.22);
  ctx.lineTo(x - o.w * 0.05, cy + o.h * 0.02);
  ctx.lineTo(x + o.w * 0.08, cy + o.h * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();

  // body with jagged dorsal fur line and a shaded belly/back split
  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.ellipse(x + o.w * 0.48, cy, o.w * 0.44, o.h * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = 'rgba(30, 32, 36, 0.3)';
  ctx.beginPath();
  ctx.ellipse(x + o.w * 0.48, cy + o.h * 0.1, o.w * 0.42, o.h * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.moveTo(x + o.w * 0.1, cy - o.h * 0.22);
  for (let i = 0; i < 5; i++) {
    const fx = x + o.w * (0.1 + i * 0.16);
    ctx.lineTo(fx, cy - o.h * (0.3 + (i % 2) * 0.1));
  }
  ctx.lineTo(x + o.w * 0.86, cy - o.h * 0.22);
  ctx.lineTo(x + o.w * 0.1, cy - o.h * 0.1);
  ctx.closePath();
  ctx.fill();

  // head: snout, ear, fang, eye
  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.ellipse(x + o.w * 0.9, cy - o.h * 0.14, o.w * 0.14, o.h * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x + o.w * 1.0, cy - o.h * 0.04, o.w * 0.08, o.h * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#3a3e43';
  ctx.beginPath();
  ctx.moveTo(x + o.w * 0.84, cy - o.h * 0.3);
  ctx.lineTo(x + o.w * 0.79, cy - o.h * 0.5);
  ctx.lineTo(x + o.w * 0.89, cy - o.h * 0.32);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#eee';
  ctx.beginPath();
  ctx.moveTo(x + o.w * 1.02, cy - o.h * 0.0);
  ctx.lineTo(x + o.w * 1.06, cy + o.h * 0.08);
  ctx.lineTo(x + o.w * 1.0, cy + o.h * 0.06);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(255, 210, 60, 0.3)';
  ctx.beginPath();
  ctx.arc(x + o.w * 0.96, cy - o.h * 0.14, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffd34d';
  ctx.beginPath();
  ctx.arc(x + o.w * 0.96, cy - o.h * 0.14, 1.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#20231f';
  ctx.beginPath();
  ctx.arc(x + o.w * 0.97, cy - o.h * 0.14, 0.4, 0, Math.PI * 2);
  ctx.fill();
}

function drawFox(o, frame) {
  const bob = Math.sin((frame + o.bobSeed) * 0.22) * 0.6;
  const x = o.x;
  const y = o.y + bob;
  const bodyColor = '#d4712f';
  const darkColor = '#a85620';
  const cy = y + o.h * 0.5;

  // tail with white tip + dark stripe
  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.moveTo(x + o.w * 0.04, cy - o.h * 0.05);
  ctx.quadraticCurveTo(x - o.w * 0.3, cy - o.h * 0.14, x - o.w * 0.1, cy + o.h * 0.3);
  ctx.quadraticCurveTo(x + o.w * 0.08, cy + o.h * 0.14, x + o.w * 0.05, cy);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.fillStyle = darkColor;
  ctx.beginPath();
  ctx.ellipse(x - o.w * 0.17, cy + o.h * 0.06, o.w * 0.05, o.h * 0.1, 0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fdf3e4';
  ctx.beginPath();
  ctx.ellipse(x - o.w * 0.16, cy + o.h * 0.22, o.w * 0.08, o.h * 0.09, 0, 0, Math.PI * 2);
  ctx.fill();

  // legs
  ctx.fillStyle = darkColor;
  [0.22, 0.42, 0.6, 0.8].forEach((f) => {
    ctx.fillRect(x + o.w * f - 1, cy + o.h * 0.16, 2, o.h * 0.32);
  });
  ctx.fillStyle = '#20231f';
  [0.22, 0.42, 0.6, 0.8].forEach((f) => {
    ctx.fillRect(x + o.w * f - 1.3, cy + o.h * 0.46, 2.6, o.h * 0.06);
  });

  // body: lit back, white underside, slight ruff texture
  ctx.fillStyle = bodyColor;
  ctx.lineWidth = 1;
  ctx.strokeStyle = OUTLINE;
  ctx.beginPath();
  ctx.ellipse(x + o.w * 0.46, cy, o.w * 0.4, o.h * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#fdf3e4';
  ctx.beginPath();
  ctx.ellipse(x + o.w * 0.44, cy + o.h * 0.14, o.w * 0.3, o.h * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.beginPath();
  ctx.ellipse(x + o.w * 0.3, cy - o.h * 0.12, o.w * 0.14, o.h * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();

  // head: muzzle, ear, eye
  ctx.fillStyle = '#fdf3e4';
  ctx.beginPath();
  ctx.ellipse(x + o.w * 0.74, cy + o.h * 0.08, o.w * 0.1, o.h * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.ellipse(x + o.w * 0.88, cy - o.h * 0.1, o.w * 0.12, o.h * 0.15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = darkColor;
  ctx.beginPath();
  ctx.ellipse(x + o.w * 0.97, cy + o.h * 0.02, o.w * 0.05, o.h * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.moveTo(x + o.w * 0.82, cy - o.h * 0.22);
  ctx.lineTo(x + o.w * 0.78, cy - o.h * 0.42);
  ctx.lineTo(x + o.w * 0.87, cy - o.h * 0.25);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = darkColor;
  ctx.beginPath();
  ctx.moveTo(x + o.w * 0.81, cy - o.h * 0.24);
  ctx.lineTo(x + o.w * 0.795, cy - o.h * 0.36);
  ctx.lineTo(x + o.w * 0.85, cy - o.h * 0.26);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#eee';
  ctx.beginPath();
  ctx.arc(x + o.w * 0.9, cy - o.h * 0.08, 0.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath();
  ctx.arc(x + o.w * 0.91, cy - o.h * 0.08, 0.45, 0, Math.PI * 2);
  ctx.fill();
}

function drawElephant(o, frame) {
  const bob = Math.sin((frame + o.bobSeed) * 0.13) * 0.6;
  const x = o.x;
  const y = o.y + bob;
  const bodyColor = '#9099a0';
  const shadeColor = '#767f86';
  const cy = y + o.h * 0.42;

  // legs with toenails
  ctx.fillStyle = shadeColor;
  [0.12, 0.3, 0.62, 0.8].forEach((f) => {
    ctx.fillRect(x + o.w * f - 2, y + o.h * 0.6, 5, o.h * 0.4);
  });
  ctx.fillStyle = '#e8e4da';
  [0.12, 0.3, 0.62, 0.8].forEach((f) => {
    ctx.fillRect(x + o.w * f - 2.2, y + o.h * 0.96, 2, 1.4);
    ctx.fillRect(x + o.w * f + 0.6, y + o.h * 0.96, 2, 1.4);
  });

  // tail
  ctx.strokeStyle = shadeColor;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x + o.w * 0.02, cy + o.h * 0.1);
  ctx.quadraticCurveTo(x - o.w * 0.06, cy + o.h * 0.3, x - o.w * 0.02, cy + o.h * 0.42);
  ctx.stroke();

  // body with a lit top and shaded underside for roundness
  ctx.fillStyle = bodyColor;
  ctx.lineWidth = 1;
  ctx.strokeStyle = OUTLINE;
  ctx.beginPath();
  ctx.ellipse(x + o.w * 0.46, cy, o.w * 0.46, o.h * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = 'rgba(30, 32, 36, 0.18)';
  ctx.beginPath();
  ctx.ellipse(x + o.w * 0.46, cy + o.h * 0.14, o.w * 0.42, o.h * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.beginPath();
  ctx.ellipse(x + o.w * 0.34, cy - o.h * 0.14, o.w * 0.18, o.h * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();

  // skin wrinkle lines
  ctx.strokeStyle = 'rgba(40, 42, 46, 0.3)';
  ctx.lineWidth = 0.8;
  [0.2, 0.34, 0.5].forEach((f) => {
    ctx.beginPath();
    ctx.moveTo(x + o.w * f, cy - o.h * 0.26);
    ctx.quadraticCurveTo(x + o.w * (f + 0.03), cy, x + o.w * f, cy + o.h * 0.26);
    ctx.stroke();
  });

  // ears (far, lighter; near, darker-outlined) + head
  ctx.fillStyle = shadeColor;
  ctx.beginPath();
  ctx.ellipse(x + o.w * 0.76, cy - o.h * 0.04, o.w * 0.18, o.h * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(40, 42, 46, 0.2)';
  ctx.beginPath();
  ctx.ellipse(x + o.w * 0.78, cy - o.h * 0.02, o.w * 0.1, o.h * 0.15, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.ellipse(x + o.w * 0.88, cy - o.h * 0.06, o.w * 0.14, o.h * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#eee';
  ctx.beginPath();
  ctx.arc(x + o.w * 0.94, cy - o.h * 0.14, 0.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath();
  ctx.arc(x + o.w * 0.95, cy - o.h * 0.14, 0.45, 0, Math.PI * 2);
  ctx.fill();

  // tusk
  ctx.fillStyle = '#f2ecd8';
  ctx.beginPath();
  ctx.moveTo(x + o.w * 0.92, cy + o.h * 0.1);
  ctx.quadraticCurveTo(x + o.w * 1.0, cy + o.h * 0.16, x + o.w * 0.98, cy + o.h * 0.3);
  ctx.lineTo(x + o.w * 0.94, cy + o.h * 0.28);
  ctx.quadraticCurveTo(x + o.w * 0.96, cy + o.h * 0.16, x + o.w * 0.9, cy + o.h * 0.12);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();

  // trunk with wrinkle rings
  ctx.strokeStyle = bodyColor;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x + o.w * 0.96, cy - o.h * 0.02);
  ctx.quadraticCurveTo(x + o.w * 1.04, cy + o.h * 0.26, x + o.w * 0.92, cy + o.h * 0.34);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(40, 42, 46, 0.35)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(x + o.w * 0.97, cy + o.h * 0.06);
  ctx.lineTo(x + o.w * 1.0, cy + o.h * 0.08);
  ctx.moveTo(x + o.w * 0.98, cy + o.h * 0.16);
  ctx.lineTo(x + o.w * 1.01, cy + o.h * 0.18);
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

  // wheel wells + tires + rims
  ctx.fillStyle = '#1a1512';
  ctx.beginPath();
  ctx.arc(x + o.w * 0.26, y + o.h, o.h * 0.22, 0, Math.PI * 2);
  ctx.arc(x + o.w * 0.78, y + o.h, o.h * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#6b6f73';
  ctx.beginPath();
  ctx.arc(x + o.w * 0.26, y + o.h, o.h * 0.1, 0, Math.PI * 2);
  ctx.arc(x + o.w * 0.78, y + o.h, o.h * 0.1, 0, Math.PI * 2);
  ctx.fill();

  // body with a bumper lip
  ctx.fillStyle = '#1a1512';
  ctx.fillRect(x, y + o.h * 0.62, o.w, o.h * 0.1);

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

  // shaded lower half + glossy roof highlight for volume
  ctx.save();
  ctx.clip();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
  ctx.fillRect(x, y + o.h * 0.6, o.w, o.h * 0.4);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.beginPath();
  ctx.ellipse(x + o.w * 0.4, y + o.h * 0.22, o.w * 0.22, o.h * 0.08, -0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // windshield + side window divider
  ctx.fillStyle = 'rgba(180, 222, 255, 0.85)';
  ctx.beginPath();
  ctx.moveTo(x + o.w * 0.34, y + o.h * 0.46);
  ctx.lineTo(x + o.w * 0.37, y + o.h * 0.2);
  ctx.lineTo(x + o.w * 0.63, y + o.h * 0.2);
  ctx.lineTo(x + o.w * 0.66, y + o.h * 0.46);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = o.color;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x + o.w * 0.5, y + o.h * 0.2);
  ctx.lineTo(x + o.w * 0.5, y + o.h * 0.46);
  ctx.stroke();

  // door seam + handle
  ctx.strokeStyle = 'rgba(20, 20, 24, 0.3)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(x + o.w * 0.5, y + o.h * 0.46);
  ctx.lineTo(x + o.w * 0.5, y + o.h * 0.58);
  ctx.stroke();
  ctx.fillStyle = 'rgba(20, 20, 24, 0.5)';
  ctx.fillRect(x + o.w * 0.56, y + o.h * 0.5, 3, 1);

  // headlight + taillight
  ctx.fillStyle = '#ffe9a8';
  ctx.beginPath();
  ctx.arc(x + o.w - 3, y + o.h * 0.68, 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c0392b';
  ctx.beginPath();
  ctx.arc(x + 3, y + o.h * 0.68, 1.4, 0, Math.PI * 2);
  ctx.fill();
}

function drawPhoneBooth(o) {
  const x = o.x;
  const y = o.y;

  // base plinth
  ctx.fillStyle = '#5a5f64';
  ctx.fillRect(x + 1, y + o.h - 2, o.w - 2, 2);

  // frame posts + body
  ctx.fillStyle = '#b23a2e';
  ctx.fillRect(x + 2, y + 5, o.w - 4, o.h - 7);
  ctx.lineWidth = 1;
  ctx.strokeStyle = OUTLINE;
  ctx.strokeRect(x + 2, y + 5, o.w - 4, o.h - 7);

  // shaded right side for volume
  ctx.fillStyle = 'rgba(20, 20, 24, 0.22)';
  ctx.fillRect(x + o.w * 0.62, y + 5, o.w * 0.3, o.h - 7);

  // glass panes between mullions
  ctx.fillStyle = 'rgba(180, 222, 230, 0.35)';
  for (let i = 0; i < 3; i++) {
    const px = x + 2 + ((o.w - 4) * i) / 3 + 0.8;
    ctx.fillRect(px, y + 7, (o.w - 4) / 3 - 1.6, o.h * 0.5);
  }
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = 0.8;
  for (let i = 1; i < 3; i++) {
    const lx = x + 2 + ((o.w - 4) * i) / 3;
    ctx.beginPath();
    ctx.moveTo(lx, y + 7);
    ctx.lineTo(lx, y + o.h - 4);
    ctx.stroke();
  }

  // domed roof cap
  ctx.fillStyle = '#8a2a20';
  ctx.beginPath();
  ctx.moveTo(x - 0.5, y + 5);
  ctx.quadraticCurveTo(x + o.w / 2, y - 2, x + o.w + 0.5, y + 5);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.fillStyle = '#6b1f17';
  ctx.fillRect(x, y + 4, o.w, 2);
  ctx.strokeRect(x, y + 4, o.w, 2);

  // illuminated sign panel
  ctx.fillStyle = '#eee0b8';
  ctx.fillRect(x + o.w * 0.18, y + 1.5, o.w * 0.64, 2.6);
  ctx.strokeRect(x + o.w * 0.18, y + 1.5, o.w * 0.64, 2.6);

  // handle + door seam
  ctx.strokeStyle = 'rgba(20, 20, 24, 0.3)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(x + o.w * 0.5, y + o.h * 0.5);
  ctx.lineTo(x + o.w * 0.5, y + o.h - 4);
  ctx.stroke();
  ctx.fillStyle = '#eee';
  ctx.fillRect(x + o.w * 0.5 - 1, y + o.h * 0.55, 2, 2);
}

function drawHydrant(o) {
  const x = o.x;
  const y = o.y;
  const lineW = 1;

  // side nozzle caps with bolt + rim shading
  ctx.fillStyle = '#8a2a20';
  ctx.beginPath();
  ctx.arc(x + o.w * 0.1, y + o.h * 0.52, o.w * 0.15, 0, Math.PI * 2);
  ctx.arc(x + o.w * 0.9, y + o.h * 0.52, o.w * 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = lineW;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.fillStyle = '#5a1510';
  ctx.beginPath();
  ctx.arc(x + o.w * 0.1, y + o.h * 0.52, o.w * 0.07, 0, Math.PI * 2);
  ctx.arc(x + o.w * 0.9, y + o.h * 0.52, o.w * 0.07, 0, Math.PI * 2);
  ctx.fill();

  // tapered body (narrower waist above the base flange)
  ctx.fillStyle = '#c0392b';
  ctx.beginPath();
  ctx.moveTo(x + o.w * 0.22, y + o.h);
  ctx.lineTo(x + o.w * 0.3, y + o.h * 0.26);
  ctx.quadraticCurveTo(x + o.w * 0.3, y + o.h * 0.16, x + o.w * 0.5, y + o.h * 0.14);
  ctx.quadraticCurveTo(x + o.w * 0.7, y + o.h * 0.16, x + o.w * 0.7, y + o.h * 0.26);
  ctx.lineTo(x + o.w * 0.78, y + o.h);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // shaded right side for volume
  ctx.fillStyle = 'rgba(20, 20, 24, 0.22)';
  ctx.beginPath();
  ctx.moveTo(x + o.w * 0.52, y + o.h * 0.16);
  ctx.lineTo(x + o.w * 0.7, y + o.h * 0.26);
  ctx.lineTo(x + o.w * 0.78, y + o.h);
  ctx.lineTo(x + o.w * 0.6, y + o.h);
  ctx.closePath();
  ctx.fill();

  // base flange + bolts
  ctx.fillStyle = '#8a2a20';
  ctx.fillRect(x + o.w * 0.12, y + o.h * 0.9, o.w * 0.76, o.h * 0.1);
  ctx.strokeRect(x + o.w * 0.12, y + o.h * 0.9, o.w * 0.76, o.h * 0.1);
  ctx.fillStyle = '#5a1510';
  [0.22, 0.78].forEach((f) => {
    ctx.beginPath();
    ctx.arc(x + o.w * f, y + o.h * 0.95, 0.9, 0, Math.PI * 2);
    ctx.fill();
  });

  // domed cap with bolt and highlight
  ctx.fillStyle = '#c0392b';
  ctx.beginPath();
  ctx.ellipse(x + o.w * 0.5, y + o.h * 0.1, o.w * 0.22, o.h * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#8a2a20';
  ctx.fillRect(x + o.w * 0.44, y - 1, o.w * 0.12, 2.5);
  ctx.strokeRect(x + o.w * 0.44, y - 1, o.w * 0.12, 2.5);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.beginPath();
  ctx.ellipse(x + o.w * 0.42, y + o.h * 0.26, o.w * 0.08, o.h * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
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
    if (p.round) {
      ctx.beginPath();
      ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
    }
    ctx.restore();
  });
}

const PICKUP_STYLES = {
  points: { fill: '#ffe066', ring: '#c98a12', text: '#5c3d00', glow: 'rgba(255, 224, 102, 0.35)' },
  slow: { fill: '#8fd9ff', ring: '#2f8fc2', text: '#063a52', glow: 'rgba(143, 217, 255, 0.35)' },
  shield: { fill: '#baffc9', ring: '#2f9e55', text: '#0a3d1c', glow: 'rgba(186, 255, 201, 0.35)' },
};

function drawPickup(p, frame) {
  const style = PICKUP_STYLES[p.type];
  const bob = Math.sin((frame + p.bobSeed) * 0.12) * 1.5;
  const cx = p.x + p.w / 2;
  const cy = p.y + p.h / 2 + bob;
  const r = p.w / 2;

  ctx.fillStyle = style.glow;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = style.fill;
  ctx.lineWidth = 1;
  ctx.strokeStyle = style.ring;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.3, cy - r * 0.3, r * 0.3, r * 0.18, -0.4, 0, Math.PI * 2);
  ctx.fill();

  if (p.type === 'shield') {
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.55);
    ctx.lineTo(cx + r * 0.5, cy - r * 0.25);
    ctx.lineTo(cx + r * 0.4, cy + r * 0.35);
    ctx.lineTo(cx, cy + r * 0.6);
    ctx.lineTo(cx - r * 0.4, cy + r * 0.35);
    ctx.lineTo(cx - r * 0.5, cy - r * 0.25);
    ctx.closePath();
    ctx.fillStyle = '#eafff0';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = style.text;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.45);
    ctx.lineTo(cx, cy + r * 0.5);
    ctx.stroke();
  } else {
    ctx.fillStyle = style.text;
    ctx.font = 'bold 6px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.type === 'points' ? `+${p.value}` : String(p.value), cx, cy + 0.5);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
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
  pickups.forEach((p) => drawPickup(p, score));

  const flashHidden = invulnTimer > 0 && Math.floor(invulnTimer / 4) % 2 === 0;
  if (!flashHidden) drawCharacter();

  if (shieldTimer > 0) {
    const flicker = shieldTimer < 60 && Math.floor(shieldTimer / 6) % 2 === 0;
    if (!flicker) {
      const squatNow = squatting && !jumping;
      const headCx = CHAR_X + 8 + 4.5;
      const baseTop = squatNow ? GROUND_Y - SQUAT_H : charY;
      const bob = Math.sin(score * 0.15) * 1.4;
      const sx = headCx + 3;
      const sy = baseTop - 2 + bob;
      const pulse = 1 + Math.sin(score * 0.3) * 0.06;
      const w = 9 * pulse;
      const h = 12 * pulse;

      ctx.save();
      ctx.translate(sx, sy);

      ctx.fillStyle = 'rgba(120, 255, 170, 0.22)';
      ctx.beginPath();
      ctx.arc(0, 0, w * 1.15, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(0, -h * 0.55);
      ctx.lineTo(w * 0.5, -h * 0.32);
      ctx.lineTo(w * 0.42, h * 0.22);
      ctx.lineTo(0, h * 0.6);
      ctx.lineTo(-w * 0.42, h * 0.22);
      ctx.lineTo(-w * 0.5, -h * 0.32);
      ctx.closePath();
      ctx.fillStyle = '#5fd98a';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#174d28';
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, -h * 0.4);
      ctx.lineTo(w * 0.32, -h * 0.2);
      ctx.lineTo(w * 0.27, h * 0.14);
      ctx.lineTo(0, h * 0.42);
      ctx.lineTo(-w * 0.27, h * 0.14);
      ctx.lineTo(-w * 0.32, -h * 0.2);
      ctx.closePath();
      ctx.fillStyle = '#baffc9';
      ctx.fill();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.beginPath();
      ctx.moveTo(-w * 0.3, -h * 0.26);
      ctx.lineTo(-w * 0.06, -h * 0.36);
      ctx.lineTo(-w * 0.12, h * 0.05);
      ctx.lineTo(-w * 0.32, h * 0.05);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = '#0a3d1c';
      ctx.lineWidth = 1.3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, -h * 0.18);
      ctx.lineTo(0, h * 0.28);
      ctx.moveTo(-w * 0.16, h * 0.02);
      ctx.lineTo(w * 0.16, h * 0.02);
      ctx.stroke();

      ctx.restore();
    }
  }

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
    statusEl.textContent = 'Smile to jump • tilt your head down to squat • grab the bubbles: gold = points, blue = slow down, green = shield';
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
