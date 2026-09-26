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

function spawnObstacle() {
  const type = Math.random() < 0.5 ? 'block' : 'spike';
  const h = type === 'spike' ? 16 + Math.random() * 18 : 10 + Math.random() * 22;
  const w = type === 'spike' ? 12 + Math.random() * 6 : 8 + Math.random() * 14;
  obstacles.push({ x: canvas.width, y: GROUND_Y - h, w, h, type });
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

function drawCharacter() {
  const x = CHAR_X;
  const y = charY;

  ctx.fillStyle = '#000';
  ctx.fillRect(x, y, CHAR_W, 12);

  ctx.fillStyle = '#fff';
  ctx.fillRect(x + CHAR_W - 6, y + 3, 2, 2);

  ctx.fillStyle = '#000';
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

function drawObstacle(o) {
  ctx.fillStyle = '#000';
  if (o.type === 'spike') {
    ctx.beginPath();
    ctx.moveTo(o.x, o.y + o.h);
    ctx.lineTo(o.x + o.w / 2, o.y);
    ctx.lineTo(o.x + o.w, o.y + o.h);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillRect(o.x, o.y, o.w, o.h);
    ctx.fillStyle = '#fff';
    ctx.fillRect(o.x + 2, o.y + 2, o.w - 4, 3);
  }
}

function draw() {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#000';
  ctx.fillRect(0, GROUND_Y, canvas.width, canvas.height - GROUND_Y);

  obstacles.forEach(drawObstacle);

  drawCharacter();

  ctx.fillStyle = '#000';
  ctx.font = '10px monospace';
  ctx.fillText(`Score: ${score}`, 6, 12);

  if (gameOver) {
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
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
    statusEl.textContent = '';

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
