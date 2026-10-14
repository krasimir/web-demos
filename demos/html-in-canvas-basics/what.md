# How `app.js` works, step by step

This file takes a piece of HTML on the page, "films" it, and wraps it around a spinning sphere using WebGL — like a label wrapped around a globe. A second input next to the slider lets you change the `<h1>` text live.

**Step 1 — Grab the pieces from the page**
```js
const canvas = document.querySelector('canvas');
const gl = canvas.getContext('webgl2');
const content = document.querySelector('.content');
const tiltSlider = document.querySelector('#tilt');
const titleInput = document.querySelector('#title-input');
```
The script finds five things already sitting in the HTML: the `<canvas>` tag, a WebGL "pen" (`gl`) to draw on it, some other element called `.content` (the thing we're going to photograph), the rotate slider, and a text input for the title.

**Step 2 — Read the slider's starting position, and wire up the title input**
```js
let tiltAngle = (tiltSlider.value * Math.PI) / 180;
tiltSlider.addEventListener('input', () => { ... });

titleInput.addEventListener('input', () => {
  content.querySelector('h1').textContent = titleInput.value;
});
```
`tiltAngle` starts at whatever the slider currently says, converted from degrees to radians. The slider now goes from 0° to 360°, so dragging it all the way spins the sphere one full turn. Typing in the title input directly rewrites the `.content` div's `<h1>` text — since that same element is snapshotted into the texture every frame (step 8a), the sphere's surface updates live as you type.

**Step 3 — Write the two GPU mini-programs (shaders)**
```js
const vsSource = `
    attribute vec3 p; attribute vec2 uv; varying vec2 v;
    uniform float uAngle;
    void main() {
        v = uv;
        float x = p.x * cos(uAngle) + p.z * sin(uAngle);
        float z = -p.x * sin(uAngle) + p.z * cos(uAngle);
        float dist = 2.5;
        float w = dist - z;
        gl_Position = vec4(x, p.y, 0.0, w);
    }
`;
const fsSource = `...`;
```
These are just template strings — text. Nothing runs yet. They're written in GLSL, a language the graphics card understands.
- The **vertex shader** now receives a real 3D position `p` (x, y, z) for each point on the sphere's surface, plus a texture coordinate `uv` computed in JavaScript (step 5) rather than derived in the shader. It rotates each point around the Y axis by `uAngle`, then applies a simple camera-at-fixed-distance perspective trick: points closer to the camera (larger `z`) get a smaller `w`, which — because the GPU automatically divides by `w` — makes them appear bigger, and vice versa for points further away.
- The **fragment shader** is unchanged: it just looks up the color from the texture (`u`) at coordinate `v` and paints that pixel.

**Step 4 — Compile and link the shaders into a program**
```js
const program = gl.createProgram();
[vsSource, fsSource].forEach(...)
gl.linkProgram(program);
gl.useProgram(program);
```
Same as before: the GPU compiles the GLSL text, bundles the two shaders into one `program`, and WebGL is told to use it.

**Step 5 — Build and upload a sphere mesh**
```js
function buildSphere(latSegments, lonSegments) { ... }
const sphere = buildSphere(24, 32);

gl.bufferData(gl.ARRAY_BUFFER, sphere.positions, gl.STATIC_DRAW); // p
gl.bufferData(gl.ARRAY_BUFFER, sphere.uvs, gl.STATIC_DRAW);       // uv
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, sphere.indices, gl.STATIC_DRAW);
```
Instead of 4 hardcoded corners of a flat square, this generates a **UV sphere**: a grid of points going around in latitude rings (top pole to bottom pole) and longitude slices (all the way around), 24 rings × 32 slices here. For each point it computes:
- A 3D position on a unit sphere (`sin`/`cos` of the latitude/longitude angles).
- A texture coordinate (`uv`), mapping the flat rectangular photo onto the sphere the same way a world map wraps onto a globe — left and right edges of the photo meet on the far side of the ball.

It also builds an **index buffer**: instead of listing every triangle's corners directly, it lists which of the shared grid points make up each triangle, so neighboring triangles reuse points instead of duplicating them.

**Step 6 — Only draw the near side of the sphere**
```js
gl.enable(gl.CULL_FACE);
gl.cullFace(gl.BACK);
```
A sphere has a "front" (facing the camera) and a "back" (facing away). Without this, we'd see the inside-out far side of the ball bleeding through the near side. This tells WebGL to skip ("cull") triangles that face away from the camera, so only the visible near surface gets drawn.

**Step 7 — Set up an empty texture slot**
```js
gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
gl.texParameteri(...);
```
This reserves a "picture frame" on the GPU. It's empty for now — it gets filled every frame, in step 8.

**Step 8 — Start the render loop, but wait for the canvas to be ready**
```js
canvas.addEventListener('paint', () => requestAnimationFrame(render), { once: true });
canvas.requestPaint();
```
`render` isn't called directly. The code asks the canvas "let me know when you're ready to paint," and only then kicks off the loop. This is a newer browser mechanism for coordinating with HTML-based textures.

**Step 9 — Every single frame, `render()` runs this sequence:**
```js
function render() {
  gl.texElementImage2D(gl.TEXTURE_2D, gl.RGBA8, content);                       // (a)
  gl.uniform1f(angleLocation, tiltAngle);                                       // (b)
  gl.drawElements(gl.TRIANGLES, sphere.indices.length, gl.UNSIGNED_SHORT, 0);   // (c)
  requestAnimationFrame(render);                                                // (d)
}
```
  - **(a)** Take a fresh snapshot of the live `.content` HTML element (including whatever title you've typed) and shove it into the texture slot from step 7. Every frame gets the latest look.
  - **(b)** Send the *current* rotation angle (whatever the slider last set) into the shader.
  - **(c)** Tell the GPU: draw every triangle described by the sphere's index buffer, now, using the current texture and angle — this is the actual pixels-hit-the-screen moment. (`drawElements` instead of the old `drawArrays`, because the sphere mesh shares points between triangles via indices.)
  - **(d)** Schedule this whole function to run again on the next frame (~60 times a second), so the loop — and the spin — never stops.

**Step 10 — Keep the canvas sharp if it resizes**
```js
const observer = new ResizeObserver(([entry]) => {
  canvas.width = ...;
  canvas.height = ...;
  gl.viewport(0, 0, canvas.width, canvas.height);
});
observer.observe(canvas, { box: 'device-pixel-content-box' });
```
Unchanged: matches the canvas's internal pixel grid to its real display size whenever it resizes, and tells WebGL to update its drawing area to match.

## Put together as a timeline
1. Page loads → elements found, angle read, title input wired up.
2. Shaders written, compiled, linked.
3. Sphere mesh (positions, UVs, indices) generated and uploaded; back-face culling enabled.
4. Canvas signals "ready" → render loop begins.
5. Forever, ~60x/second: snapshot `.content` → send angle → draw the sphere's triangles with that snapshot wrapped around it → repeat.
6. Meanwhile, dragging the slider updates the rotation angle (picked up by the next frame), typing in the title input rewrites the `<h1>` text (picked up by the next snapshot), and resizing the window keeps the canvas crisp.
