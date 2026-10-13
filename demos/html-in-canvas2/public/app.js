const canvas = document.querySelector('canvas');
const gl = canvas.getContext('webgl2');
const content = document.querySelector('.content');

const GLITCH_CONFIG = {
  durationSec: 1.3,
  tickRate: 18.0,
  strips: 5.0,
  maxSlicePx: 22.0,
  chromaPx: 6.0,
  flickerThreshold: 0.82,
};

const MAX_GLITCHES = 4;

// 1. Shaders
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
    uniform float uDuration;
    uniform float uTickRate;
    uniform float uStrips;
    uniform float uMaxSlicePx;
    uniform float uChromaPx;
    uniform float uFlickerThreshold;
    uniform vec4 uGlitchRect[${MAX_GLITCHES}];
    uniform float uGlitchTime[${MAX_GLITCHES}];
    uniform float uGlitchSeed[${MAX_GLITCHES}];

    float hash(float n) {
        return fract(sin(n) * 43758.5453123);
    }

    void main() {
        vec2 uv = v;
        vec2 sampleUv = uv;
        float chroma = 0.0;
        float flash = 0.0;

        for (int i = 0; i < ${MAX_GLITCHES}; i++) {
            vec4 rect = uGlitchRect[i];
            vec2 local = (uv - rect.xy) / rect.zw;
            if (local.x < 0.0 || local.x > 1.0 || local.y < 0.0 || local.y > 1.0) {
                continue;
            }

            float age = uTime - uGlitchTime[i];
            if (age < 0.0 || age > uDuration) {
                break;
            }

            float amp = 1.0 - clamp(age / uDuration, 0.0, 1.0);
            float seed = uGlitchSeed[i];
            float tick = floor(age * uTickRate);

            float stripIndex = floor(local.y * uStrips);
            float activeRnd = hash(stripIndex * 17.0 + seed * 11.0 + tick * 41.0 + 5.0);
            float threshold = 0.5 * amp + 0.05;
            float sliceRnd = hash(stripIndex * 13.0 + seed * 7.0 + tick * 31.0);
            float sliceOffsetPx = activeRnd < threshold ? (sliceRnd * 2.0 - 1.0) * uMaxSlicePx * amp : 0.0;

            sampleUv.x += sliceOffsetPx / uResolution.x;
            chroma = uChromaPx * amp / uResolution.x;

            float flickerRnd = hash(seed * 23.0 + tick * 7.0 + 3.0);
            flash = flickerRnd > uFlickerThreshold ? amp : 0.0;
            break;
        }

        float r = texture2D(u, clamp(sampleUv + vec2(chroma, 0.0), 0.0, 1.0)).r;
        float g = texture2D(u, clamp(sampleUv, 0.0, 1.0)).g;
        float b = texture2D(u, clamp(sampleUv - vec2(chroma, 0.0), 0.0, 1.0)).b;
        vec3 color = vec3(r, g, b);

        vec3 flashed = vec3(color.r * 0.5, min(1.0, color.g * 1.6 + 0.2), color.b * 0.5);
        color = mix(color, flashed, flash);

        gl_FragColor = vec4(color, 1.0);
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
const durationLocation = gl.getUniformLocation(program, 'uDuration');
const tickRateLocation = gl.getUniformLocation(program, 'uTickRate');
const stripsLocation = gl.getUniformLocation(program, 'uStrips');
const maxSliceLocation = gl.getUniformLocation(program, 'uMaxSlicePx');
const chromaLocation = gl.getUniformLocation(program, 'uChromaPx');
const flickerThresholdLocation = gl.getUniformLocation(program, 'uFlickerThreshold');
const glitchRectLocation = gl.getUniformLocation(program, 'uGlitchRect');
const glitchTimeLocation = gl.getUniformLocation(program, 'uGlitchTime');
const glitchSeedLocation = gl.getUniformLocation(program, 'uGlitchSeed');

// 4. Texture
gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

const startTime = performance.now();
const glitchRect = new Float32Array(MAX_GLITCHES * 4);
const glitchTime = new Float32Array(MAX_GLITCHES).fill(-1000);
const glitchSeed = new Float32Array(MAX_GLITCHES);

for (let i = 0; i < MAX_GLITCHES; i += 1) {
  glitchRect[i * 4] = -10;
  glitchRect[i * 4 + 1] = -10;
  glitchRect[i * 4 + 2] = 1;
  glitchRect[i * 4 + 3] = 1;
}

// 5. Form validation + shatter triggers
const validators = {
  name: (value) => value.trim().length > 0,
  email: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()),
  phone: (value) => /^\d{7}$/.test(value.trim()),
};

const fields = Array.from(document.querySelectorAll('input[name]'));

function setGlitchRectFromField(slot, field) {
  const canvasRect = canvas.getBoundingClientRect();
  const fieldRect = field.getBoundingClientRect();
  glitchRect[slot * 4] = (fieldRect.left - canvasRect.left) / canvasRect.width;
  glitchRect[slot * 4 + 1] = (fieldRect.top - canvasRect.top) / canvasRect.height;
  glitchRect[slot * 4 + 2] = fieldRect.width / canvasRect.width;
  glitchRect[slot * 4 + 3] = fieldRect.height / canvasRect.height;
}

fields.forEach((field, slot) => {
  field.addEventListener('blur', () => {
    const isValid = validators[field.name](field.value);
    field.classList.toggle('invalid', !isValid);

    if (!isValid) {
      setGlitchRectFromField(slot, field);
      glitchTime[slot] = (performance.now() - startTime) * 0.001;
      glitchSeed[slot] = Math.random() * 1000;
    } else {
      glitchTime[slot] = -1000;
    }
  });
});

document.querySelector('form').addEventListener('submit', (event) => {
  event.preventDefault();
});

// 6. Render loop
function render() {
  const now = performance.now();
  const elapsed = (now - startTime) * 0.001;

  gl.texElementImage2D(gl.TEXTURE_2D, gl.RGBA8, content);
  gl.uniform1f(timeLocation, elapsed);
  gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
  gl.uniform1f(durationLocation, GLITCH_CONFIG.durationSec);
  gl.uniform1f(tickRateLocation, GLITCH_CONFIG.tickRate);
  gl.uniform1f(stripsLocation, GLITCH_CONFIG.strips);
  gl.uniform1f(maxSliceLocation, GLITCH_CONFIG.maxSlicePx);
  gl.uniform1f(chromaLocation, GLITCH_CONFIG.chromaPx);
  gl.uniform1f(flickerThresholdLocation, GLITCH_CONFIG.flickerThreshold);
  gl.uniform4fv(glitchRectLocation, glitchRect);
  gl.uniform1fv(glitchTimeLocation, glitchTime);
  gl.uniform1fv(glitchSeedLocation, glitchSeed);
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
