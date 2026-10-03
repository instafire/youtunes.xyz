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

function isUrl(s) {
  return /^(https?:\/\/)?(www\.|m\.)?(youtube\.com|youtu\.be|music\.youtube\.com|soundcloud\.com|vimeo\.com|tiktok\.com)\/.+$/i.test(s);
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
  trackArt.src = data.thumbnail || DEFAULT_ART;
  trackTitle.textContent = data.title || "Unknown";
  trackArtist.textContent = data.uploader || "Unknown";
  trackDuration.textContent = fmtTime(data.duration);
  trackSource.href = data.webpage_url || "#";
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
      el.innerHTML = '<span class="format-name">' + opt.quality + '</span><span class="format-detail">' + (opt.sample_rate || opt.label) + '</span><span class="format-ext">' + opt.ext.toUpperCase() + '</span>';
      formatGrid.appendChild(el);
    });
    downloadLabel.textContent = "Download " + list[0].quality;
  } else {
    formatGrid.innerHTML = '<span style="color:var(--text-muted);font-size:0.85rem">No formats available</span>';
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
    showToast("Done! File delivered.", "success");
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
  results.forEach(item => {
    const div = document.createElement("div");
    div.className = "result-item";
    div.onclick = (e) => { if (!e.target.closest(".result-action")) inspectUrl(item.url); };
    div.innerHTML = '<img src="' + (item.thumbnail || DEFAULT_ART) + '" alt="" class="result-art"><div class="result-info"><span class="result-name">' + item.title + '</span><span class="result-channel">' + item.uploader + '</span></div><span class="result-duration">' + fmtTime(item.duration) + '</span><button class="result-action" onclick="event.stopPropagation(); inspectUrl(\'' + item.url + '\')"><i data-lucide="download"></i></button>';
    resultsList.appendChild(div);
  });
}

function closeSearch() {
  searchResults.classList.add("hidden");
  urlOrQueryInput.value = "";
}

function loadPlayer(track, autoplay) {
  if (!track.stream_url) {
    showToast("No audio preview available; use Download instead", "warning");
    return;
  }
  dockArt.src = track.thumbnail || DEFAULT_ART;
  dockTitle.textContent = track.title || "Untitled";
  dockArtist.textContent = track.uploader || "Unknown";
  audioEl.src = track.stream_url;
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
    if (d) { stash = JSON.parse(d); stashBadge.textContent = stash.length; }
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
  stash.forEach(item => {
    const div = document.createElement("div");
    div.className = "result-item";
    div.onclick = () => { switchTab("extract"); inspectUrl(item.url); };
    div.innerHTML = '<img src="' + (item.thumbnail || DEFAULT_ART) + '" alt="" class="result-art"><div class="result-info"><span class="result-name">' + item.title + '</span><span class="result-channel">' + item.uploader + '</span></div><span class="result-duration">' + item.timestamp + '</span><button class="result-action" onclick="event.stopPropagation(); switchTab(\'extract\'); inspectUrl(\'' + item.url + '\')"><i data-lucide="download"></i></button>';
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
  t.innerHTML = '<i data-lucide="' + ic + '"></i><span>' + msg + '</span>';
  toastLayer.appendChild(t);
  icons();
  setTimeout(() => {
    t.style.opacity = "0";
    t.style.transform = "translateY(8px)";
    setTimeout(() => t.remove(), 200);
  }, 3500);
}
