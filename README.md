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
* [Camera capture](./demos/camera-capture/) (port 3003) — captures a still
  photo from a connected camera using `getUserMedia`.
* [WebMCP registration](./demos/webmcp-checkout/) (port 3004) — a name/email/
  phone registration form that registers
  [WebMCP](https://webmachinelearning.github.io/webmcp/) tools via
  `navigator.modelContext`, so an agent can validate the phone number and
  submit the form without touching the DOM. (on the web:
  https://webmcp-checkout-demo.krasimir-st-tsonev.chatgpt.site/)

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
