// How far (in degrees) the dot can travel from center before it pins at
// the edge of the level circle - purely a visual range, independent of
// the precise numeric readout.
const DOT_RANGE_DEG = 30;

// Below this many degrees of total deviation from the calibrated
// reference, the reading is shown as "LEVEL" rather than a raw number.
const LEVEL_THRESHOLD_DEG = 0.3;

const calibrateBtn = document.getElementById('calibrate-btn');
const statusEl = document.getElementById('status');
const angleValueEl = document.getElementById('angle-value');
const levelBadgeEl = document.getElementById('level-badge');
const dot = document.getElementById('dot');
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

// Whatever surface the phone is resting on (or held against) when the user
// taps "Calibrate" becomes the zero reference - the phone has no idea what
// counts as "flat", so every reading is relative to this baseline rather
// than to the device's raw sensors. Stored already screen-angle-adjusted
// (see tiltFromEvent), so it stays meaningful across rotation.
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
// to screen-relative left/right (x) and up/down (y). Signs here are tuned
// against real iPhone testing, not the generic textbook formula.
function tiltFromEvent(event) {
  const angle = getScreenAngle();
  switch (angle) {
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

function handleOrientation(event) {
  if (event.beta === null || event.gamma === null) return;

  const { x, y } = tiltFromEvent(event);

  if (baselineX === null) {
    baselineX = x;
    baselineY = y;
  }

  const leftRight = x - baselineX;
  const upDown = y - baselineY;
  const totalAngle = Math.sqrt(leftRight * leftRight + upDown * upDown);
  const isLevel = totalAngle < LEVEL_THRESHOLD_DEG;

  angleValueEl.textContent = `${totalAngle.toFixed(1)}°`;
  angleValueEl.classList.toggle('level', isLevel);
  levelBadgeEl.classList.toggle('visible', isLevel);

  lrValue.textContent = `${leftRight >= 0 ? '+' : ''}${leftRight.toFixed(1)}°`;
  udValue.textContent = `${upDown >= 0 ? '+' : ''}${upDown.toFixed(1)}°`;

  const nx = clamp(leftRight / DOT_RANGE_DEG, -1, 1);
  const ny = clamp(upDown / DOT_RANGE_DEG, -1, 1);
  const radius = 40; // percent of #level's half-width the dot can travel
  dot.style.left = `${50 + nx * radius}%`;
  dot.style.top = `${50 + ny * radius}%`;
  dot.classList.toggle('level', isLevel);
}

function beginListening() {
  baselineX = null;
  baselineY = null;
  window.addEventListener('deviceorientation', handleOrientation);
  calibrateBtn.hidden = false;
  statusEl.textContent = 'Place the phone on a reference surface, then calibrate.';
}

// Rotating the phone changes which physical axis reads as left/right vs.
// up/down (see tiltFromEvent), so the old baseline no longer means "zero"
// once the angle has changed - drop it and let the user recalibrate
// against whatever position the phone is in after the rotation settles.
const resetBaselineOnRotation = () => {
  baselineX = null;
  baselineY = null;
  statusEl.textContent = 'Orientation changed - tap Calibrate again.';
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

calibrateBtn.addEventListener('click', () => {
  baselineX = null;
  baselineY = null;
  statusEl.textContent = 'Calibrated - current position is now zero.';
});

init();
