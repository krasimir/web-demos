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
let planets = [];

const PLANET_PALETTES = [
  { body: 'rgba(92,104,130,0.55)', glow: 'rgba(92,104,130,0.12)' },
  { body: 'rgba(128,96,104,0.5)', glow: 'rgba(128,96,104,0.1)' },
  { body: 'rgba(92,118,106,0.5)', glow: 'rgba(92,118,106,0.1)' },
  { body: 'rgba(132,112,80,0.45)', glow: 'rgba(132,112,80,0.1)' },
];

function initPlanets() {
  const count = 2 + Math.floor(Math.random() * 2);
  planets = Array.from({ length: count }, () => ({
    x: Math.random(),
    y: Math.random() * 0.7,
    r: 0.05 + Math.random() * 0.08,
    palette: PLANET_PALETTES[Math.floor(Math.random() * PLANET_PALETTES.length)],
  }));
}

function resize() {
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = width;
  canvas.height = height;
  centerX = width / 2;
  centerY = height / 2;
  screenRadius = Math.min(width, height) * 1.2;
  worldRadiusX = WORLD_RADIUS_Y * (width / height);
  initPlanets();
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

function spawnRock() {
  const angle = Math.random() * Math.PI * 2;
  const dist = 0.3 + Math.random() * 0.7;
  const x = Math.cos(angle) * dist * worldRadiusX;
  const y = Math.sin(angle) * dist * WORLD_RADIUS_Y;
  const radius = rollRockRadius();
  const craterCount = Math.round(3 + radius * 10 + Math.random() * 3);

  rocks.push({
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
      if (!lost) score += 10;
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

function drawPlanets() {
  for (const planet of planets) {
    const cx = planet.x * width;
    const cy = planet.y * height;
    const r = planet.r * Math.min(width, height);

    const glow = ctx.createRadialGradient(cx, cy, r * 0.75, cx, cy, r * 1.35);
    glow.addColorStop(0, planet.palette.glow);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.35, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = planet.palette.body;
    ctx.fill();

    ctx.save();
    ctx.clip();
    const shade = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    shade.addColorStop(0, 'rgba(255,255,255,0.1)');
    shade.addColorStop(0.5, 'rgba(0,0,0,0)');
    shade.addColorStop(1, 'rgba(0,0,0,0.4)');
    ctx.fillStyle = shade;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
  }
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

function drawRock(rock) {
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
  ctx.fillStyle = '#05060a';
  ctx.fillRect(0, 0, width, height);
  drawPlanets();
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
