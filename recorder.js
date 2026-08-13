// Built-in recording: captures the canvas + game audio into a video file.
// No screen-share/mic permission prompts, since both streams are synthetic
// (canvas.captureStream + the audio destination wired up in sfx.js).
// Recording lifecycle (start/stop/keep/discard) is driven by main.js, one round at a time.

const RECORD_SCALE = 2; // 720x1280 -> 1440x2560 — 3x briefly existed but drawing the whole
                         // frame twice (once per scale) made particle-heavy moments (lots of
                         // fillRect/arc calls at 9x the pixel area) spike well past one frame's
                         // budget and stutter; 2x (4x the area) keeps that headroom while still
                         // being well above the source 720x1280.
const RECORD_FPS = 120; // actual unique-frame rate still depends on the display's refresh rate / rAF
const RECORD_VIDEO_BITRATE = 30_000_000; // 30 Mbps — generous headroom for 4K so it doesn't look compressed

// A separate, higher-resolution canvas that main.js's render loop draws a second, pre-scaled
// pass into (see drawFrame() in main.js) — recording from this instead of the visible
// 720x1280 canvas means the saved video has real high-res detail, not just an upscaled blur.
const recordCanvas = document.createElement("canvas");
recordCanvas.width = WIDTH * RECORD_SCALE;
recordCanvas.height = HEIGHT * RECORD_SCALE;
const recordCtx = recordCanvas.getContext("2d");

let mediaRecorder = null;
let isRecording = false;
let canvasStream = null; // created once and reused every round — a fresh captureStream()
                          // per round would leak an ever-growing pile of capture pipelines

// Called after a layout swap (portrait <-> lab), since the recording canvas has to match the
// new frame size. The existing capture stream is tied to the old dimensions, so it's dropped
// and lazily rebuilt at the new size on the next recording.
function resizeRecordCanvas() {
  recordCanvas.width = WIDTH * RECORD_SCALE;
  recordCanvas.height = HEIGHT * RECORD_SCALE;
  canvasStream = null;
}

function pickRecordingMimeType() {
  const candidates = [
    // Prefer native mp4 where the browser actually supports recording into it (e.g. Safari).
    "video/mp4;codecs=avc1,mp4a",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return candidates.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || "";
}

function setRecIndicator(active) {
  const el = document.getElementById("recIndicator");
  if (el) el.classList.toggle("hidden", !active);
}

function startRecording() {
  if (isRecording || !window.MediaRecorder) return;

  if (!canvasStream) canvasStream = recordCanvas.captureStream(RECORD_FPS);
  const tracks = [...canvasStream.getVideoTracks(), ...recordDestination.stream.getAudioTracks()];
  const combined = new MediaStream(tracks);

  const mimeType = pickRecordingMimeType();
  // Chunks are owned by this take alone rather than shared in a module-level array: a recorder
  // still finalizing (stop() -> the final ondataavailable -> onstop is all async) would
  // otherwise dump its last chunk into the next take's buffer, and the next take's reset would
  // wipe the array the finishing one is about to build its Blob from.
  const chunks = [];
  const rec = new MediaRecorder(combined, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: RECORD_VIDEO_BITRATE,
  });
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  rec.__chunks = chunks;
  rec.start();

  mediaRecorder = rec;
  isRecording = true;
  setRecIndicator(true);
}

// Stops the current recording and resolves with the finished Blob (or null if nothing was
// recorded). isRecording is cleared SYNCHRONOUSLY, not in onstop: callers routinely stop a take
// and immediately start the next round (the R key does exactly this), and while the flag stayed
// set the following startRecording() would hit its own `if (isRecording) return` guard and
// silently record nothing at all for that entire round — which also made that round render
// noticeably cheaper than a recorded one, since main.js only draws the second high-res pass
// while recording.
function stopRecording() {
  return new Promise((resolve) => {
    const rec = mediaRecorder;
    if (!isRecording || !rec) {
      resolve(null);
      return;
    }
    isRecording = false;
    mediaRecorder = null;
    setRecIndicator(false);
    rec.onstop = () => {
      const chunks = rec.__chunks || [];
      resolve(chunks.length ? new Blob(chunks, { type: chunks[0].type }) : null);
    };
    rec.stop();
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
