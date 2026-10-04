// How far (in degrees) a tilt has to travel from the calibrated center
// before the dot reaches the edge of the level / the bars read 100%.
const MAX_TILT_DEG = 45;

const startBtn = document.getElementById('start-btn');
const recalibrateBtn = document.getElementById('recalibrate-btn');
const statusEl = document.getElementById('status');
const dot = document.getElementById('dot');
const lrFill = document.getElementById('lr-fill');
const udFill = document.getElementById('ud-fill');
const lrValue = document.getElementById('lr-value');
const udValue = document.getElementById('ud-value');

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

// Whatever orientation the phone happens to be held in when the user taps
// "Start" (or "Recalibrate") becomes the zero point - this is a controller,
// not an absolute compass, so it should work equally well propped up,
// held flat, or held like a steering wheel.
let baselineBeta = null;
let baselineGamma = null;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function setMeter(fillEl, valueEl, deltaDeg) {
  const pct = clamp((deltaDeg / MAX_TILT_DEG) * 50, -50, 50);
  if (pct >= 0) {
    fillEl.style.left = '50%';
    fillEl.style.width = `${pct}%`;
  } else {
    fillEl.style.left = `${50 + pct}%`;
    fillEl.style.width = `${-pct}%`;
  }
  valueEl.textContent = `${Math.round(deltaDeg)}°`;
}

function handleOrientation(event) {
  if (event.beta === null || event.gamma === null) return;

  if (baselineBeta === null) {
    baselineBeta = event.beta;
    baselineGamma = event.gamma;
  }

  // gamma: left/right tilt (phone rotating around its front-to-back axis).
  // beta: forward/back tilt (phone rotating around its side-to-side axis).
  const leftRight = event.gamma - baselineGamma;
  const upDown = event.beta - baselineBeta;

  setMeter(lrFill, lrValue, leftRight);
  setMeter(udFill, udValue, upDown);

  const nx = clamp(leftRight / MAX_TILT_DEG, -1, 1);
  const ny = clamp(upDown / MAX_TILT_DEG, -1, 1);
  const radius = 37; // percent of #level's half-width the dot can travel
  dot.style.left = `${50 + nx * radius}%`;
  dot.style.top = `${50 + ny * radius}%`;

  const atEdge = Math.abs(nx) >= 0.98 || Math.abs(ny) >= 0.98;
  dot.classList.toggle('edge', atEdge);
}

async function requestMotionPermission() {
  // iOS 13+ gates DeviceOrientationEvent behind an explicit permission
  // prompt that must be triggered by a user gesture; every other platform
  // just works without it.
  const DOE = window.DeviceOrientationEvent;
  if (DOE && typeof DOE.requestPermission === 'function') {
    const result = await DOE.requestPermission();
    if (result !== 'granted') throw new Error('permission-denied');
  }
}

startBtn.addEventListener('click', async () => {
  if (!window.DeviceOrientationEvent) {
    statusEl.textContent = 'This device/browser has no orientation sensor support.';
    return;
  }

  try {
    await requestMotionPermission();
  } catch (err) {
    statusEl.textContent = 'Motion access denied. Enable it in Settings and reload.';
    return;
  }

  baselineBeta = null;
  baselineGamma = null;
  window.addEventListener('deviceorientation', handleOrientation);

  startBtn.hidden = true;
  recalibrateBtn.hidden = false;
  statusEl.textContent = 'Tilting enabled - hold the phone however feels natural.';
});

recalibrateBtn.addEventListener('click', () => {
  baselineBeta = null;
  baselineGamma = null;
  statusEl.textContent = 'Recalibrated - current position is now center.';
});
