const VIEWPORT = { xmin: -2.5, xmax: 1, ymin: -1.5, ymax: 1.5 };
const CANVAS_WIDTH = 1400;
const CANVAS_HEIGHT = Math.round(
  (CANVAS_WIDTH * (VIEWPORT.ymax - VIEWPORT.ymin)) / (VIEWPORT.xmax - VIEWPORT.xmin)
);
const MAX_ITER = 4500;

const canvas = document.getElementById('canvas');
canvas.width = CANVAS_WIDTH;
canvas.height = CANVAS_HEIGHT;
const ctx = canvas.getContext('2d');

const spinnerEl = document.getElementById('spinner');
const counterEl = document.getElementById('counter');
const resultEl = document.getElementById('result');
const buttons = document.querySelectorAll('button');

let spinnerAngle = 0;
function spin() {
  spinnerAngle = (spinnerAngle + 6) % 360;
  spinnerEl.style.transform = `rotate(${spinnerAngle}deg)`;
  requestAnimationFrame(spin);
}
requestAnimationFrame(spin);

let counter = 0;
let tickInterval = null;

function startTicking() {
  counter = 0;
  counterEl.textContent = counter;
  clearInterval(tickInterval);
  tickInterval = setInterval(() => {
    counter++;
    counterEl.textContent = counter;
  }, 100);
}

function stopTicking() {
  clearInterval(tickInterval);
}

function setButtonsDisabled(disabled) {
  buttons.forEach((b) => (b.disabled = disabled));
}

function clearCanvas() {
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
}

function drawStrip(yStart, data, height) {
  ctx.putImageData(new ImageData(data, CANVAS_WIDTH, height), 0, yStart);
}

function task(yStart, yEnd) {
  return {
    canvasWidth: CANVAS_WIDTH,
    canvasHeight: CANVAS_HEIGHT,
    yStart,
    yEnd,
    maxIter: MAX_ITER,
    viewport: VIEWPORT,
  };
}

document.getElementById('main-thread-btn').addEventListener('click', () => {
  clearCanvas();
  setButtonsDisabled(true);
  startTicking();
  resultEl.textContent = 'Rendering on the main thread...';

  // Two rAFs let the browser paint the message above before we block it.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const start = performance.now();
    const data = renderStrip(task(0, CANVAS_HEIGHT));
    drawStrip(0, data, CANVAS_HEIGHT);
    const elapsed = (performance.now() - start).toFixed(0);
    resultEl.textContent = `Main thread: ${elapsed}ms — the spinner froze and the input felt dead.`;
    stopTicking();
    setButtonsDisabled(false);
  }));
});

document.getElementById('one-worker-btn').addEventListener('click', () => {
  clearCanvas();
  setButtonsDisabled(true);
  startTicking();
  resultEl.textContent = 'Rendering in a single Worker...';

  const worker = new Worker('worker.js');
  const start = performance.now();
  worker.onmessage = (e) => {
    const { yStart, data, height } = e.data;
    drawStrip(yStart, new Uint8ClampedArray(data), height);
    const elapsed = (performance.now() - start).toFixed(0);
    resultEl.textContent = `Single worker: ${elapsed}ms — same work, but the UI stayed responsive.`;
    stopTicking();
    setButtonsDisabled(false);
    worker.terminate();
  };
  worker.postMessage(task(0, CANVAS_HEIGHT));
});

document.getElementById('parallel-workers-btn').addEventListener('click', () => {
  clearCanvas();
  setButtonsDisabled(true);
  startTicking();

  const workerCount = navigator.hardwareConcurrency || 4;
  resultEl.textContent = `Rendering with ${workerCount} workers in parallel...`;

  const stripHeight = Math.ceil(CANVAS_HEIGHT / workerCount);
  let remaining = workerCount;
  const start = performance.now();

  for (let i = 0; i < workerCount; i++) {
    const yStart = i * stripHeight;
    const yEnd = Math.min(yStart + stripHeight, CANVAS_HEIGHT);
    if (yStart >= yEnd) {
      remaining--;
      continue;
    }

    const worker = new Worker('worker.js');
    worker.onmessage = (e) => {
      const { yStart: stripY, data, height } = e.data;
      drawStrip(stripY, new Uint8ClampedArray(data), height);
      remaining--;
      if (remaining === 0) {
        const elapsed = (performance.now() - start).toFixed(0);
        resultEl.textContent = `${workerCount} workers in parallel: ${elapsed}ms — responsive AND faster.`;
        stopTicking();
        setButtonsDisabled(false);
      }
      worker.terminate();
    };
    worker.postMessage(task(yStart, yEnd));
  }
});
