# Camera Capture AI

Live webcam preview + still capture, plus a real-time smile detector. Works fully offline — no CDN, no network calls.

## Run

```
npm install
npm start
```

Open `http://localhost:3003`.

## How it works

- **Camera / capture**: browser `getUserMedia` API for the live video stream, `<canvas>` + `drawImage` to grab a still frame.
- **Smile detection**: [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker) `FaceLandmarker`, running fully on-device (WASM/GPU, vendored in `public/vendor/`).
  - Model: `public/models/face_landmarker.task` — a bundle of small TFLite CNNs (face detector → landmark detector → blendshape classifier). Not an LLM; outputs numeric face geometry, not text.
  - Each video frame is run through `detectForVideo`, which returns per-face blendshape scores. `mouthSmileLeft`/`mouthSmileRight` are averaged and compared against `SMILE_THRESHOLD` in `main.js` to decide if a face is smiling.
  - Supports up to 5 faces per frame.
