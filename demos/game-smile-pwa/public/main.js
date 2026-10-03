import {
  FaceLandmarker,
  FilesetResolver,
} from './vendor/tasks-vision/vision_bundle.mjs';

const SMILE_THRESHOLD = 0.35;
const MIN_JUMP = 6;
const MAX_JUMP = 14;
const GRAVITY = 0.5;
const GROUND_Y = 150;
const CHAR_X = 40;
const CHAR_W = 16;
const CHAR_H = 20;
const BASE_SPEED = 1.5;
const MAX_SPEED = 6;
const SPEED_RAMP = 0.0015;

const video = document.getElementById('camera');
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const smileBarFill = document.getElementById('smile-bar-fill');
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
    navigator.serviceWorker.register('./sw.js').catch(() => {});
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

let prevSmiling = false;
let jumpRequested = false;
let jumpPower = 0;

let bgFar = 0;
let bgMid = 0;
let bgNear = 0;
let bgCloud = 0;

const MONSTER_COLORS = ['#6fbf73', '#9b6fd6', '#d67f7f'];

function smileScore(blendshapes) {
  const categories = blendshapes.categories;
  const left = categories.find((c) => c.categoryName === 'mouthSmileLeft')?.score ?? 0;
  const right = categories.find((c) => c.categoryName === 'mouthSmileRight')?.score ?? 0;
  return (left + right) / 2;
}

function resetGame() {
  charY = GROUND_Y - CHAR_H;
  velocityY = 0;
  jumping = false;
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

function pickType() {
  return Math.random() < 0.32 ? 'bird' : pickGroundType();
}

function spawnObstacle() {
  let type = pickType();

  const recentBird = obstacles.some((o) => canvas.width - o.x < 70 && o.type === 'bird');
  const recentGround = obstacles.some((o) => canvas.width - o.x < 70 && o.type !== 'bird');
  if (recentBird && type !== 'bird') type = 'bird';
  else if (recentGround && type === 'bird') type = pickGroundType();

  if (type === 'bird') {
    const h = 10 + Math.random() * 2;
    const w = 16 + Math.random() * 4;
    const gap = 2 + Math.random() * 3;
    const y = GROUND_Y - CHAR_H - gap - h;
    obstacles.push({ x: canvas.width, y, w, h, type, flapSeed: Math.random() * 10 });
    return;
  }

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
  obstacles.push({ x: canvas.width, y: GROUND_Y - h, w, h, type, color, bobSeed: Math.random() * 10 });
}

function update() {
  if (gameOver) {
    if (jumpRequested) resetGame();
    jumpRequested = false;
    return;
  }

  if (jumpRequested && !jumping) {
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

  const charBox = { x: CHAR_X, y: charY, w: CHAR_W, h: CHAR_H };
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
    drawUnit(x);
  }
}

function drawSky() {
  const grad = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  grad.addColorStop(0, '#79c3ee');
  grad.addColorStop(1, '#d9f1df');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, GROUND_Y);

  ctx.fillStyle = 'rgba(255, 247, 194, 0.9)';
  ctx.beginPath();
  ctx.arc(canvas.width - 36, 30, 14, 0, Math.PI * 2);
  ctx.fill();

  drawTiled(140, bgCloud, (x) => {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.ellipse(x + 30, 28, 16, 7, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 44, 24, 11, 6, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 18, 24, 10, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawHills() {
  drawTiled(90, bgFar, (x) => {
    ctx.fillStyle = '#9fd3a6';
    ctx.beginPath();
    ctx.moveTo(x, GROUND_Y);
    ctx.quadraticCurveTo(x + 22, GROUND_Y - 44, x + 45, GROUND_Y);
    ctx.quadraticCurveTo(x + 68, GROUND_Y - 30, x + 90, GROUND_Y);
    ctx.closePath();
    ctx.fill();
  });
}

function drawTrees() {
  drawTiled(42, bgMid, (x) => {
    const trunkH = 14;
    ctx.fillStyle = '#6b4a30';
    ctx.fillRect(x + 17, GROUND_Y - trunkH, 4, trunkH);

    ctx.fillStyle = '#3f8f52';
    ctx.beginPath();
    ctx.moveTo(x + 19, GROUND_Y - trunkH - 28);
    ctx.lineTo(x + 7, GROUND_Y - trunkH - 4);
    ctx.lineTo(x + 31, GROUND_Y - trunkH - 4);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(x + 19, GROUND_Y - trunkH - 20);
    ctx.lineTo(x + 9, GROUND_Y - trunkH + 4);
    ctx.lineTo(x + 29, GROUND_Y - trunkH + 4);
    ctx.closePath();
    ctx.fill();
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
}

function drawCharacter() {
  const x = CHAR_X;
  const y = charY;

  ctx.fillStyle = '#4a3324';
  ctx.fillRect(x, y, CHAR_W, 12);

  ctx.fillStyle = '#fff';
  ctx.fillRect(x + CHAR_W - 6, y + 3, 2, 2);

  ctx.fillStyle = '#2f2118';
  if (jumping) {
    ctx.fillRect(x + 1, y + 12, 5, 8);
    ctx.fillRect(x + CHAR_W - 6, y + 12, 5, 8);
  } else if (walkFrame === 0) {
    ctx.fillRect(x, y + 12, 5, 8);
    ctx.fillRect(x + CHAR_W - 6, y + 12, 5, 6);
  } else {
    ctx.fillRect(x, y + 12, 5, 6);
    ctx.fillRect(x + CHAR_W - 6, y + 12, 5, 8);
  }
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

  ctx.fillStyle = '#b5b5b5';
  ctx.beginPath();
  ctx.ellipse(cx - rx * 0.25, cy - ry * 0.3, rx * 0.3, ry * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawBin(o) {
  ctx.fillStyle = '#596268';
  ctx.fillRect(o.x + 1, o.y + 4, o.w - 2, o.h - 4);

  ctx.fillStyle = '#3f464b';
  ctx.fillRect(o.x, o.y, o.w, 4);

  ctx.fillStyle = '#75808a';
  ctx.fillRect(o.x + 4, o.y + 8, 2, o.h - 12);
  ctx.fillRect(o.x + o.w - 6, o.y + 8, 2, o.h - 12);
}

function drawMonster(o, frame) {
  const bob = Math.sin((frame + o.bobSeed) * 0.2) * 1.2;
  const x = o.x;
  const y = o.y + bob;

  ctx.fillStyle = o.color;
  ctx.beginPath();
  ctx.ellipse(x + o.w / 2, y + o.h / 2, o.w / 2, o.h / 2, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = o.color;
  for (let i = 0; i < 3; i++) {
    const sx = x + 4 + i * (o.w - 8) / 2;
    ctx.beginPath();
    ctx.moveTo(sx, y + 2);
    ctx.lineTo(sx + 3, y - 5);
    ctx.lineTo(sx + 6, y + 2);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(x + o.w * 0.35, y + o.h * 0.45, 3, 0, Math.PI * 2);
  ctx.arc(x + o.w * 0.65, y + o.h * 0.45, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#20231f';
  ctx.beginPath();
  ctx.arc(x + o.w * 0.35, y + o.h * 0.45, 1.3, 0, Math.PI * 2);
  ctx.arc(x + o.w * 0.65, y + o.h * 0.45, 1.3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#20231f';
  ctx.fillRect(x + o.w * 0.3, y + o.h * 0.68, o.w * 0.4, 2);
}

function drawBird(o, frame) {
  const up = Math.floor((frame + o.flapSeed) / 6) % 2 === 0;
  const cx = o.x + o.w / 2;
  const cy = o.y + o.h / 2;

  ctx.fillStyle = '#2f2b28';
  ctx.beginPath();
  ctx.ellipse(cx, cy, o.w * 0.3, o.h * 0.38, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  if (up) {
    ctx.moveTo(cx - o.w * 0.15, cy);
    ctx.lineTo(cx - o.w * 0.55, cy - o.h * 0.6);
    ctx.lineTo(cx - o.w * 0.1, cy - o.h * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + o.w * 0.15, cy);
    ctx.lineTo(cx + o.w * 0.55, cy - o.h * 0.6);
    ctx.lineTo(cx + o.w * 0.1, cy - o.h * 0.1);
  } else {
    ctx.moveTo(cx - o.w * 0.15, cy);
    ctx.lineTo(cx - o.w * 0.55, cy + o.h * 0.5);
    ctx.lineTo(cx - o.w * 0.1, cy + o.h * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + o.w * 0.15, cy);
    ctx.lineTo(cx + o.w * 0.55, cy + o.h * 0.5);
    ctx.lineTo(cx + o.w * 0.1, cy + o.h * 0.1);
  }
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#e8963a';
  ctx.beginPath();
  ctx.moveTo(cx + o.w * 0.3, cy);
  ctx.lineTo(cx + o.w * 0.45, cy + 1.5);
  ctx.lineTo(cx + o.w * 0.3, cy + 3);
  ctx.closePath();
  ctx.fill();
}

function drawObstacle(o, frame) {
  if (o.type === 'rock') drawRock(o);
  else if (o.type === 'bin') drawBin(o);
  else if (o.type === 'monster') drawMonster(o, frame);
  else if (o.type === 'bird') drawBird(o, frame);
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
    statusEl.textContent = 'Smile to jump • stay still under birds 🐦';
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
