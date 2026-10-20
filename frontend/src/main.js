import "@fontsource-variable/plus-jakarta-sans";
import "./style.css";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:3000").replace(/\/+$/, "");

// Mirrors the backend's validation so users get instant feedback
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 90_000;

const TOOLS = {
  "remove-background": {
    title: "Background Remover",
    desc: "Cut the subject out with AI. You'll get a PNG with a transparent background.",
    action: "Remove background",
    processing: "Removing the background…",
    view: "compare",
    filename: "background-removed.png",
  },
  "crop-face": {
    title: "Face Crop",
    desc: "Find a face and frame a square avatar around it. Works best with a clear, front-facing photo.",
    action: "Crop to face",
    processing: "Detecting a face…",
    view: "side",
  },
  upload: {
    title: "Image Optimizer",
    desc: "Re-encode with automatic quality and compare the real file size before and after.",
    action: "Optimize image",
    processing: "Optimizing…",
    view: "compare",
    filename: "optimized.jpg",
  },
  "social-optimize": {
    title: "Social Media Resizer",
    desc: "Smart-cropped versions for seven social formats, from square posts to stories and thumbnails.",
    action: "Create social sizes",
    processing: "Creating social sizes…",
    view: "social",
  },
};

const $ = (id) => document.getElementById(id);
const els = {
  themeToggle: $("theme-toggle"),
  status: $("api-status"),
  statusText: $("api-status-text"),
  banner: $("service-banner"),
  bannerIcon: $("service-banner-icon"),
  bannerTitle: $("service-banner-title"),
  bannerText: $("service-banner-text"),
  bannerNote: $("service-banner-note"),
  recheck: $("recheck"),
  recheckLabel: $("recheck-label"),
  toolTitle: $("tool-title"),
  toolDesc: $("tool-desc"),
  dropzone: $("dropzone"),
  input: $("file-input"),
  fileCard: $("file-card"),
  fileThumb: $("file-thumb"),
  fileName: $("file-name"),
  fileDetails: $("file-details"),
  clearFile: $("clear-file"),
  faceOptions: $("face-options"),
  socialOptions: $("social-options"),
  run: $("run"),
  runLabel: $("run-label"),
  message: $("message"),
  stage: $("stage"),
  views: {
    empty: $("view-empty"),
    loading: $("view-loading"),
    error: $("view-error"),
    compare: $("view-compare"),
    side: $("view-side"),
    social: $("view-social"),
  },
  loadingTitle: $("loading-title"),
  progress: $("progress"),
  progressBar: $("progress-bar"),
  errorView: $("view-error"),
  errorMedia: $("error-media"),
  errorPreview: $("error-preview"),
  errorIcon: $("error-icon"),
  errorTitle: $("error-title"),
  errorText: $("error-text"),
  retry: $("retry"),
  compare: $("result-compare"),
  compareBefore: $("compare-before"),
  compareAfter: $("compare-after"),
  compareAfterLayer: $("compare-after-layer"),
  sideBefore: $("side-before"),
  sideAfter: $("side-after"),
  presetList: $("preset-list"),
  presetFrame: $("preset-frame"),
  presetImg: $("preset-img"),
  resultBar: $("result-bar"),
  resultBadgeText: $("result-badge-text"),
  resultMeta: $("result-meta"),
  reset: $("reset"),
  download: $("download"),
  downloadLabel: $("download-label"),
};

const state = {
  file: null,
  previewUrl: null,
  resultUrls: [],
  busy: false,
  presets: [],
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function currentTool() {
  return document.querySelector('input[name="tool"]:checked').value;
}

/* ---------- Theme ---------- */

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  els.themeToggle.setAttribute("aria-label", `Switch to ${theme === "dark" ? "light" : "dark"} theme`);
}

els.themeToggle.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  try {
    localStorage.setItem("theme", next);
  } catch {
    // Storage can be unavailable (private mode); the theme still applies for this visit
  }
});

applyTheme(document.documentElement.dataset.theme || "light");

/* ---------- API status ---------- */

// Visitors only see these; the precise cause stays in the backend logs (and the console in dev)
const SERVICE_STATES = {
  ok: { pill: "ok", label: "Ready" },
  unavailable: {
    pill: "warning",
    label: "Preview mode",
    tone: "warning",
    icon: "#i-lock",
    title: "Image tools temporarily unavailable",
    text: "You can explore the studio and preview its features. Image processing is temporarily unavailable. Please try again later.",
  },
  offline: {
    pill: "error",
    label: "Connection issue",
    tone: "error",
    icon: "#i-offline",
    title: "We can't connect right now",
    text: "The studio couldn't reach the image service. Check your internet connection, then try again.",
  },
  restored: {
    tone: "success",
    icon: "#i-check",
    title: "Image tools are ready",
    text: "Everything is up and running. You can process images again.",
  },
};

const RESTORED_BANNER_MS = 5000;

function devLog(...args) {
  if (import.meta.env.DEV) console.warn("[AI Image Studio]", ...args);
}

const service = { key: null, checking: false, restoredTimer: 0 };

async function fetchServiceState() {
  try {
    const response = await fetch(`${API_URL}/health`, { cache: "no-store" });
    if (!response.ok) throw new Error(`health check returned HTTP ${response.status}`);
    const data = await response.json();
    const status = data.cloudinary || (data.cloudinaryConfigured ? "ok" : "missing");
    if (status === "ok") return "ok";
    devLog(`Image processing unavailable (Cloudinary status: "${status}"). See the backend logs.`);
    return "unavailable";
  } catch (err) {
    devLog(`API unreachable at ${API_URL}:`, err.message);
    return "offline";
  }
}

function showBanner(info) {
  els.banner.dataset.tone = info.tone;
  els.bannerIcon.setAttribute("href", info.icon);
  els.bannerTitle.textContent = info.title;
  els.bannerText.textContent = info.text;
  els.bannerNote.textContent = "";
  els.recheck.hidden = info.tone === "success";
  els.banner.hidden = false;
}

/**
 * Only touches the DOM when the state actually changes, so repeated checks
 * don't re-announce the same warning. Returns whether anything changed.
 */
function applyServiceState(key) {
  if (key === service.key) return false;
  const previous = service.key;
  service.key = key;
  clearTimeout(service.restoredTimer);

  const info = SERVICE_STATES[key];
  els.status.dataset.state = info.pill;
  els.statusText.textContent = info.label;

  if (key !== "ok") {
    showBanner(info);
  } else if (previous) {
    // Recovering from a problem: confirm it briefly instead of silently hiding the warning
    showBanner(SERVICE_STATES.restored);
    service.restoredTimer = setTimeout(() => (els.banner.hidden = true), RESTORED_BANNER_MS);
  } else {
    els.banner.hidden = true;
  }
  return true;
}

async function checkApi() {
  applyServiceState(await fetchServiceState());
}

async function recheckApi() {
  if (service.checking) return;
  service.checking = true;
  els.recheck.disabled = true;
  els.recheck.setAttribute("aria-busy", "true");
  els.recheckLabel.textContent = "Checking…";
  els.bannerNote.textContent = "";

  // A short minimum so the check is visibly acknowledged even when the answer is instant
  const [key] = await Promise.all([fetchServiceState(), sleep(600)]);
  const changed = applyServiceState(key);
  if (!changed && key !== "ok") {
    const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    els.bannerNote.textContent = `Still unavailable · checked at ${time}`;
  }

  service.checking = false;
  els.recheck.disabled = false;
  els.recheck.removeAttribute("aria-busy");
  els.recheckLabel.textContent = "Check again";
}

els.recheck.addEventListener("click", recheckApi);
window.addEventListener("online", checkApi);

/* ---------- Views ---------- */

function showView(name) {
  for (const [key, el] of Object.entries(els.views)) el.hidden = key !== name;
  els.resultBar.hidden = !["compare", "side", "social"].includes(name);
  els.stage.setAttribute("aria-busy", String(name === "loading"));
}

function revokeResults() {
  state.resultUrls.forEach((url) => URL.revokeObjectURL(url));
  state.resultUrls = [];
}

function resetStage() {
  revokeResults();
  showView("empty");
}

function setMessage(text, type = "") {
  els.message.textContent = text;
  els.message.dataset.type = type;
}

function setBusy(busy) {
  state.busy = busy;
  els.run.disabled = !state.file || busy;
  document.querySelectorAll('input[name="tool"], #file-input, #clear-file').forEach((el) => (el.disabled = busy));
}

/* ---------- Tool selection ---------- */

function selectTool(tool) {
  const config = TOOLS[tool];
  document.querySelector(`input[name="tool"][value="${tool}"]`).checked = true;
  els.toolTitle.textContent = config.title;
  els.toolDesc.textContent = config.desc;
  els.runLabel.textContent = config.action;
  els.faceOptions.hidden = tool !== "crop-face";
  els.socialOptions.hidden = tool !== "social-optimize";

  // A result belongs to the tool that made it
  if (!state.busy) {
    resetStage();
    setMessage(state.file ? `Ready. Press “${config.action}”.` : "");
  }
}

document.querySelectorAll('input[name="tool"]').forEach((radio) =>
  radio.addEventListener("change", () => selectTool(radio.value))
);

document.querySelectorAll("[data-open-tool]").forEach((button) =>
  button.addEventListener("click", () => {
    if (state.busy) return;
    selectTool(button.dataset.openTool);
    $("studio").scrollIntoView({ behavior: "smooth" });
    document.querySelector('input[name="tool"]:checked').focus({ preventScroll: true });
  })
);

/* ---------- File selection ---------- */

function validateFile(file) {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return `“${file.name}” isn't supported. Choose a JPEG, PNG or WebP image.`;
  }
  if (file.size > MAX_FILE_SIZE) {
    return `That image is ${formatBytes(file.size)}. The maximum size is 10 MB.`;
  }
  return null;
}

function setFile(file) {
  const error = validateFile(file);
  if (error) {
    setMessage(error, "error");
    els.input.value = "";
    return;
  }

  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.file = file;
  state.previewUrl = URL.createObjectURL(file);

  els.fileThumb.src = state.previewUrl;
  els.fileName.textContent = file.name;
  els.fileDetails.textContent = formatBytes(file.size);
  const probe = new Image();
  probe.onload = () => {
    els.fileDetails.textContent = `${probe.naturalWidth} × ${probe.naturalHeight} px · ${formatBytes(file.size)}`;
  };
  probe.src = state.previewUrl;

  els.fileCard.hidden = false;
  els.dropzone.hidden = true;
  resetStage();
  setMessage(`Ready. Press “${TOOLS[currentTool()].action}”.`);
  setBusy(false);
}

function clearFile() {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.file = null;
  state.previewUrl = null;
  els.input.value = "";
  els.fileCard.hidden = true;
  els.dropzone.hidden = false;
  resetStage();
  setMessage("");
  setBusy(false);
}

els.input.addEventListener("change", () => {
  if (els.input.files[0]) setFile(els.input.files[0]);
});

["dragenter", "dragover"].forEach((type) =>
  els.dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    els.dropzone.classList.add("dragging");
  })
);

["dragleave", "drop"].forEach((type) =>
  els.dropzone.addEventListener(type, () => els.dropzone.classList.remove("dragging"))
);

els.dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  const files = event.dataTransfer.files;
  if (files.length > 1) {
    setMessage("Please drop one image at a time.", "error");
    return;
  }
  if (files[0]) setFile(files[0]);
});

els.clearFile.addEventListener("click", clearFile);
els.reset.addEventListener("click", () => {
  clearFile();
  els.input.focus();
});

/* ---------- Loading progress ---------- */

const PHASES = ["upload", "process", "fetch"];

function setPhase(phase, { title, progress } = {}) {
  const index = PHASES.indexOf(phase);
  document.querySelectorAll(".phases li").forEach((li) => {
    const i = PHASES.indexOf(li.dataset.phase);
    li.dataset.status = i < index ? "done" : i === index ? "active" : "";
  });
  if (title) els.loadingTitle.textContent = title;

  const determinate = typeof progress === "number";
  els.progress.classList.toggle("indeterminate", !determinate);
  if (determinate) {
    const pct = Math.round(progress * 100);
    els.progressBar.style.width = `${pct}%`;
    els.progress.setAttribute("aria-valuenow", String(pct));
  } else {
    els.progress.removeAttribute("aria-valuenow");
  }
}

/* ---------- API calls ---------- */

// XHR rather than fetch so we can report real upload progress
function sendImage(endpoint, form, onUploadProgress) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/${endpoint}`);
    xhr.timeout = REQUEST_TIMEOUT_MS;
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onUploadProgress(event.loaded / event.total);
    };
    xhr.upload.onload = () => onUploadProgress(1, true);
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.response || {} });
    xhr.onerror = () => resolve({ status: 0, body: {} });
    xhr.ontimeout = () => resolve({ status: 0, timeout: true, body: {} });
    xhr.send(form);
  });
}

class StudioError extends Error {
  constructor(status, message, { timeout = false } = {}) {
    super(message);
    this.status = status;
    this.timeout = timeout;
  }
}

/**
 * Fetches the processed file itself, so previews and downloads use exactly
 * what Cloudinary produced. AI results can briefly answer 423 while generating.
 */
async function fetchResult(url, attempts = 6) {
  for (let i = 0; i < attempts; i++) {
    let response;
    try {
      response = await fetch(url);
    } catch {
      throw new StudioError(0, "The processed image couldn't be downloaded from Cloudinary. Check your connection and try again.");
    }
    if (response.ok) return response.blob();
    if (response.status !== 423) break;
    await sleep(2000);
  }
  throw new StudioError(502, "Cloudinary didn't return the processed image. Please try again.");
}

function loadImage(img, src) {
  return new Promise((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = () => reject(new StudioError(502, "This preview couldn't be loaded. Please try again."));
    img.src = src;
  });
}

function blobUrl(blob) {
  const url = URL.createObjectURL(blob);
  state.resultUrls.push(url);
  return url;
}

function setDownload(href, filename, label) {
  els.download.href = href;
  if (filename) els.download.setAttribute("download", filename);
  else els.download.removeAttribute("download");
  els.downloadLabel.textContent = label;
}

/* ---------- Result rendering ---------- */

async function renderCompare(tool, data) {
  setPhase("fetch", { title: "Preparing your result…" });
  const blob = await fetchResult(data.downloadUrl);
  const url = blobUrl(blob);

  await loadImage(els.compareBefore, state.previewUrl);
  await loadImage(els.compareAfter, url);
  els.compare.style.aspectRatio = `${els.compareBefore.naturalWidth} / ${els.compareBefore.naturalHeight}`;
  els.compareAfterLayer.classList.toggle("checker", tool === "remove-background");
  setComparePosition(els.compare, 50);

  const config = TOOLS[tool];
  const format = (blob.type.split("/")[1] || "image").toUpperCase().replace("JPEG", "JPG");
  if (tool === "upload") {
    const change = Math.round((1 - blob.size / state.file.size) * 100);
    els.resultBadgeText.textContent = change > 0 ? `${change}% smaller` : "Optimized";
    els.resultMeta.textContent =
      change > 0
        ? `${formatBytes(state.file.size)} → ${formatBytes(blob.size)} ${format}.`
        : `${formatBytes(blob.size)} ${format}. Your original was already efficiently compressed (${formatBytes(state.file.size)}).`;
  } else {
    els.resultBadgeText.textContent = "Background removed";
    els.resultMeta.textContent = `${els.compareAfter.naturalWidth} × ${els.compareAfter.naturalHeight} px ${format} · ${formatBytes(blob.size)}. The checkerboard marks transparent areas.`;
  }
  setDownload(url, config.filename, `Download ${format}`);
  showView("compare");
}

async function renderFaceCrop(data) {
  setPhase("fetch", { title: "Preparing your avatar…" });
  const blob = await fetchResult(data.downloadUrl);
  const url = blobUrl(blob);

  await Promise.all([loadImage(els.sideBefore, state.previewUrl), loadImage(els.sideAfter, url)]);

  const faces = data.facesDetected;
  els.resultBadgeText.textContent = `${faces} face${faces === 1 ? "" : "s"} detected`;
  els.resultMeta.textContent = `${data.size} × ${data.size} px JPG · ${formatBytes(blob.size)}${faces > 1 ? ". Framed on the largest face." : "."}`;
  setDownload(url, `face-${data.size}.jpg`, "Download JPG");
  showView("side");
}

function fitPresetFrame(preset) {
  const stage = els.presetFrame.parentElement;
  const style = getComputedStyle(stage);
  const maxW = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const maxH = Math.min(420, window.innerHeight * 0.55);
  const scale = Math.min(maxW / preset.width, maxH / preset.height);
  els.presetFrame.style.width = `${Math.floor(preset.width * scale)}px`;
  els.presetFrame.style.height = `${Math.floor(preset.height * scale)}px`;
}

async function showPreset(preset) {
  fitPresetFrame(preset);
  els.presetFrame.classList.add("loading");
  els.presetImg.alt = `${preset.label} version, ${preset.width} × ${preset.height} pixels`;
  els.resultBadgeText.textContent = preset.label;
  els.resultMeta.textContent = `${preset.width} × ${preset.height} px · JPG`;
  // Cloudinary's attachment URL makes the browser save the processed file
  setDownload(preset.downloadUrl, null, `Download ${preset.width} × ${preset.height}`);
  try {
    await loadImage(els.presetImg, preset.url);
  } finally {
    els.presetFrame.classList.remove("loading");
  }
}

async function renderSocial(data) {
  setPhase("fetch", { title: "Loading previews…" });
  state.presets = data.presets;

  els.presetList.replaceChildren(
    ...data.presets.map((preset, index) => {
      const chip = document.createElement("label");
      chip.className = "preset-chip";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "preset";
      input.value = preset.id;
      input.checked = index === 0;
      input.addEventListener("change", () =>
        showPreset(preset).catch((err) => setMessage(err.message, "error"))
      );
      const name = document.createElement("strong");
      name.textContent = preset.label;
      const size = document.createElement("span");
      size.textContent = `${preset.width} × ${preset.height}`;
      chip.append(input, name, size);
      return chip;
    })
  );

  showView("social");
  await showPreset(data.presets[0]);
}

window.addEventListener("resize", () => {
  if (els.views.social.hidden) return;
  const id = document.querySelector('input[name="preset"]:checked')?.value;
  const preset = state.presets.find((p) => p.id === id);
  if (preset) fitPresetFrame(preset);
});

/* ---------- Errors ---------- */

/**
 * Maps a failure to visitor-facing copy. Only the API's own validation messages
 * (bad file, no face, rate limit) are shown verbatim; server and provider faults
 * get fixed wording so internal details never reach the page.
 * `retry` is offered only where trying again straight away can plausibly work.
 */
function errorDetails(err) {
  if (err.status === 0 && err.timeout) {
    return {
      title: "This is taking longer than expected",
      text: "The request timed out before your image was ready. Please try again.",
      icon: "#i-alert",
      retry: true,
    };
  }
  if (err.status === 0) {
    return {
      title: "Connection issue",
      text: "We couldn't reach the image service. Check your internet connection and try again.",
      icon: "#i-offline",
      retry: true,
    };
  }
  if ([400, 413, 415].includes(err.status)) {
    return { title: "That image wasn't accepted", text: err.message, icon: "#i-file", hideImage: true };
  }
  if (err.status === 422) return { title: "Couldn't process this image", text: err.message, icon: "#i-image" };
  if (err.status === 429) {
    return {
      title: "Too many requests",
      text: err.message || "Please wait a few minutes and try again.",
      icon: "#i-alert",
      tone: "warning",
    };
  }
  if (err.status === 503) {
    return {
      title: "Processing temporarily unavailable",
      text: "Image processing is temporarily unavailable. Your image is still here, so please try again later.",
      icon: "#i-lock",
      tone: "warning",
    };
  }
  return {
    title: "Something went wrong",
    text: "We couldn't finish processing this image. Please try again.",
    icon: "#i-alert",
    retry: true,
  };
}

function showError(err) {
  const details = errorDetails(err);
  els.errorView.dataset.tone = details.tone || "error";
  els.errorTitle.textContent = details.title;
  els.errorIcon.setAttribute("href", details.icon);
  els.errorText.textContent = details.text;
  els.retry.hidden = !details.retry;

  const showImage = Boolean(state.previewUrl) && !details.hideImage;
  els.errorPreview.hidden = !showImage;
  els.errorMedia.classList.toggle("has-preview", showImage);
  if (showImage) els.errorPreview.src = state.previewUrl;

  showView("error");
  setMessage(details.title, details.tone || "error");
}

/* ---------- Run ---------- */

async function run() {
  if (!state.file || state.busy) return;
  const tool = currentTool();
  const config = TOOLS[tool];

  revokeResults();
  setBusy(true);
  setMessage("");
  showView("loading");
  setPhase("upload", { title: "Uploading…", progress: 0 });

  const form = new FormData();
  form.append("image", state.file);
  if (tool === "crop-face") {
    form.append("size", document.querySelector('input[name="face-size"]:checked').value);
  }

  try {
    const { status, body, timeout } = await sendImage(tool, form, (fraction, done) => {
      if (done) setPhase("process", { title: config.processing });
      else setPhase("upload", { title: `Uploading… ${Math.round(fraction * 100)}%`, progress: fraction });
    });

    if (status === 0) {
      checkApi();
      throw new StudioError(0, "", { timeout });
    }
    if (status < 200 || status >= 300) {
      devLog(`${tool} failed with HTTP ${status}:`, body.error);
      // Keep the status indicator honest if the service went down since the last check
      if (status === 503) checkApi();
      throw new StudioError(status, body.error || "");
    }

    if (config.view === "compare") await renderCompare(tool, body);
    else if (config.view === "side") await renderFaceCrop(body);
    else await renderSocial(body);

    setMessage(`Done. Your ${config.title.toLowerCase()} result is ready to download.`, "success");
    if (window.matchMedia("(max-width: 900px)").matches) {
      els.stage.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  } catch (err) {
    revokeResults();
    showError(err instanceof StudioError ? err : new StudioError(-1, "Something unexpected happened. Please try again."));
  } finally {
    setBusy(false);
  }
}

els.run.addEventListener("click", run);
els.retry.addEventListener("click", run);

/* ---------- Before/after slider ---------- */

function setComparePosition(el, value) {
  el.style.setProperty("--pos", `${value}%`);
  el.querySelector(".compare-range").value = value;
}

document.querySelectorAll(".compare").forEach((el) => {
  const range = el.querySelector(".compare-range");
  range.addEventListener("input", () => el.style.setProperty("--pos", `${range.value}%`));
});

/* ---------- Init ---------- */

selectTool(currentTool());
checkApi();
