# web-demos

Small, framework-free demos of web platform concepts. Each one is a standalone
Express app under `demos/`.

* [HTTP streaming](./demos/http-streaming/) (port 3001) — streams an HTML
  response in chunks (`Transfer-Encoding: chunked`) to show a Suspense-style
  progressive render: an immediate "Loading..." shell, patched in place with
  real data once it's ready.
* [Parallelism](./demos/parallelism-fractal/) (port 3002) — renders a
  Mandelbrot fractal and compares main-thread execution vs. a single Web
  Worker vs. multiple parallel Web Workers.
* [Camera capture AI](./demos/camera-capture-ai/) (port 3003) — live webcam
  preview and still capture, plus a real-time, fully on-device smile detector
  built on MediaPipe Tasks Vision.
* [WebMCP registration](./demos/webmcp-checkout/) (port 3004) — a name/email/
  phone registration form that registers
  [WebMCP](https://webmachinelearning.github.io/webmcp/) tools via
  `navigator.modelContext`, so an agent can validate the phone number and
  submit the form without touching the DOM. (on the web:
  https://webmcp-checkout-demo.krasimir-st-tsonev.chatgpt.site/)
* [What's new in web UI](./demos/whats-new-in-web-ui/) (port 3005) — a
  split-screen playground with a CodeMirror-based HTML/CSS/JS editor on the
  right and a live, sandboxed preview on the left, for demoing new web
  platform features.
* [Camera basic](./demos/camera-basic/) (port 3006) — the bare minimum
  `getUserMedia` camera feed, no capture or detection.
* [Smile Jump](./demos/game-smile/) (port 3007) — a pixel-art runner you
  control by smiling at the camera; a bigger smile means a bigger jump.
* [Smile Jump PWA](./demos/game-smile-pwa/) (port 3008) — the full-viewport,
  installable PWA version of Smile Jump, built for landscape play on an
  iPhone home screen.
* [Asteroid Race](./demos/game-space-ship/) (port 3009) — a spaceship dodging
  asteroids in a fullscreen 3D tunnel, controlled by keyboard (and later a
  phone over Web Bluetooth).
* [Tilt Controller PWA](./demos/controller-pwa/) (port 3010) — an installable
  PWA that reads the phone's orientation sensors and visualizes tilt
  left/right/up/down in real time; first step toward a Bluetooth game
  controller.

## Running

Each demo is a normal npm project:

```bash
cd demos/<demo-name>
npm install
npm start
```

To run everything at once:

```bash
./start-all.sh   # starts every demo, logs to .demo-logs/<name>.log
./stop-all.sh    # force-stops all demos and frees ports 3000-3020
```

Press Ctrl+C on `start-all.sh` to stop everything it started; use
`stop-all.sh` if a process hangs and a port stays locked.
