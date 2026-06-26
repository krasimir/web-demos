function mandelbrotIter(cx, cy, maxIter) {
  let x = 0, y = 0, x2 = 0, y2 = 0, iter = 0;
  while (x2 + y2 <= 4 && iter < maxIter) {
    y = 2 * x * y + cy;
    x = x2 - y2 + cx;
    x2 = x * x;
    y2 = y * y;
    iter++;
  }
  return iter;
}

function hslToRgb(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
}

function colorForIter(iter, maxIter) {
  if (iter >= maxIter) return [0, 0, 0];
  const hue = (iter * 6) % 360;
  return hslToRgb(hue, 100, 50);
}

function renderStrip({ canvasWidth, canvasHeight, yStart, yEnd, maxIter, viewport }) {
  const { xmin, xmax, ymin, ymax } = viewport;
  const stripHeight = yEnd - yStart;
  const data = new Uint8ClampedArray(canvasWidth * stripHeight * 4);

  for (let py = 0; py < stripHeight; py++) {
    const cy = ymin + ((yStart + py) / canvasHeight) * (ymax - ymin);
    for (let px = 0; px < canvasWidth; px++) {
      const cx = xmin + (px / canvasWidth) * (xmax - xmin);
      const iter = mandelbrotIter(cx, cy, maxIter);
      const [r, g, b] = colorForIter(iter, maxIter);
      const idx = (py * canvasWidth + px) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }

  return data;
}
