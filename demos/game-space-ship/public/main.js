import { createKeyboardController } from './controllers/keyboard.js';

const NEAR_Z = 0.3;
const FAR_Z = 8;
const WORLD_RADIUS_Y = 1.7;
const SHIP_SPEED = 2.6;
const SHIP_EASE = 5;
const SHIP_HIT_RADIUS_PX = 44;
const BASE_ROCK_SPEED = 2.6;
const MAX_ROCK_SPEED = 7.5;
const SPEED_RAMP = 0.05;
const MAX_ROLL = 0.55;
const SHIP_WIDTH = 230;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const finalScoreEl = document.getElementById('final-score');
const startOverlay = document.getElementById('start-overlay');
const gameoverOverlay = document.getElementById('gameover-overlay');
const startBtn = document.getElementById('start-btn');
const retryBtn = document.getElementById('retry-btn');
const fullscreenBtn = document.getElementById('fullscreen-btn');

let width = 0;
let height = 0;
let centerX = 0;
let centerY = 0;
let screenRadius = 0;
let worldRadiusX = 1;

function resize() {
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = width;
  canvas.height = height;
  centerX = width / 2;
  centerY = height / 2;
  screenRadius = Math.min(width, height) * 1.2;
  worldRadiusX = WORLD_RADIUS_Y * (width / height);
}
window.addEventListener('resize', resize);
resize();

const controller = createKeyboardController();

const shipImage = new Image();
let shipImageReady = false;
shipImage.onload = () => {
  shipImageReady = true;
};
shipImage.src = 'assets/ship.png';
const shipImageAspect = 111 / 260;

const bgImage = new Image();
let bgImageReady = false;
bgImage.onload = () => {
  bgImageReady = true;
};
bgImage.src = 'assets/space-bg.png';

let ship = { x: 0, y: 0, vx: 0, vy: 0, roll: 0 };
let rocks = [];
let stars = [];
let score = 0;
let elapsed = 0;
let spawnTimer = 0;
let running = false;
let lastTime = 0;

function project(x, y, z) {
  const scale = NEAR_Z / (Math.max(0, z) + NEAR_Z);
  const dx = x - ship.x;
  const dy = y - ship.y;
  return {
    sx: centerX + dx * screenRadius * scale,
    sy: centerY + dy * screenRadius * scale,
    scale,
  };
}

function resetGame() {
  ship = { x: 0, y: 0, vx: 0, vy: 0, roll: 0 };
  rocks = [];
  score = 0;
  elapsed = 0;
  spawnTimer = 0;
  stars = Array.from({ length: 140 }, () => ({
    x: (Math.random() - 0.5) * 2,
    y: (Math.random() - 0.5) * 2,
    z: Math.random() * FAR_Z,
  }));
}

const ROCK_SIZES = [
  { min: 0.07, max: 0.15, weight: 0.4 },
  { min: 0.18, max: 0.34, weight: 0.4 },
  { min: 0.4, max: 0.8, weight: 0.2 },
];

function rollRockRadius() {
  const roll = Math.random();
  let acc = 0;
  for (const tier of ROCK_SIZES) {
    acc += tier.weight;
    if (roll <= acc) return tier.min + Math.random() * (tier.max - tier.min);
  }
  return ROCK_SIZES[0].min;
}

const STATION_CHANCE = 0.06;

function spawnRock() {
  const angle = Math.random() * Math.PI * 2;
  const dist = 0.3 + Math.random() * 0.7;
  const x = Math.cos(angle) * dist * worldRadiusX;
  const y = Math.sin(angle) * dist * WORLD_RADIUS_Y;

  if (Math.random() < STATION_CHANCE) {
    rocks.push({
      type: 'station',
      x,
      y,
      z: FAR_Z,
      radius: 0.55 + Math.random() * 0.4,
      spin: (Math.random() - 0.5) * 0.15,
      angle: Math.random() * Math.PI * 2,
      lightSeed: Math.random() * 20,
    });
    return;
  }

  const radius = rollRockRadius();
  const craterCount = Math.round(3 + radius * 10 + Math.random() * 3);

  rocks.push({
    type: 'rock',
    x,
    y,
    z: FAR_Z,
    radius,
    spin: (Math.random() - 0.5) * 2,
    angle: Math.random() * Math.PI * 2,
    jag: Array.from({ length: 8 }, () => 0.75 + Math.random() * 0.5),
    lightAngle: Math.random() * Math.PI * 2,
    craters: Array.from({ length: craterCount }, () => ({
      a: Math.random() * Math.PI * 2,
      d: Math.random() * 0.65,
      r: 0.1 + Math.random() * 0.2,
      dark: Math.random() < 0.6,
    })),
  });
}

function rockSpeed() {
  return Math.min(MAX_ROCK_SPEED, BASE_ROCK_SPEED + elapsed * SPEED_RAMP);
}

function update(dt) {
  elapsed += dt;

  const input = controller.getInput();
  const ease = Math.min(1, dt * SHIP_EASE);
  ship.vx += (input.x * SHIP_SPEED - ship.vx) * ease;
  ship.vy += (input.y * SHIP_SPEED - ship.vy) * ease;
  ship.x += ship.vx * dt;
  ship.y += ship.vy * dt;

  if (ship.x > worldRadiusX || ship.x < -worldRadiusX) ship.vx = 0;
  if (ship.y > WORLD_RADIUS_Y || ship.y < -WORLD_RADIUS_Y) ship.vy = 0;
  ship.x = Math.max(-worldRadiusX, Math.min(worldRadiusX, ship.x));
  ship.y = Math.max(-WORLD_RADIUS_Y, Math.min(WORLD_RADIUS_Y, ship.y));

  const targetRoll = -(ship.vx / SHIP_SPEED) * MAX_ROLL;
  ship.roll += (targetRoll - ship.roll) * Math.min(1, dt * 8);

  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnRock();
    spawnTimer = Math.max(0.35, 0.9 - elapsed * 0.01);
  }

  const speed = rockSpeed();
  for (const rock of rocks) {
    rock.z -= speed * dt;
    rock.angle += rock.spin * dt;
  }

  for (const star of stars) {
    star.z -= speed * 0.6 * dt;
    if (star.z <= 0) {
      star.x = (Math.random() - 0.5) * 2;
      star.y = (Math.random() - 0.5) * 2;
      star.z = FAR_Z;
    }
  }

  let lost = false;
  rocks = rocks.filter((rock) => {
    if (rock.z <= NEAR_Z * 2) {
      const p = project(rock.x, rock.y, rock.z);
      const dx = p.sx - centerX;
      const dy = p.sy - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const rockPx = rock.radius * screenRadius * p.scale;
      if (dist < rockPx + SHIP_HIT_RADIUS_PX) {
        lost = true;
      }
    }
    if (rock.z <= -NEAR_Z) {
      if (!lost) score += rock.type === 'station' ? 35 : 10;
      return false;
    }
    return true;
  });

  if (lost) {
    endGame();
    return;
  }

  score += dt * 5;
  scoreEl.textContent = Math.floor(score);
}

function drawBackground() {
  ctx.fillStyle = '#05060a';
  ctx.fillRect(0, 0, width, height);
  if (!bgImageReady) return;

  const imgAspect = bgImage.width / bgImage.height;
  const screenAspect = width / height;
  let dw, dh;
  if (screenAspect > imgAspect) {
    dw = width;
    dh = width / imgAspect;
  } else {
    dh = height;
    dw = height * imgAspect;
  }
  ctx.globalAlpha = 0.55;
  ctx.drawImage(bgImage, (width - dw) / 2, (height - dh) / 2, dw, dh);
  ctx.globalAlpha = 1;
}

function drawStars() {
  ctx.fillStyle = '#fff';
  for (const star of stars) {
    const p = project(star.x, star.y, star.z);
    const r = Math.max(0.5, 1.6 * p.scale);
    ctx.globalAlpha = Math.min(1, p.scale * 1.2);
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawStation(rock) {
  const p = project(rock.x, rock.y, rock.z);
  if (p.scale <= 0) return;
  const r = rock.radius * screenRadius * p.scale;
  const extent = r * 2.4;
  if (r < 1 || p.sx < -extent || p.sx > width + extent || p.sy < -extent || p.sy > height + extent) return;

  const shade = Math.min(1, p.scale);

  ctx.save();
  ctx.translate(p.sx, p.sy);
  ctx.rotate(rock.angle);

  const hw = r;
  const hh = r * 0.62;
  const panelW = r * 1.7;
  const panelH = r * 0.5;

  for (const side of [-1, 1]) {
    ctx.strokeStyle = 'rgba(150,160,175,0.6)';
    ctx.lineWidth = Math.max(1, r * 0.025);
    ctx.beginPath();
    ctx.moveTo(side * hw * 0.5, 0);
    ctx.lineTo(side * (hw * 0.5 + panelW * 0.55), 0);
    ctx.stroke();

    ctx.save();
    ctx.translate(side * (hw * 0.5 + panelW * 0.55), 0);
    const panelGrad = ctx.createLinearGradient(-panelW / 2, -panelH / 2, panelW / 2, panelH / 2);
    panelGrad.addColorStop(0, `rgba(${40 + shade * 20},${55 + shade * 25},${95 + shade * 40},0.95)`);
    panelGrad.addColorStop(1, `rgba(${18 + shade * 12},${28 + shade * 18},${52 + shade * 28},0.95)`);
    ctx.fillStyle = panelGrad;
    ctx.fillRect(-panelW / 2, -panelH / 2, panelW, panelH);
    ctx.strokeStyle = 'rgba(8,10,16,0.85)';
    ctx.lineWidth = Math.max(0.5, r * 0.012);
    const cols = 5;
    for (let i = 1; i < cols; i++) {
      const gx = -panelW / 2 + (panelW / cols) * i;
      ctx.beginPath();
      ctx.moveTo(gx, -panelH / 2);
      ctx.lineTo(gx, panelH / 2);
      ctx.stroke();
    }
    ctx.strokeRect(-panelW / 2, -panelH / 2, panelW, panelH);
    ctx.restore();
  }

  const hullGrad = ctx.createLinearGradient(-hw, -hh, hw, hh);
  hullGrad.addColorStop(0, `rgb(${150 + shade * 40},${158 + shade * 40},${172 + shade * 40})`);
  hullGrad.addColorStop(0.5, `rgb(${92 + shade * 28},${100 + shade * 28},${114 + shade * 28})`);
  hullGrad.addColorStop(1, `rgb(${44 + shade * 18},${50 + shade * 18},${60 + shade * 18})`);
  ctx.beginPath();
  ctx.moveTo(-hw * 0.5, -hh);
  ctx.lineTo(hw * 0.5, -hh);
  ctx.lineTo(hw, 0);
  ctx.lineTo(hw * 0.5, hh);
  ctx.lineTo(-hw * 0.5, hh);
  ctx.lineTo(-hw, 0);
  ctx.closePath();
  ctx.fillStyle = hullGrad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(12,14,20,0.9)';
  ctx.lineWidth = Math.max(1, r * 0.025);
  ctx.stroke();

  ctx.save();
  ctx.clip();
  const gridCols = 6;
  const gridRows = 3;
  for (let gy = 0; gy < gridRows; gy++) {
    for (let gx = 0; gx < gridCols; gx++) {
      const lx = -hw * 0.75 + ((hw * 1.5) / (gridCols - 1)) * gx;
      const ly = -hh * 0.55 + ((hh * 1.1) / (gridRows - 1)) * gy;
      const flicker = (Math.sin(elapsed * 2 + gx * 1.7 + gy * 2.3 + rock.lightSeed) + 1) / 2;
      ctx.fillStyle = `rgba(255,215,150,${0.15 + flicker * 0.5})`;
      ctx.fillRect(lx - r * 0.025, ly - r * 0.02, r * 0.05, r * 0.04);
    }
  }
  ctx.restore();

  const beacon = (Math.sin(elapsed * 5 + rock.lightSeed) + 1) / 2;
  ctx.beginPath();
  ctx.arc(hw * 0.92, 0, Math.max(1, r * 0.05), 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255,70,70,${0.4 + beacon * 0.6})`;
  ctx.fill();

  ctx.restore();
}

function drawRock(rock) {
  if (rock.type === 'station') {
    drawStation(rock);
    return;
  }
  const p = project(rock.x, rock.y, rock.z);
  if (p.scale <= 0) return;
  const r = rock.radius * screenRadius * p.scale;
  if (r < 0.5 || p.sx < -r || p.sx > width + r || p.sy < -r || p.sy > height + r) return;

  ctx.save();
  ctx.translate(p.sx, p.sy);
  ctx.rotate(rock.angle);
  ctx.beginPath();
  const points = rock.jag.length;
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const rad = r * rock.jag[i];
    const x = Math.cos(a) * rad;
    const y = Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  const shade = Math.min(1, p.scale);
  const base = { r: 90 + shade * 60, g: 80 + shade * 50, b: 75 + shade * 45 };
  ctx.fillStyle = `rgb(${base.r}, ${base.g}, ${base.b})`;
  ctx.fill();

  ctx.save();
  ctx.clip();

  const lightGrad = ctx.createLinearGradient(
    Math.cos(rock.lightAngle) * -r,
    Math.sin(rock.lightAngle) * -r,
    Math.cos(rock.lightAngle) * r,
    Math.sin(rock.lightAngle) * r
  );
  lightGrad.addColorStop(0, 'rgba(255,245,230,0.35)');
  lightGrad.addColorStop(0.5, 'rgba(0,0,0,0)');
  lightGrad.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = lightGrad;
  ctx.fillRect(-r, -r, r * 2, r * 2);

  for (const crater of rock.craters) {
    const cx = Math.cos(crater.a) * crater.d * r;
    const cy = Math.sin(crater.a) * crater.d * r;
    const cr = crater.r * r;
    ctx.beginPath();
    ctx.arc(cx, cy, cr, 0, Math.PI * 2);
    ctx.fillStyle = crater.dark ? 'rgba(30,22,18,0.35)' : 'rgba(255,240,220,0.18)';
    ctx.fill();
  }

  ctx.restore();

  ctx.strokeStyle = '#3a3330';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

function drawShip() {
  const w = SHIP_WIDTH;
  const h = w * shipImageAspect;
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate(ship.roll);

  if (shipImageReady) {
    ctx.drawImage(shipImage, -w / 2, -h / 2, w, h);
  }

  ctx.restore();
}

function draw() {
  drawBackground();
  drawStars();

  const sorted = [...rocks].sort((a, b) => b.z - a.z);
  for (const rock of sorted) drawRock(rock);

  drawShip();
}

function loop(time) {
  if (!running) return;
  const dt = Math.min(0.05, (time - lastTime) / 1000);
  lastTime = time;
  update(dt);
  draw();
  if (running) requestAnimationFrame(loop);
}

function startGame() {
  resetGame();
  startOverlay.classList.add('hidden');
  gameoverOverlay.classList.add('hidden');
  running = true;
  lastTime = performance.now();
  requestAnimationFrame(loop);
}

function endGame() {
  running = false;
  finalScoreEl.textContent = Math.floor(score);
  gameoverOverlay.classList.remove('hidden');
}

startBtn.addEventListener('click', startGame);
retryBtn.addEventListener('click', startGame);

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || running) return;
  if (!startOverlay.classList.contains('hidden') || !gameoverOverlay.classList.contains('hidden')) {
    startGame();
  }
});

fullscreenBtn.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen();
  }
});

draw();
