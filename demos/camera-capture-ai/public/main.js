import {
  FaceLandmarker,
  FilesetResolver,
} from './vendor/tasks-vision/vision_bundle.mjs';

const SMILE_THRESHOLD = 0.4;

const video = document.getElementById('preview');
const canvas = document.getElementById('snapshot');
const ctx = canvas.getContext('2d');
const cameraSelect = document.getElementById('camera-select');
const captureBtn = document.getElementById('capture-btn');
const statusEl = document.getElementById('status');
const downloadLink = document.getElementById('download-link');

let currentStream = null;

function stopCurrentStream() {
  if (currentStream) {
    currentStream.getTracks().forEach((track) => track.stop());
    currentStream = null;
  }
}

async function startCamera(deviceId) {
  stopCurrentStream();
  statusEl.textContent = 'Requesting camera access...';

  const constraints = {
    video: deviceId ? { deviceId: { exact: deviceId } } : true,
  };

  currentStream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = currentStream;
  statusEl.textContent = '';
}

async function populateCameraList() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter((d) => d.kind === 'videoinput');

  cameraSelect.innerHTML = '';
  cameras.forEach((camera, index) => {
    const option = document.createElement('option');
    option.value = camera.deviceId;
    option.textContent = camera.label || `Camera ${index + 1}`;
    cameraSelect.appendChild(option);
  });
}

cameraSelect.addEventListener('change', () => {
  startCamera(cameraSelect.value).catch((err) => {
    statusEl.textContent = `Could not open camera: ${err.message}`;
  });
});

captureBtn.addEventListener('click', () => {
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  canvas.toBlob((blob) => {
    downloadLink.href = URL.createObjectURL(blob);
    downloadLink.style.display = 'inline-block';
  }, 'image/png');
});

const smileStatusEl = document.getElementById('smile-status');
const overlay = document.getElementById('overlay');
const overlayCtx = overlay.getContext('2d');

async function initSmileDetector() {
  const filesetResolver = await FilesetResolver.forVisionTasks('./vendor/tasks-vision/wasm');

  const faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath: './models/face_landmarker.task',
      delegate: 'GPU',
    },
    outputFaceBlendshapes: true,
    runningMode: 'VIDEO',
    numFaces: 5,
  });

  smileStatusEl.textContent = 'No face detected';

  const detect = () => {
    if (video.readyState >= 2) {
      overlay.width = video.videoWidth;
      overlay.height = video.videoHeight;

      const result = faceLandmarker.detectForVideo(video, performance.now());
      renderSmileStatus(result.faceBlendshapes);
      drawFaceBoxes(result.faceLandmarks, result.faceBlendshapes);
    }
    requestAnimationFrame(detect);
  };
  requestAnimationFrame(detect);
}

function drawFaceBoxes(faceLandmarksList, faceBlendshapesList) {
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

  faceLandmarksList.forEach((landmarks, i) => {
    const xs = landmarks.map((p) => p.x * overlay.width);
    const ys = landmarks.map((p) => p.y * overlay.height);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const isSmiling = smileScore(faceBlendshapesList[i]) > SMILE_THRESHOLD;

    overlayCtx.strokeStyle = isSmiling ? '#4caf50' : '#f44336';
    overlayCtx.lineWidth = 3;
    overlayCtx.strokeRect(minX, minY, maxX - minX, maxY - minY);

    overlayCtx.font = '32px sans-serif';
    overlayCtx.fillText('😊', minX, minY - 8);
  });
}

function smileScore(blendshapes) {
  const categories = blendshapes.categories;
  const left = categories.find((c) => c.categoryName === 'mouthSmileLeft')?.score ?? 0;
  const right = categories.find((c) => c.categoryName === 'mouthSmileRight')?.score ?? 0;
  return (left + right) / 2;
}

function renderSmileStatus(faceBlendshapes) {
  if (!faceBlendshapes.length) {
    smileStatusEl.textContent = 'No face detected';
    return;
  }

  smileStatusEl.innerHTML = '';
  faceBlendshapes.forEach((blendshapes, i) => {
    const score = smileScore(blendshapes);
    const isSmiling = score > SMILE_THRESHOLD;

    const row = document.createElement('div');
    row.className = 'face-row';
    row.innerHTML = `
      <span>${isSmiling ? '😊' : '😐'}</span>
      <div class="face-bar"><div class="face-bar-fill" style="width:${Math.round(score * 100)}%"></div></div>
      <span>${isSmiling ? 'Smiling' : ''}</span>
    `;
    smileStatusEl.appendChild(row);
  });
}

(async () => {
  try {
    // Request access first so device labels are populated, then list cameras.
    await startCamera();
    await populateCameraList();

    // If the just-granted stream isn't the one matching the select's first
    // entry, leave it as-is - the user can switch via the dropdown.
    const tracks = currentStream.getVideoTracks();
    if (tracks.length) {
      const activeId = tracks[0].getSettings().deviceId;
      if (activeId) cameraSelect.value = activeId;
    }
  } catch (err) {
    statusEl.textContent = `Could not access camera: ${err.message}`;
  }

  initSmileDetector().catch((err) => {
    smileStatusEl.textContent = `Could not load smile detector: ${err.message}`;
  });
})();
