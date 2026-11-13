// YouTunes App v3.0

let currentTrack = null;
let currentFormat = "mp3-320";
let matrixMode = "audio";
let stash = [];
let isPlaying = false;

const DEFAULT_ART = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Crect width='120' height='120' fill='%231a1b20'/%3E%3Ccircle cx='60' cy='60' r='20' fill='none' stroke='%232a2b30' stroke-width='2'/%3E%3Cpolygon points='55,48 55,72 73,60' fill='%23d4564a'/%3E%3C/svg%3E";

// DOM refs
const consoleForm = document.getElementById("consoleForm");
const urlOrQueryInput = document.getElementById("urlOrQueryInput");
const pasteButton = document.getElementById("pasteButton");
const extractionPanel = document.getElementById("extractionPanel");
const searchResults = document.getElementById("searchResults");
const resultsList = document.getElementById("resultsList");
const searchTitle = document.getElementById("searchTitle");

const trackArt = document.getElementById("trackArt");
const trackTitle = document.getElementById("trackTitle");
const trackArtist = document.getElementById("trackArtist");
const trackDuration = document.getElementById("trackDuration");
const trackSource = document.getElementById("trackSource");
const artPlayBtn = document.getElementById("artPlayBtn");
const formatGrid = document.getElementById("formatGrid");
const btnAudio = document.getElementById("btnAudio");
const btnVideo = document.getElementById("btnVideo");
const btnDownload = document.getElementById("btnDownload");
const downloadLabel = document.getElementById("downloadLabel");
const btnStash = document.getElementById("btnStash");
const progressBox = document.getElementById("progressBox");
const progressMsg = document.getElementById("progressMsg");

const viewExtract = document.getElementById("viewExtract");
const viewLibrary = document.getElementById("viewLibrary");
const tabExtract = document.getElementById("tabExtract");
const tabLibrary = document.getElementById("tabLibrary");
const stashBadge = document.getElementById("stashBadge");
const libraryList = document.getElementById("libraryList");
const emptyLibrary = document.getElementById("emptyLibrary");

const audioEl = document.getElementById("audioEl");
const dockArt = document.getElementById("dockArt");
const dockTitle = document.getElementById("dockTitle");
const dockArtist = document.getElementById("dockArtist");
const dockPlayPauseBtn = document.getElementById("dockPlayPauseBtn");
const dockScrubRange = document.getElementById("dockScrubRange");
const dockScrubFill = document.getElementById("dockScrubFill");
const dockCurrentTime = document.getElementById("dockCurrentTime");
const dockTotalTime = document.getElementById("dockTotalTime");
const dockVolSlider = document.getElementById("dockVolSlider");
const dockMuteBtn = document.getElementById("dockMuteBtn");
const dockVolIcon = document.getElementById("dockVolIcon");
const dockSaveBtn = document.getElementById("dockSaveBtn");
const dockCanvas = document.getElementById("dockCanvas");
const toastLayer = document.getElementById("toastLayer");

document.addEventListener("DOMContentLoaded", () => {
  icons();
  loadStash();
  bind();
  initViz();
});

function icons() {
  if (window.lucide && typeof window.lucide.createIcons === "function") {
    try { window.lucide.createIcons(); } catch (e) {}
  }
}

function bind() {
  consoleForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = urlOrQueryInput.value.trim();
    if (v) processInput(v);
  });

  pasteButton.addEventListener("click", async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t) { urlOrQueryInput.value = t; processInput(t); }
    } catch (e) { showToast("Clipboard access denied", "warning"); }
  });

  dockPlayPauseBtn.addEventListener("click", togglePlay);
  audioEl.addEventListener("timeupdate", onTimeUpdate);
  audioEl.addEventListener("play", () => {
    isPlaying = true;
    dockPlayPauseBtn.innerHTML = '<i data-lucide="pause"></i>';
    icons();
  });
  audioEl.addEventListener("pause", () => {
    isPlaying = false;
    dockPlayPauseBtn.innerHTML = '<i data-lucide="play"></i>';
    icons();
  });

  dockScrubRange.addEventListener("input", (e) => {
    if (!isNaN(audioEl.duration)) {
      const p = e.target.value;
      dockScrubFill.style.width = p + "%";
      audioEl.currentTime = (p / 100) * audioEl.duration;
    }
  });

  dockVolSlider.addEventListener("input", (e) => {
    audioEl.volume = e.target.value;
    updateVolIcon(e.target.value);
  });

  dockMuteBtn.addEventListener("click", () => {
    if (audioEl.volume > 0) {
      audioEl.dataset.savedVol = audioEl.volume;
      audioEl.volume = 0;
      dockVolSlider.value = 0;
    } else {
      audioEl.volume = audioEl.dataset.savedVol || 0.85;
      dockVolSlider.value = audioEl.volume;
    }
    updateVolIcon(audioEl.volume);
  });

  btnDownload.addEventListener("click", doDownload);
  btnStash.addEventListener("click", () => {
    if (currentTrack) {
      saveToStash(currentTrack);
      showToast("Saved to library", "success");
    }
  });
  dockSaveBtn.addEventListener("click", () => { if (currentTrack) doDownload(); });

  window.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== urlOrQueryInput) {
      e.preventDefault();
      urlOrQueryInput.focus();
      urlOrQueryInput.select();
    }
    if (e.code === "Space" && document.activeElement !== urlOrQueryInput) {
      e.preventDefault();
      togglePlay();
    }
  });
}

function updateVolIcon(vol) {
  if (!dockVolIcon) return;
  const name = vol == 0 ? "volume-x" : vol < 0.5 ? "volume-1" : "volume-2";
  dockVolIcon.setAttribute("data-lucide", name);
  icons();
}

function switchTab(id) {
  tabExtract.classList.toggle("active", id === "extract");
  tabLibrary.classList.toggle("active", id === "library");
  viewExtract.classList.toggle("hidden", id !== "extract");
  viewLibrary.classList.toggle("hidden", id !== "library");
  if (id === "library") renderLibrary();
  icons();
}

const SUPPORTED_MEDIA_DOMAINS = [
  "youtube.com", "youtube-nocookie.com", "youtu.be", "soundcloud.com",
  "bandcamp.com", "vimeo.com", "tiktok.com", "twitter.com", "x.com"
];

function isUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(candidate);
    const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
    return ["http:", "https:"].includes(parsed.protocol) &&
      SUPPORTED_MEDIA_DOMAINS.some(domain => host === domain || host.endsWith(`.${domain}`)) &&
      parsed.pathname !== "/";
  } catch (e) {
    return false;
  }
}

function safeHttpUrl(value, fallback = "") {
  try {
    const raw = String(value || "").trim();
    const candidate = /^https?:\/\//i.test(raw) || raw.startsWith("//") ? raw : `https://${raw}`;
    const parsed = new URL(candidate);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return fallback;
    const host = parsed.hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
        host.endsWith(".lan") || host.endsWith(".home.arpa") || host.endsWith(".internal") ||
        host.endsWith(".test")) return fallback;
    const octets = host.split(".").map(Number);
    if (octets.length === 4 && octets.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) {
      const [a, b] = octets;
      if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
          (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
          (a === 100 && b >= 64 && b <= 127) || a >= 224) return fallback;
    }
    if (host === "::" || host === "::1" || host.startsWith("fc") || host.startsWith("fd") ||
        host.startsWith("fe") || host.startsWith("ff") || host.startsWith("::ffff:")) return fallback;
    return parsed.href;
  } catch (e) {
    return fallback;
  }
}

function fmtTime(sec) {
  if (!sec || isNaN(sec)) return "0:00";
  const m = Math.floor(sec / 60), s2 = Math.floor(sec % 60);
  return m + ":" + (s2 < 10 ? "0" : "") + s2;
}

async function processInput(val) {
  if (isUrl(val)) await inspectUrl(val);
  else await doSearch(val);
}

async function inspectUrl(url) {
  showToast("Analyzing media...", "info");
  btnDownload.disabled = true;
  downloadLabel.textContent = "Analyzing...";
  try {
    const res = await fetch("/api/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Unable to extract");
    }
    const data = await res.json();
    currentTrack = data;
    renderTrack(data);
    loadPlayer(data, false);
    saveToStash(data);
    extractionPanel.classList.remove("hidden");
    extractionPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    showToast("Loaded: " + data.title, "success");
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    btnDownload.disabled = false;
    downloadLabel.textContent = "Download";
  }
}

function renderTrack(data) {
  trackArt.src = safeHttpUrl(data.thumbnail, DEFAULT_ART);
  trackTitle.textContent = data.title || "Unknown";
  trackArtist.textContent = data.uploader || "Unknown";
  trackDuration.textContent = fmtTime(data.duration);
  trackSource.href = safeHttpUrl(data.webpage_url, "#");
  artPlayBtn.onclick = () => loadPlayer(data, true);
  switchMatrix(matrixMode);
  icons();
}

function switchMatrix(mode) {
  matrixMode = mode;
  btnAudio.classList.toggle("active", mode === "audio");
  btnVideo.classList.toggle("active", mode === "video");
  formatGrid.innerHTML = "";
  const list = mode === "audio" ? currentTrack?.audio_options : currentTrack?.video_options;
  if (list && list.length > 0) {
    currentFormat = list[0].format_id;
    list.forEach(opt => {
      const el = document.createElement("button");
      el.className = "format-option" + (opt.format_id === currentFormat ? " selected" : "");
      el.onclick = () => {
        formatGrid.querySelectorAll(".format-option").forEach(c => c.classList.remove("selected"));
        el.classList.add("selected");
        currentFormat = opt.format_id;
        downloadLabel.textContent = "Download " + opt.quality;
      };
      const name = document.createElement("span");
      name.className = "format-name";
      name.textContent = String(opt.quality || "Media");
      const detail = document.createElement("span");
      detail.className = "format-detail";
      detail.textContent = String(opt.sample_rate || opt.label || "");
      const extension = document.createElement("span");
      extension.className = "format-ext";
      extension.textContent = String(opt.ext || "").toUpperCase();
      el.append(name, detail, extension);
      formatGrid.appendChild(el);
    });
    downloadLabel.textContent = "Download " + list[0].quality;
  } else {
    const empty = document.createElement("span");
    empty.className = "format-detail";
    empty.textContent = "No formats available";
    formatGrid.appendChild(empty);
  }
  icons();
}

async function doDownload() {
  if (!currentTrack) return;
  const dlUrl = "/api/download?url=" + encodeURIComponent(currentTrack.webpage_url) + "&format_type=" + encodeURIComponent(currentFormat);
  progressBox.classList.remove("hidden");
  btnDownload.disabled = true;
  downloadLabel.textContent = "Converting...";
  progressMsg.textContent = "Transcoding via FFmpeg...";
  showToast("Converting media. File will download automatically.", "info");
  const a = document.createElement("a");
  a.href = dlUrl;
  a.setAttribute("download", "");
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => {
    progressBox.classList.add("hidden");
    btnDownload.disabled = false;
    downloadLabel.textContent = "Download";
    showToast("Download requested. Check your browser's downloads.", "info");
  }, 3500);
}

async function doSearch(query) {
  showToast("Searching...", "info");
  try {
    const res = await fetch("/api/search?q=" + encodeURIComponent(query));
    if (!res.ok) throw new Error("Search failed");
    const data = await res.json();
    searchTitle.textContent = 'Results for "' + query + '"';
    renderResults(data.results);
    searchResults.classList.remove("hidden");
    searchResults.scrollIntoView({ behavior: "smooth", block: "start" });
    icons();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function renderResults(results) {
  resultsList.innerHTML = "";
  (Array.isArray(results) ? results : [])
    .filter(item => item && typeof item === "object")
    .forEach(item => {
    const div = document.createElement("div");
    div.className = "result-item";
    const sourceUrl = safeHttpUrl(item.url, "");
    div.addEventListener("click", event => {
      if (!event.target.closest(".result-action") && sourceUrl) inspectUrl(sourceUrl);
    });
    const image = document.createElement("img");
    image.src = safeHttpUrl(item.thumbnail, DEFAULT_ART);
    image.alt = "";
    image.className = "result-art";
    const info = document.createElement("div");
    info.className = "result-info";
    const title = document.createElement("span");
    title.className = "result-name";
    title.textContent = String(item.title || "Untitled");
    const channel = document.createElement("span");
    channel.className = "result-channel";
    channel.textContent = String(item.uploader || "");
    info.append(title, channel);
    const duration = document.createElement("span");
    duration.className = "result-duration";
    duration.textContent = fmtTime(item.duration);
    const action = document.createElement("button");
    action.type = "button";
    action.className = "result-action";
    action.disabled = !sourceUrl;
    action.setAttribute("aria-label", "Open media");
    action.addEventListener("click", event => {
      event.stopPropagation();
      if (sourceUrl) inspectUrl(sourceUrl);
    });
    const icon = document.createElement("i");
    icon.dataset.lucide = "download";
    action.appendChild(icon);
    div.append(image, info, duration, action);
    resultsList.appendChild(div);
  });
  icons();
}

function closeSearch() {
  searchResults.classList.add("hidden");
  urlOrQueryInput.value = "";
}

function loadPlayer(track, autoplay) {
  const streamUrl = safeHttpUrl(track.stream_url, "");
  if (!streamUrl) {
    showToast("No audio preview available; use Download instead", "warning");
    return;
  }
  dockArt.src = safeHttpUrl(track.thumbnail, DEFAULT_ART);
  dockTitle.textContent = track.title || "Untitled";
  dockArtist.textContent = track.uploader || "Unknown";
  audioEl.src = streamUrl;
  if (autoplay) audioEl.play().catch(() => {});
}

function togglePlay() {
  if (!audioEl.src) return;
  audioEl.paused ? audioEl.play() : audioEl.pause();
}

function onTimeUpdate() {
  if (!isNaN(audioEl.duration)) {
    const p = (audioEl.currentTime / audioEl.duration) * 100;
    dockScrubRange.value = p;
    dockScrubFill.style.width = p + "%";
    dockCurrentTime.textContent = fmtTime(audioEl.currentTime);
    dockTotalTime.textContent = fmtTime(audioEl.duration);
  }
}

function initViz() {
  const c = dockCanvas;
  if (!c) return;
  const ctx = c.getContext("2d");
  (function draw() {
    ctx.clearRect(0, 0, c.width, c.height);
    for (let i = 0; i < 12; i++) {
      let h = 2;
      if (isPlaying) {
        const t = Date.now() / 160;
        h = Math.abs(Math.sin(t + i * 0.5) * Math.cos(t * 0.7 + i * 0.3)) * (c.height - 4) + 2;
      }
      ctx.fillStyle = isPlaying ? "#d4564a" : "#2a2b30";
      ctx.fillRect(i * 5 + 2, c.height - h - 1, 3, h);
    }
    requestAnimationFrame(draw);
  })();
}

// Stash / Library
function loadStash() {
  try {
    const d = localStorage.getItem("youtunes_stash");
    if (d) {
      const saved = JSON.parse(d);
      stash = Array.isArray(saved) ? saved.filter(item => item && typeof item === "object").slice(0, 30) : [];
      stashBadge.textContent = stash.length;
    }
  } catch (e) {}
}

function saveToStash(track) {
  stash = stash.filter(s => s.id !== track.id);
  stash.unshift({
    id: track.id, title: track.title, uploader: track.uploader,
    thumbnail: track.thumbnail, duration: track.duration,
    url: track.webpage_url,
    timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  });
  if (stash.length > 30) stash.pop();
  try {
    localStorage.setItem("youtunes_stash", JSON.stringify(stash));
    stashBadge.textContent = stash.length;
  } catch (e) {}
}

function renderLibrary() {
  if (stash.length === 0) {
    emptyLibrary.classList.remove("hidden");
    libraryList.classList.add("hidden");
    return;
  }
  emptyLibrary.classList.add("hidden");
  libraryList.classList.remove("hidden");
  libraryList.innerHTML = "";
  (Array.isArray(stash) ? stash : []).forEach(item => {
    const div = document.createElement("div");
    div.className = "result-item";
    const sourceUrl = safeHttpUrl(item.url, "");
    div.addEventListener("click", event => {
      if (!event.target.closest(".result-action") && sourceUrl) {
        switchTab("extract");
        inspectUrl(sourceUrl);
      }
    });
    const image = document.createElement("img");
    image.src = safeHttpUrl(item.thumbnail, DEFAULT_ART);
    image.alt = "";
    image.className = "result-art";
    const info = document.createElement("div");
    info.className = "result-info";
    const title = document.createElement("span");
    title.className = "result-name";
    title.textContent = String(item.title || "Untitled");
    const channel = document.createElement("span");
    channel.className = "result-channel";
    channel.textContent = String(item.uploader || "");
    info.append(title, channel);
    const timestamp = document.createElement("span");
    timestamp.className = "result-duration";
    timestamp.textContent = String(item.timestamp || "");
    const action = document.createElement("button");
    action.type = "button";
    action.className = "result-action";
    action.disabled = !sourceUrl;
    action.setAttribute("aria-label", "Open media");
    action.addEventListener("click", event => {
      event.stopPropagation();
      if (sourceUrl) {
        switchTab("extract");
        inspectUrl(sourceUrl);
      }
    });
    const icon = document.createElement("i");
    icon.dataset.lucide = "download";
    action.appendChild(icon);
    div.append(image, info, timestamp, action);
    libraryList.appendChild(div);
  });
  icons();
}

function clearStash() {
  stash = [];
  localStorage.removeItem("youtunes_stash");
  stashBadge.textContent = "0";
  renderLibrary();
  showToast("Library cleared", "info");
}

function showToast(msg, type) {
  const t = document.createElement("div");
  t.className = "toast-pill";
  const ic = type === "success" ? "check-circle-2" : type === "warning" ? "alert-triangle" : type === "error" ? "x-circle" : "info";
  const icon = document.createElement("i");
  icon.dataset.lucide = ic;
  const text = document.createElement("span");
  text.textContent = String(msg ?? "");
  t.append(icon, text);
  toastLayer.appendChild(t);
  icons();
  setTimeout(() => {
    t.style.opacity = "0";
    t.style.transform = "translateY(8px)";
    setTimeout(() => t.remove(), 200);
  }, 3500);
}
