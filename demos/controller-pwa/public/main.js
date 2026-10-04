// How far (in degrees) a tilt has to travel from the calibrated center
// before the dot reaches the edge of the level / the bars read 100%.
const MAX_TILT_DEG = 45;

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
// held flat, or held like a steering wheel. Stored already screen-angle-
// adjusted (see tiltFromEvent), so it stays meaningful across rotation.
let baselineX = null;
let baselineY = null;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function getScreenAngle() {
  if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
  if (typeof window.orientation === 'number') return window.orientation;
  return 0;
}

// beta/gamma are tied to the device's physical axes, not the screen: gamma
// is always "tilt around the long edge" and beta "tilt around the short
// edge", regardless of which way the screen is currently rotated. So which
// one reads as left/right vs. up/down - and which sign means which
// direction - flips with screen.orientation.angle. This remaps both back
// to screen-relative left/right (x) and up/down (y).
function tiltFromEvent(event) {
  const angle = getScreenAngle();
  switch (angle) {
    // The textbook formula here is x: -beta/y: gamma (and the mirror for
    // -90/270), but that reads backwards on both axes against what iOS
    // actually reports once rotated into landscape - flipped against
    // real-device testing.
    case 90:
      return { x: event.beta, y: -event.gamma };
    case -90:
    case 270:
      return { x: -event.beta, y: event.gamma };
    case 180:
      return { x: -event.gamma, y: -event.beta };
    default:
      return { x: event.gamma, y: event.beta };
  }
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

  const { x, y } = tiltFromEvent(event);

  if (baselineX === null) {
    baselineX = x;
    baselineY = y;
  }

  const leftRight = x - baselineX;
  const upDown = y - baselineY;

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

function beginListening() {
  baselineX = null;
  baselineY = null;
  window.addEventListener('deviceorientation', handleOrientation);
  recalibrateBtn.hidden = false;
  statusEl.textContent = 'Tilting enabled - hold the phone however feels natural.';
}

// Rotating the phone changes which physical axis reads as left/right vs.
// up/down (see tiltFromEvent), so the old baseline no longer means
// "center" once the angle has changed - drop it and recalibrate against
// whatever position the phone is in after the rotation settles.
const resetBaselineOnRotation = () => {
  baselineX = null;
  baselineY = null;
};
if (screen.orientation) {
  screen.orientation.addEventListener('change', resetBaselineOnRotation);
} else {
  window.addEventListener('orientationchange', resetBaselineOnRotation);
}

async function init() {
  if (!window.DeviceOrientationEvent) {
    statusEl.textContent = 'This device/browser has no orientation sensor support.';
    return;
  }

  const DOE = window.DeviceOrientationEvent;
  if (typeof DOE.requestPermission !== 'function') {
    // Most non-iOS browsers expose the sensor with no permission gate, so
    // the demo can just start reading tilt the moment the page loads.
    beginListening();
    return;
  }

  // iOS requires the permission prompt to be triggered synchronously from
  // a user gesture - calling it ahead of time reliably resolves 'denied'
  // (not an exception) on a fresh origin, which would strand the page with
  // no way to retry short of a reload. So just wait for the first tap and
  // request from inside that gesture every time.
  //
  // This specifically has to be a 'click' listener, not 'pointerdown' or
  // 'touchstart': WebKit's user-activation check for this API only
  // recognizes click as a valid trigger, and silently resolves to
  // 'denied' (no prompt, no error) when called from the earlier raw
  // touch events instead.
  statusEl.textContent = 'Tap anywhere to enable motion sensors.';
  document.addEventListener(
    'click',
    async () => {
      try {
        const result = await DOE.requestPermission();
        if (result === 'granted') beginListening();
        else statusEl.textContent = 'Motion access denied. Enable it in Settings and reload.';
      } catch (err) {
        statusEl.textContent = 'Motion access denied. Enable it in Settings and reload.';
      }
    },
    { once: true }
  );
}

recalibrateBtn.addEventListener('click', () => {
  baselineX = null;
  baselineY = null;
  statusEl.textContent = 'Recalibrated - current position is now center.';
});

init();
