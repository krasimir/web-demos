// How far (in degrees) a tilt has to travel from the calibrated center
// before the ship reads full deflection on that axis.
const MAX_TILT_DEG = 26;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// deviceorientation's beta/gamma are reported in the phone's natural
// (portrait) frame regardless of how the page is laid out, so holding the
// phone in landscape needs the axes remapped based on how far the screen
// has been rotated from that natural frame.
function orientationAngle() {
  if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
  if (typeof window.orientation === 'number') return window.orientation;
  return 0;
}

export function createTiltController() {
  let baselineBeta = null;
  let baselineGamma = null;
  let x = 0;
  let y = 0;
  let active = false;

  function handleOrientation(event) {
    if (event.beta === null || event.gamma === null) return;
    if (baselineBeta === null) {
      baselineBeta = event.beta;
      baselineGamma = event.gamma;
    }

    const deltaBeta = event.beta - baselineBeta;
    const deltaGamma = event.gamma - baselineGamma;

    let tiltX;
    let tiltY;
    switch (orientationAngle()) {
      case 90:
        tiltX = -deltaBeta;
        tiltY = deltaGamma;
        break;
      case -90:
      case 270:
        tiltX = deltaBeta;
        tiltY = -deltaGamma;
        break;
      case 180:
        tiltX = -deltaGamma;
        tiltY = -deltaBeta;
        break;
      default:
        tiltX = deltaGamma;
        tiltY = deltaBeta;
    }

    // Flipped relative to the raw sensor axis so tilting left actually
    // steers left on screen, matching the keyboard's left/right feel.
    x = clamp(-tiltX / MAX_TILT_DEG, -1, 1);
    y = clamp(tiltY / MAX_TILT_DEG, -1, 1);
  }

  async function requestAccess() {
    if (!window.DeviceOrientationEvent) return false;

    const DOE = window.DeviceOrientationEvent;
    if (typeof DOE.requestPermission === 'function') {
      try {
        const result = await DOE.requestPermission();
        if (result !== 'granted') return false;
      } catch {
        return false;
      }
    }

    window.addEventListener('deviceorientation', handleOrientation);
    active = true;
    return true;
  }

  function recalibrate() {
    baselineBeta = null;
    baselineGamma = null;
  }

  return {
    requestAccess,
    recalibrate,
    isActive: () => active,
    getInput() {
      return { x, y };
    },
  };
}
