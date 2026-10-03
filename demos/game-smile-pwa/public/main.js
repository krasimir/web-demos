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

const RESTART_DELAY = 60;
const HIGH_SCORE_KEY = 'smileJumpHighScore';
let highScore = Number(localStorage.getItem(HIGH_SCORE_KEY)) || 0;

let prevSmiling = false;
let jumpRequested = false;
let jumpPower = 0;
let squatting = false;

let bgFar = 0;
let bgMid = 0;
let bgNear = 0;
let bgCloud = 0;
let dayT = 0;

const MONSTER_COLORS = ['#3a2545', '#2b3a2e', '#4a1f23'];
const SPARROW_COLORS = ['#5b8fd6', '#d6935b', '#8fbf6f'];
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
}

function pickGroundType() {
  const r = Math.random();
  if (r < 0.38) return 'rock';
  if (r < 0.72) return 'bin';
  return 'monster';
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

  // monster
  const h = 22 + Math.random() * 12;
  const w = 18 + Math.random() * 8;
  const color = MONSTER_COLORS[Math.floor(Math.random() * MONSTER_COLORS.length)];
  const spikes = Array.from({ length: 10 }, (_, i) =>
    i % 2 === 0 ? 0.6 + Math.random() * 0.25 : 1.05 + Math.random() * 0.3
  );
  obstacles.push({ x: canvas.width, y: GROUND_Y - h, w, h, type, color, bobSeed: Math.random() * 10, spikes });
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
    if (jumpRequested) resetGame();
    jumpRequested = false;
    return;
  }

  const squatNow = squatting && !jumping;

  if (jumpRequested && !jumping && !squatNow) {
    velocityY = -(MIN_JUMP + jumpPower * (MAX_JUMP - MIN_JUMP));
    jumping = true;
  }
  jumpRequested = false;

  velocityY += GRAVITY;
  charY += velocityY;
  if (charY >= GROUND_Y - CHAR_H) {
    charY = GROUND_Y - CHAR_H;
    velocityY = 0;
    jumping = false;
  }

  const speed = Math.min(MAX_SPEED, BASE_SPEED + score * SPEED_RAMP);
  dayT = Math.min(1, Math.max(0, (speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED)));

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

  const charBox = squatNow
    ? { x: CHAR_X, y: GROUND_Y - SQUAT_H, w: CHAR_W, h: SQUAT_H }
    : { x: CHAR_X, y: charY, w: CHAR_W, h: CHAR_H };
  for (const o of obstacles) {
    if (
      charBox.x < o.x + o.w &&
      charBox.x + charBox.w > o.x &&
      charBox.y < o.y + o.h &&
      charBox.y + charBox.h > o.y
    ) {
      gameOver = true;
    }
  }

  score += 1;

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

function lerpColor(hexA, hexB, t) {
  const a = parseInt(hexA.slice(1), 16);
  const b = parseInt(hexB.slice(1), 16);
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `rgb(${r}, ${g}, ${bl})`;
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

function drawTrees() {
  drawTiled(42, bgMid, (x, idx) => {
    const r1 = hashRand(idx);
    const r2 = hashRand(idx + 50);
    const r3 = hashRand(idx + 150);

    if (r1 < 0.45) drawPineTree(x, r2, r3);
    else if (r1 < 0.8) drawRoundTree(x, r2, r3);
    else drawBush(x, r2);
  });
}

function drawGround() {
  ctx.fillStyle = '#7a5231';
  ctx.fillRect(0, GROUND_Y, canvas.width, canvas.height - GROUND_Y);

  ctx.fillStyle = '#4caf50';
  ctx.fillRect(0, GROUND_Y, canvas.width, 4);

  ctx.fillStyle = '#39873d';
  drawTiled(10, bgNear, (x) => {
    ctx.fillRect(x, GROUND_Y - 2, 2, 4);
    ctx.fillRect(x + 5, GROUND_Y - 3, 2, 5);
  });
}

function drawBackground() {
  drawSky();
  drawHills();
  drawTrees();
  drawGround();

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

  if (squatNow) {
    // closed/squinting eyes while blinking
    ctx.strokeStyle = '#1a1512';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(cx + 4.3, headCy - 0.5);
    ctx.lineTo(cx + 6.3, headCy - 0.5);
    ctx.stroke();
  } else {
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
  }

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

function drawObstacle(o, frame) {
  if (o.type === 'rock') drawRock(o);
  else if (o.type === 'bin') drawBin(o);
  else if (o.type === 'monster') drawMonster(o, frame);
  else if (o.type === 'sparrow') drawSparrow(o, frame);
  else if (o.type === 'crow') drawCrow(o, frame);
  else if (o.type === 'dragon') drawDragon(o, frame);
  else if (o.type === 'branch') drawBranch(o);
}

function draw() {
  drawBackground();

  obstacles.forEach((o) => drawObstacle(o, score));

  drawCharacter();

  ctx.fillStyle = '#20231f';
  ctx.font = '10px monospace';
  ctx.fillText(`Score: ${score}`, 6, 12);

  if (gameOver) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#20231f';
    ctx.font = '14px monospace';
    ctx.fillText('Game Over', canvas.width / 2 - 40, canvas.height / 2 - 8);
    ctx.font = '10px monospace';
    ctx.fillText('Smile to restart', canvas.width / 2 - 44, canvas.height / 2 + 10);
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
