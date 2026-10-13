const canvas = document.querySelector('canvas');
const gl = canvas.getContext('webgl2');
const content = document.querySelector('.content');

const RIPPLE_CONFIG = {
  lifetimeSec: 2.6,
  waveFrequencyPx: 0.5,
  waveSpeed: 16.0,
  spatialDecayPx: 0.03,
  timeDecay: 1.7,
  displacementPx: 9.6,
  clampPx: 18.0,
  minAmplitude: 0.35,
  maxAmplitude: 1.8,
  spawnSpeedThreshold: 0.8,
  spawnSpeedGain: 0.055,
  firstRippleAmplitude: 2.5,
};

// 1. Shaders (Shortened)
const vsSource = `
    attribute vec2 p; varying vec2 v;
    void main() { v = vec2(p.x, -p.y) * 0.5 + 0.5; gl_Position = vec4(p, 0, 1); }
`;
const fsSource = `
    precision mediump float;
    varying vec2 v;
    uniform sampler2D u;
    uniform float uTime;
    uniform vec2 uResolution;
    uniform float uLifetime;
    uniform float uWaveFrequency;
    uniform float uWaveSpeed;
    uniform float uSpatialDecay;
    uniform float uTimeDecay;
    uniform float uDisplacement;
    uniform float uClampPx;
    uniform vec2 uRipplePos[24];
    uniform float uRippleTime[24];
    uniform float uRippleAmp[24];

    void main() {
        vec2 uv = v;
        vec2 fragPx = uv * uResolution;
        vec2 totalOffsetPx = vec2(0.0);

        for (int i = 0; i < 24; i++) {
            float age = uTime - uRippleTime[i];
            if (age < 0.0 || age > uLifetime) {
                continue;
            }

            vec2 centerPx = uRipplePos[i] * uResolution;
            vec2 deltaPx = fragPx - centerPx;
            float distPx = length(deltaPx);
            vec2 dir = distPx > 0.0001 ? (deltaPx / distPx) : vec2(0.0);

            float wave = sin(distPx * uWaveFrequency - age * uWaveSpeed);
            float spatialFade = exp(-distPx * uSpatialDecay);
            float timeFade = exp(-age * uTimeDecay);
            float ripple = wave * spatialFade * timeFade * uRippleAmp[i];

            totalOffsetPx += dir * ripple * uDisplacement;
        }

        totalOffsetPx = clamp(totalOffsetPx, vec2(-uClampPx), vec2(uClampPx));
        vec2 sampleUv = uv + (totalOffsetPx / uResolution);
        gl_FragColor = texture2D(u, clamp(sampleUv, 0.0, 1.0));
    }
`;

// 2. Compile & Link
const program = gl.createProgram();
[vsSource, fsSource].forEach((src, i) => {
  const s = gl.createShader(i ? gl.FRAGMENT_SHADER : gl.VERTEX_SHADER);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  gl.attachShader(program, s);
});
gl.linkProgram(program);
gl.useProgram(program);

// 3. Geometry
gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
const pos = gl.getAttribLocation(program, 'p');
gl.enableVertexAttribArray(pos);
gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

const timeLocation = gl.getUniformLocation(program, 'uTime');
const resolutionLocation = gl.getUniformLocation(program, 'uResolution');
const lifetimeLocation = gl.getUniformLocation(program, 'uLifetime');
const waveFrequencyLocation = gl.getUniformLocation(program, 'uWaveFrequency');
const waveSpeedLocation = gl.getUniformLocation(program, 'uWaveSpeed');
const spatialDecayLocation = gl.getUniformLocation(program, 'uSpatialDecay');
const timeDecayLocation = gl.getUniformLocation(program, 'uTimeDecay');
const displacementLocation = gl.getUniformLocation(program, 'uDisplacement');
const clampPxLocation = gl.getUniformLocation(program, 'uClampPx');
const ripplePosLocation = gl.getUniformLocation(program, 'uRipplePos');
const rippleTimeLocation = gl.getUniformLocation(program, 'uRippleTime');
const rippleAmpLocation = gl.getUniformLocation(program, 'uRippleAmp');

// 4. Texture & Blending (Only strict necessities)
gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); // Required (no mipmaps)

const startTime = performance.now();
const MAX_RIPPLES = 24;
const ripplePos = new Float32Array(MAX_RIPPLES * 2);
const rippleTime = new Float32Array(MAX_RIPPLES);
const rippleAmp = new Float32Array(MAX_RIPPLES);

for (let i = 0; i < MAX_RIPPLES; i += 1) {
  ripplePos[i * 2] = 0.5;
  ripplePos[i * 2 + 1] = 0.5;
  rippleTime[i] = -1000;
  rippleAmp[i] = 0;
}

let rippleHead = 0;
let lastPointerX = 0;
let lastPointerY = 0;
let hasPointer = false;

function spawnRipple(x, y, amplitude, nowSeconds) {
  const i = rippleHead;
  ripplePos[i * 2] = x;
  ripplePos[i * 2 + 1] = y;
  rippleTime[i] = nowSeconds;
  rippleAmp[i] = Math.max(RIPPLE_CONFIG.minAmplitude, Math.min(RIPPLE_CONFIG.maxAmplitude, amplitude));
  rippleHead = (rippleHead + 1) % MAX_RIPPLES;
}

canvas.addEventListener('pointermove', (event) => {
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;

  const uvX = Math.max(0, Math.min(1, x));
  const uvY = Math.max(0, Math.min(1, y));
  const nowSeconds = (performance.now() - startTime) * 0.001;

  if (hasPointer) {
    const dx = event.clientX - lastPointerX;
    const dy = event.clientY - lastPointerY;
    const speed = Math.sqrt(dx * dx + dy * dy);

    // Emit ripples only on meaningful movement, so they stay separated in space.
    if (speed > RIPPLE_CONFIG.spawnSpeedThreshold) {
      const amplitude = Math.min(RIPPLE_CONFIG.maxAmplitude, speed * RIPPLE_CONFIG.spawnSpeedGain);
      spawnRipple(uvX, uvY, amplitude, nowSeconds);
    }
  } else {
    spawnRipple(uvX, uvY, RIPPLE_CONFIG.firstRippleAmplitude, nowSeconds);
  }

  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  hasPointer = true;
});

canvas.addEventListener('pointerleave', () => {
  hasPointer = false;
});

function render() {
  const now = performance.now();
  const elapsed = (now - startTime) * 0.001;

  gl.texElementImage2D(gl.TEXTURE_2D, gl.RGBA8, content);
  gl.uniform1f(timeLocation, elapsed);
  gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
  gl.uniform1f(lifetimeLocation, RIPPLE_CONFIG.lifetimeSec);
  gl.uniform1f(waveFrequencyLocation, RIPPLE_CONFIG.waveFrequencyPx);
  gl.uniform1f(waveSpeedLocation, RIPPLE_CONFIG.waveSpeed);
  gl.uniform1f(spatialDecayLocation, RIPPLE_CONFIG.spatialDecayPx);
  gl.uniform1f(timeDecayLocation, RIPPLE_CONFIG.timeDecay);
  gl.uniform1f(displacementLocation, RIPPLE_CONFIG.displacementPx);
  gl.uniform1f(clampPxLocation, RIPPLE_CONFIG.clampPx);
  gl.uniform2fv(ripplePosLocation, ripplePos);
  gl.uniform1fv(rippleTimeLocation, rippleTime);
  gl.uniform1fv(rippleAmpLocation, rippleAmp);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  requestAnimationFrame(render);
}

canvas.addEventListener('paint', () => requestAnimationFrame(render), { once: true });
canvas.requestPaint();

const observer = new ResizeObserver(([entry]) => {
  canvas.width = entry.devicePixelContentBoxSize[0].inlineSize;
  canvas.height = entry.devicePixelContentBoxSize[0].blockSize;

  gl.viewport(0, 0, canvas.width, canvas.height);
});
observer.observe(canvas, { box: 'device-pixel-content-box' });
