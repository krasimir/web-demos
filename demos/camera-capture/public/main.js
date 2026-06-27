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
})();
