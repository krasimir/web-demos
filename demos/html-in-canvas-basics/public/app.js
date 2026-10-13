const canvas = document.querySelector('canvas');
const gl = canvas.getContext('webgl2');
const content = document.querySelector('.content');
const tiltSlider = document.querySelector('#tilt');

let tiltAngle = (tiltSlider.value * Math.PI) / 180;
tiltSlider.addEventListener('input', () => {
  tiltAngle = (tiltSlider.value * Math.PI) / 180;
});

// 1. Shaders
const vsSource = `
    attribute vec2 p; varying vec2 v;
    uniform float uAngle;
    void main() {
        v = vec2(p.x, -p.y) * 0.5 + 0.5;

        // Rotate the flat quad around the Y axis (z starts at 0).
        float x = p.x * cos(uAngle);
        float z = -p.x * sin(uAngle);

        // Perspective divide: edges further in z shrink toward the vanishing point.
        float w = 1.0 - z * 0.5;
        gl_Position = vec4(x, p.y, 0.0, w);
    }
`;
const fsSource = `
    precision mediump float;
    varying vec2 v;
    uniform sampler2D u;
    void main() {
        gl_FragColor = texture2D(u, v);
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

const angleLocation = gl.getUniformLocation(program, 'uAngle');

// 4. Texture
gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

function render() {
  gl.texElementImage2D(gl.TEXTURE_2D, gl.RGBA8, content);
  gl.uniform1f(angleLocation, tiltAngle);
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
