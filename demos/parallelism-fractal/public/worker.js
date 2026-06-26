importScripts('mandelbrot.js');

self.onmessage = (e) => {
  const { canvasWidth, canvasHeight, yStart, yEnd, maxIter, viewport } = e.data;
  const data = renderStrip({ canvasWidth, canvasHeight, yStart, yEnd, maxIter, viewport });
  self.postMessage({ yStart, height: yEnd - yStart, data: data.buffer }, [data.buffer]);
};
