const canvas = document.querySelector('canvas');
const gl = canvas.getContext('webgl2');
const content = document.querySelector('.content');
const tiltSlider = document.querySelector('#tilt');
const titleInput = document.querySelector('#title-input');

let tiltAngle = (tiltSlider.value * Math.PI) / 180;
tiltSlider.addEventListener('input', () => {
  tiltAngle = (tiltSlider.value * Math.PI) / 180;
});

titleInput.addEventListener('input', () => {
  content.querySelector('h1').textContent = titleInput.value;
});

// 1. Shaders
const vsSource = `
    attribute vec3 p; attribute vec2 uv; varying vec2 v; varying vec3 vNormal;
    uniform float uAngle;
    void main() {
        v = uv;

        // Rotate the sphere around the Y axis.
        float x = p.x * cos(uAngle) + p.z * sin(uAngle);
        float z = -p.x * sin(uAngle) + p.z * cos(uAngle);

        // The rotated position doubles as the surface normal, since every
        // vertex sits on a unit sphere centered at the origin.
        vNormal = vec3(x, p.y, z);

        // Perspective divide: a camera sitting a fixed distance away on +Z
        // makes near vertices (large z) grow and far vertices (small z) shrink.
        float dist = 2.5;
        float w = dist - z;
        gl_Position = vec4(x, p.y, 0.0, w);
    }
`;
const fsSource = `
    precision mediump float;
    varying vec2 v; varying vec3 vNormal;
    uniform sampler2D u;
    void main() {
        // Brightest where the surface faces the camera, fading to dark
        // toward the silhouette edge of the ball. Blending toward white
        // (not just darkening) is what actually makes the center look
        // "lit" rather than merely less-dim. The visible (non-culled) face
        // of this mesh points toward -Z, hence the flipped view vector.
        float facing = max(dot(normalize(vNormal), vec3(0.0, 0.0, -1.0)), 0.0);
        float t = pow(facing, 1.4);

        vec4 color = texture2D(u, v);
        vec3 edgeColor = color.rgb * 0.12;
        vec3 centerColor = mix(color.rgb, vec3(1.0), 0.65);
        gl_FragColor = vec4(mix(edgeColor, centerColor, t), color.a);
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

// 3. Geometry — a UV sphere (latitude/longitude grid) instead of a flat quad
function buildSphere(latSegments, lonSegments) {
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let lat = 0; lat <= latSegments; lat++) {
    const theta = (lat * Math.PI) / latSegments; // 0 (top pole) to PI (bottom pole)
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    for (let lon = 0; lon <= lonSegments; lon++) {
      const phi = (lon * 2 * Math.PI) / lonSegments; // 0 to 2*PI around the equator
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);

      positions.push(sinTheta * cosPhi, cosTheta, sinTheta * sinPhi);
      uvs.push(lon / lonSegments, lat / latSegments);
    }
  }

  for (let lat = 0; lat < latSegments; lat++) {
    for (let lon = 0; lon < lonSegments; lon++) {
      const a = lat * (lonSegments + 1) + lon;
      const b = a + lonSegments + 1;

      indices.push(a, b, a + 1);
      indices.push(b, b + 1, a + 1);
    }
  }

  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    indices: new Uint16Array(indices),
  };
}

const sphere = buildSphere(24, 32);

gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ARRAY_BUFFER, sphere.positions, gl.STATIC_DRAW);
const pos = gl.getAttribLocation(program, 'p');
gl.enableVertexAttribArray(pos);
gl.vertexAttribPointer(pos, 3, gl.FLOAT, false, 0, 0);

gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ARRAY_BUFFER, sphere.uvs, gl.STATIC_DRAW);
const uv = gl.getAttribLocation(program, 'uv');
gl.enableVertexAttribArray(uv);
gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 0, 0);

gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, sphere.indices, gl.STATIC_DRAW);

const angleLocation = gl.getUniformLocation(program, 'uAngle');

// Only draw faces pointing toward the camera, so we don't see the inside
// of the sphere through its far side.
gl.enable(gl.CULL_FACE);
gl.cullFace(gl.BACK);

// 4. Texture
gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

function render() {
  gl.texElementImage2D(gl.TEXTURE_2D, gl.RGBA8, content);
  gl.uniform1f(angleLocation, tiltAngle);
  gl.drawElements(gl.TRIANGLES, sphere.indices.length, gl.UNSIGNED_SHORT, 0);

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
