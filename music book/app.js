const DB_NAME = "music-book-db";
const DB_VERSION = 1;
const STORE_NAME = "tracks";

const state = {
  db: null,
  onlineResults: [],
  library: [],
  queue: [],
  queueIndex: -1,
  queueLabel: "No mix loaded yet",
  currentTrack: null,
  currentBlobUrl: null,
  installPrompt: null,
  searchTerm: "",
};

const audio = document.getElementById("audioPlayer");
const elements = {
  cdPlayer: document.getElementById("cdPlayer"),
  discArt: document.getElementById("discArt"),
  discArtRing: document.getElementById("discArtRing"),
  discInitials: document.getElementById("discInitials"),
  screenTitle: document.getElementById("screenTitle"),
  screenMeta: document.getElementById("screenMeta"),
  sourceBadge: document.getElementById("sourceBadge"),
  queueHint: document.getElementById("queueHint"),
  currentTime: document.getElementById("currentTime"),
  durationTime: document.getElementById("durationTime"),
  progressRail: document.getElementById("progressRail"),
  progressFill: document.getElementById("progressFill"),
  playPauseBtn: document.getElementById("playPauseBtn"),
  prevBtn: document.getElementById("prevBtn"),
  nextBtn: document.getElementById("nextBtn"),
  shuffleBtn: document.getElementById("shuffleBtn"),
  luckyMixCardBtn: document.getElementById("luckyMixCardBtn"),
  searchForm: document.getElementById("searchForm"),
  searchInput: document.getElementById("searchInput"),
  searchStatus: document.getElementById("searchStatus"),
  searchResults: document.getElementById("searchResults"),
  fileInput: document.getElementById("fileInput"),
  downloadForm: document.getElementById("downloadForm"),
  downloadUrl: document.getElementById("downloadUrl"),
  downloadTitle: document.getElementById("downloadTitle"),
  downloadArtist: document.getElementById("downloadArtist"),
  libraryStatus: document.getElementById("libraryStatus"),
  libraryList: document.getElementById("libraryList"),
  onlineCount: document.getElementById("onlineCount"),
  offlineCount: document.getElementById("offlineCount"),
  mixNowPlaying: document.getElementById("mixNowPlaying"),
  mixNowPlayingMeta: document.getElementById("mixNowPlayingMeta"),
  installBtn: document.getElementById("installBtn"),
  installStatus: document.getElementById("installStatus"),
  moodButtons: Array.from(document.querySelectorAll("[data-mood]")),
};

init().catch((error) => {
  console.error(error);
  setStatus(
    elements.searchStatus,
    "The music shelf hit a snag while loading. Refresh the page and try again."
  );
});

async function init() {
  bindEvents();
  renderSearchResults();
  renderLibrary();
  updateCounts();
  updatePlayerUI();
  registerServiceWorker();

  if ("indexedDB" in window) {
    state.db = await openDatabase();
    await refreshLibrary();
  } else {
    setStatus(
      elements.libraryStatus,
      "This browser does not support offline saving with IndexedDB."
    );
  }
}

function bindEvents() {
  elements.searchForm.addEventListener("submit", handleSearch);
  elements.fileInput.addEventListener("change", handleFileImport);
  elements.downloadForm.addEventListener("submit", handleDirectSave);
  elements.searchResults.addEventListener("click", handleSearchResultClick);
  elements.libraryList.addEventListener("click", handleLibraryClick);
  elements.playPauseBtn.addEventListener("click", togglePlayPause);
  elements.prevBtn.addEventListener("click", () => stepQueue(-1));
  elements.nextBtn.addEventListener("click", () => stepQueue(1));
  elements.shuffleBtn.addEventListener("click", startLuckyMix);
  elements.luckyMixCardBtn.addEventListener("click", startLuckyMix);
  elements.progressRail.addEventListener("click", seekAudio);
  elements.installBtn.addEventListener("click", installApp);

  for (const button of elements.moodButtons) {
    button.addEventListener("click", () => {
      const mood = button.dataset.mood || "";
      elements.searchInput.value = mood;
      void searchCatalog(mood);
    });
  }

  audio.addEventListener("play", updatePlaybackState);
  audio.addEventListener("pause", updatePlaybackState);
  audio.addEventListener("timeupdate", updateProgress);
  audio.addEventListener("loadedmetadata", updateProgress);
  audio.addEventListener("ended", handleTrackEnded);
  audio.addEventListener("error", () => {
    setStatus(
      elements.searchStatus,
      "This track could not be played. Try another one."
    );
    updatePlaybackState();
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.installPrompt = event;
    elements.installBtn.hidden = false;
    elements.installStatus.textContent =
      "Music Book is ready to install. Add it to your device for a cozy app-like shell.";
  });

  window.addEventListener("appinstalled", () => {
    state.installPrompt = null;
    elements.installBtn.hidden = true;
    elements.installStatus.textContent =
      "Music Book is installed. Your retro player now has a home on your device.";
  });

  window.addEventListener("beforeunload", cleanupBlobUrl);
}

async function handleSearch(event) {
  event.preventDefault();
  const query = elements.searchInput.value.trim();
  await searchCatalog(query);
}

async function searchCatalog(query) {
  if (!query) {
    setStatus(elements.searchStatus, "Type something fun to search for first.");
    return;
  }

  state.searchTerm = query;
  setStatus(elements.searchStatus, `Searching for "${query}"...`);
  elements.searchResults.innerHTML = "";

  try {
    const payload = await jsonpRequest(
      `https://itunes.apple.com/search?term=${encodeURIComponent(
        query
      )}&media=music&entity=song&limit=18&country=US`
    );

    const results = Array.isArray(payload.results) ? payload.results : [];
    state.onlineResults = results
      .filter((item) => item.previewUrl)
      .map((item) => ({
        id: `it-${item.trackId || makeId()}`,
        title: item.trackName || "Unknown track",
        artist: item.artistName || "Unknown artist",
        album: item.collectionName || "Online preview",
        art: (item.artworkUrl100 || "").replace("100x100bb", "600x600bb"),
        audioUrl: item.previewUrl,
        source: "online",
        kind: "preview",
        durationText: formatTime((item.trackTimeMillis || 0) / 1000),
      }));

    renderSearchResults();

    if (state.onlineResults.length === 0) {
      setStatus(
        elements.searchStatus,
        `No preview tracks turned up for "${query}". Try a different artist, mood, or genre.`
      );
      return;
    }

    setStatus(
      elements.searchStatus,
      `${state.onlineResults.length} preview tracks are ready to spin for "${query}".`
    );
    updateCounts();
  } catch (error) {
    console.error(error);
    setStatus(
      elements.searchStatus,
      "The online search shelf could not load right now. Check your internet connection and try again."
    );
  }
}

function handleSearchResultClick(event) {
  const button = event.target.closest("[data-action='play-online']");
  if (!button) {
    return;
  }

  const trackId = button.dataset.id;
  const index = state.onlineResults.findIndex((track) => track.id === trackId);
  if (index === -1) {
    return;
  }

  playQueue(state.onlineResults, index, `Preview shelf for "${state.searchTerm || "your search"}"`);
}

async function handleFileImport(event) {
  const files = Array.from(event.target.files || []).filter(isAudioFile);

  if (!files.length) {
    setStatus(
      elements.libraryStatus,
      "No audio files were selected. Pick music files to stock your offline crate."
    );
    return;
  }

  if (!state.db) {
    setStatus(
      elements.libraryStatus,
      "Offline saving is not available in this browser."
    );
    return;
  }

  setStatus(elements.libraryStatus, `Saving ${files.length} track(s) into your crate...`);

  for (const file of files) {
    const parsed = parseTrackName(file.name);
    const trackRecord = {
      id: makeId(),
      title: parsed.title,
      artist: parsed.artist,
      album: "Imported track",
      art: "",
      source: "offline",
      kind: "import",
      addedAt: Date.now(),
      audioBlob: file,
    };

    await putRecord(trackRecord);
  }

  elements.fileInput.value = "";
  await refreshLibrary();
  setStatus(
    elements.libraryStatus,
    `${files.length} track(s) joined your offline crate.`
  );
}

async function handleDirectSave(event) {
  event.preventDefault();

  if (!state.db) {
    setStatus(
      elements.libraryStatus,
      "Offline saving is not available in this browser."
    );
    return;
  }

  const url = elements.downloadUrl.value.trim();
  if (!url) {
    setStatus(elements.libraryStatus, "Paste a direct audio link first.");
    return;
  }

  setStatus(elements.libraryStatus, "Fetching audio into your offline crate...");

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const blob = await response.blob();
    const blobType = blob.type || "";

    if (blobType && !blobType.startsWith("audio/")) {
      throw new Error("The provided link did not return an audio file.");
    }

    if (!blobType && !looksLikeAudioUrl(url)) {
      throw new Error("The provided link did not return an audio file.");
    }

    const filename = url.split("/").pop() || "Saved track";
    const parsed = parseTrackName(filename);
    const trackRecord = {
      id: makeId(),
      title: elements.downloadTitle.value.trim() || parsed.title,
      artist: elements.downloadArtist.value.trim() || parsed.artist,
      album: "Saved from link",
      art: "",
      source: "offline",
      kind: "link-save",
      addedAt: Date.now(),
      audioBlob: blob,
    };

    await putRecord(trackRecord);
    await refreshLibrary();
    elements.downloadForm.reset();
    setStatus(
      elements.libraryStatus,
      `"${trackRecord.title}" is saved and ready for offline listening.`
    );
  } catch (error) {
    console.error(error);
    setStatus(
      elements.libraryStatus,
      "That link could not be saved. Make sure it points directly to an audio file and allows browser access."
    );
  }
}

function handleLibraryClick(event) {
  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) {
    return;
  }

  const trackId = actionButton.dataset.id;
  const index = state.library.findIndex((track) => track.id === trackId);
  if (index === -1) {
    return;
  }

  const action = actionButton.dataset.action;
  if (action === "play-offline") {
    playQueue(state.library, index, "Offline crate");
  }

  if (action === "delete-offline") {
    void removeLibraryTrack(trackId);
  }
}

async function removeLibraryTrack(trackId) {
  await deleteRecord(trackId);
  state.queue = state.queue.filter((track) => track.id !== trackId);

  if (state.currentTrack && state.currentTrack.id === trackId) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    cleanupBlobUrl();
    state.currentTrack = null;
    state.queueIndex = -1;
    state.queueLabel = "No mix loaded yet";
    updatePlayerUI();
  }

  await refreshLibrary();
  setStatus(elements.libraryStatus, "Track removed from your crate.");
}

function playQueue(list, index, label) {
  if (!Array.isArray(list) || !list[index]) {
    return;
  }

  state.queue = [...list];
  state.queueIndex = index;
  state.queueLabel = label;
  void startTrack(state.queue[index]);
}

async function startTrack(track) {
  if (!track) {
    return;
  }

  cleanupBlobUrl();

  const playableTrack = { ...track };
  if (playableTrack.audioBlob) {
    state.currentBlobUrl = URL.createObjectURL(playableTrack.audioBlob);
    playableTrack.audioUrl = state.currentBlobUrl;
  }

  if (!playableTrack.audioUrl) {
    setStatus(
      elements.searchStatus,
      "This track does not have a playable audio source."
    );
    return;
  }

  state.currentTrack = playableTrack;
  updatePlayerUI();
  audio.src = playableTrack.audioUrl || "";

  try {
    await audio.play();
  } catch (error) {
    console.error(error);
    setStatus(
      elements.searchStatus,
      "Playback was blocked by the browser. Press play again to start the track."
    );
    updatePlaybackState();
  }
}

function togglePlayPause() {
  if (!state.currentTrack) {
    startLuckyMix();
    return;
  }

  if (audio.paused) {
    void audio.play();
    return;
  }

  audio.pause();
}

function stepQueue(direction) {
  if (!state.queue.length) {
    setStatus(
      elements.searchStatus,
      "Load a search result or an offline track first so the player has a queue."
    );
    return;
  }

  const nextIndex = state.queueIndex + direction;
  if (nextIndex < 0 || nextIndex >= state.queue.length) {
    setStatus(
      elements.searchStatus,
      direction > 0
        ? "You reached the end of this mix."
        : "You are already at the start of this mix."
    );
    return;
  }

  state.queueIndex = nextIndex;
  void startTrack(state.queue[nextIndex]);
}

function handleTrackEnded() {
  if (state.queueIndex >= 0 && state.queueIndex < state.queue.length - 1) {
    state.queueIndex += 1;
    void startTrack(state.queue[state.queueIndex]);
    return;
  }

  updatePlaybackState();
}

function startLuckyMix() {
  const combined = [...state.library, ...state.onlineResults];
  if (!combined.length) {
    setStatus(
      elements.searchStatus,
      "Add some tracks first, then Lucky Mix can surprise you."
    );
    return;
  }

  const shuffled = shuffleArray(combined);
  playQueue(shuffled, 0, "Lucky Mix");
}

function seekAudio(event) {
  if (!audio.duration || Number.isNaN(audio.duration)) {
    return;
  }

  const rect = elements.progressRail.getBoundingClientRect();
  const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  audio.currentTime = ratio * audio.duration;
}

function updatePlaybackState() {
  const isPlaying = !audio.paused && !audio.ended && Boolean(state.currentTrack);
  elements.cdPlayer.classList.toggle("is-awake", Boolean(state.currentTrack));
  elements.cdPlayer.classList.toggle("is-playing", isPlaying);
  elements.playPauseBtn.textContent = isPlaying ? "Pause" : "Play";
  updateProgress();
  updatePlayerUI();
}

function updateProgress() {
  const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
  const progress = duration ? (current / duration) * 100 : 0;

  elements.currentTime.textContent = formatTime(current);
  elements.durationTime.textContent = duration
    ? formatTime(duration)
    : state.currentTrack?.durationText || "0:00";
  elements.progressFill.style.width = `${progress}%`;
}

function updatePlayerUI() {
  const track = state.currentTrack;
  const isPlaying = !audio.paused && !audio.ended && Boolean(track);

  elements.queueHint.textContent = state.queueLabel;
  elements.onlineCount.textContent = String(state.onlineResults.length);
  elements.offlineCount.textContent = String(state.library.length);

  if (!track) {
    elements.screenTitle.textContent = "Drop a song into the tray";
    elements.screenMeta.textContent = "Search online or load your own audio crate.";
    elements.sourceBadge.textContent = "Idle Tray";
    elements.mixNowPlaying.textContent = "Nothing yet";
    elements.mixNowPlayingMeta.textContent = "Your CD tray is waiting.";
    elements.discArt.removeAttribute("src");
    elements.discArt.hidden = true;
    elements.discArt.alt = "";
    elements.discArt.classList.remove("has-image");
    elements.discArtRing.classList.remove("has-image");
    elements.discArtRing.style.background = "";
    elements.discInitials.textContent = "MB";
    return;
  }

  const accent = pickArtworkPalette(track.title + track.artist);
  elements.discArtRing.style.background = `linear-gradient(135deg, ${accent[0]} 0%, ${accent[1]} 100%)`;
  elements.screenTitle.textContent = track.title;
  elements.screenMeta.textContent = `${track.artist} - ${track.album}`;
  elements.sourceBadge.textContent = track.source === "online" ? "Online Preview" : "Offline Crate";
  elements.mixNowPlaying.textContent = track.title;
  elements.mixNowPlayingMeta.textContent = `${track.artist} - ${isPlaying ? "spinning now" : "paused in tray"}`;
  elements.discInitials.textContent = makeInitials(track.title);

  if (track.art) {
    elements.discArt.src = track.art;
    elements.discArt.hidden = false;
    elements.discArt.alt = `${track.title} cover art`;
    elements.discArt.classList.add("has-image");
    elements.discArtRing.classList.add("has-image");
  } else {
    elements.discArt.removeAttribute("src");
    elements.discArt.hidden = true;
    elements.discArt.alt = "";
    elements.discArt.classList.remove("has-image");
    elements.discArtRing.classList.remove("has-image");
  }
}

function renderSearchResults() {
  if (!state.onlineResults.length) {
    elements.searchResults.innerHTML = `
      <article class="result-card">
        <div class="result-card-art" style="--swatch-a:#ffb649;--swatch-b:#0ea4af;">
          <div class="art-fallback">MB</div>
        </div>
        <div class="result-card-body">
          <div class="result-card-header">
            <h3>Preview shelf is waiting</h3>
            <p class="result-card-meta">Search by artist, genre, or mood and Music Book will line up fun preview tracks here.</p>
          </div>
        </div>
      </article>
    `;
    updateCounts();
    return;
  }

  elements.searchResults.innerHTML = state.onlineResults
    .map((track) => {
      const [swatchA, swatchB] = pickArtworkPalette(track.title + track.artist);
      return `
        <article class="result-card">
          <div class="result-card-art" style="--swatch-a:${swatchA};--swatch-b:${swatchB};">
            ${renderArtwork(track, "Search result artwork")}
          </div>
          <div class="result-card-body">
            <div class="result-card-header">
              <span class="result-chip">${escapeHtml(track.durationText || "Preview")}</span>
              <h3>${escapeHtml(track.title)}</h3>
              <p class="result-card-meta">${escapeHtml(track.artist)} - ${escapeHtml(track.album)}</p>
            </div>
            <div class="result-card-actions">
              <button class="action-button" type="button" data-action="play-online" data-id="${escapeHtml(
                track.id
              )}">
                Spin Preview
              </button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderLibrary() {
  if (!state.library.length) {
    elements.libraryList.innerHTML = `
      <article class="library-row">
        <div class="library-art" style="--swatch-a:#ffd46b;--swatch-b:#f46138;">
          <div class="art-fallback">CD</div>
        </div>
        <div class="library-card-main">
          <h3>Your crate is ready</h3>
          <p class="library-card-meta">Import songs from your device or save from a direct audio link to build an offline music stash.</p>
        </div>
      </article>
    `;
    updateCounts();
    return;
  }

  elements.libraryList.innerHTML = state.library
    .map((track) => {
      const [swatchA, swatchB] = pickArtworkPalette(track.title + track.artist);
      return `
        <article class="library-row">
          <div class="library-art" style="--swatch-a:${swatchA};--swatch-b:${swatchB};">
            ${renderArtwork(track, "Offline artwork")}
          </div>
          <div class="library-card-main">
            <h3>${escapeHtml(track.title)}</h3>
            <p class="library-card-meta">${escapeHtml(track.artist)} - ${escapeHtml(
              track.kind === "link-save" ? "Saved from link" : "Imported track"
            )}</p>
            <div class="library-actions-row">
              <button class="action-button alt" type="button" data-action="play-offline" data-id="${escapeHtml(
                track.id
              )}">
                Play Offline
              </button>
              <button class="ghost-button" type="button" data-action="delete-offline" data-id="${escapeHtml(
                track.id
              )}">
                Remove
              </button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  updateCounts();
}

function renderArtwork(track, label) {
  if (track.art) {
    return `<img src="${escapeHtml(track.art)}" alt="${escapeHtml(label)}" loading="lazy" />`;
  }

  return `<div class="art-fallback">${escapeHtml(makeInitials(track.title))}</div>`;
}

async function refreshLibrary() {
  if (!state.db) {
    return;
  }

  const records = await getAllRecords();
  state.library = records.sort((a, b) => b.addedAt - a.addedAt);
  renderLibrary();
  updateCounts();

  if (!state.library.length) {
    setStatus(elements.libraryStatus, "Your crate is empty for now.");
  }
}

function updateCounts() {
  elements.onlineCount.textContent = String(state.onlineResults.length);
  elements.offlineCount.textContent = String(state.library.length);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") {
    return;
  }

  navigator.serviceWorker.register("service-worker.js").catch((error) => {
    console.error("Service worker registration failed:", error);
  });
}

async function installApp() {
  if (!state.installPrompt) {
    elements.installStatus.textContent =
      "Open your browser menu and choose Install App or Add to Home Screen if the install button does not appear.";
    return;
  }

  state.installPrompt.prompt();
  const outcome = await state.installPrompt.userChoice;
  state.installPrompt = null;
  elements.installBtn.hidden = true;
  elements.installStatus.textContent =
    outcome.outcome === "accepted"
      ? "Music Book is joining your device."
      : "Install was skipped for now, but the player is still ready when you are.";
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAllRecords() {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function putRecord(record) {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function deleteRecord(id) {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function jsonpRequest(url) {
  return new Promise((resolve, reject) => {
    const callbackName = `musicBookJsonp_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Search timed out"));
    }, 15000);

    window[callbackName] = (data) => {
      cleanup();
      resolve(data);
    };

    script.src = `${url}&callback=${callbackName}`;
    script.onerror = () => {
      cleanup();
      reject(new Error("JSONP request failed"));
    };
    document.head.append(script);

    function cleanup() {
      window.clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
    }
  });
}

function cleanupBlobUrl() {
  if (state.currentBlobUrl) {
    URL.revokeObjectURL(state.currentBlobUrl);
    state.currentBlobUrl = null;
  }
}

function parseTrackName(name) {
  const base = String(name).replace(/\.[^.]+$/, "").trim();
  const parts = base.split(/\s+-\s+/);
  if (parts.length >= 2) {
    return {
      artist: parts[0].trim() || "Unknown artist",
      title: parts.slice(1).join(" - ").trim() || "Untitled track",
    };
  }

  return {
    artist: "Imported artist",
    title: base || "Untitled track",
  };
}

function isAudioFile(file) {
  if (!file) {
    return false;
  }

  if (file.type && file.type.startsWith("audio/")) {
    return true;
  }

  return looksLikeAudioUrl(file.name || "");
}

function looksLikeAudioUrl(value) {
  return /\.(mp3|wav|ogg|m4a|aac|flac|webm)(\?.*)?$/i.test(String(value));
}

function makeInitials(value) {
  const words = String(value)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (!words.length) {
    return "MB";
  }

  return words.map((word) => word[0]).join("").toUpperCase();
}

function pickArtworkPalette(seed) {
  const palettes = [
    ["#ffb649", "#f46138"],
    ["#0ea4af", "#84dfcf"],
    ["#ef7f52", "#ffd06f"],
    ["#355c7d", "#6c9fb5"],
    ["#e36d5f", "#f4c95d"],
    ["#1f9d8f", "#f2c166"],
  ];
  const index = Math.abs(hashString(seed)) % palettes.length;
  return palettes[index];
}

function hashString(value) {
  let hash = 0;
  for (const character of String(value)) {
    hash = (hash << 5) - hash + character.charCodeAt(0);
    hash |= 0;
  }
  return hash;
}

function shuffleArray(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function setStatus(element, message) {
  element.textContent = message;
}

function formatTime(seconds) {
  const totalSeconds = Math.max(0, Math.floor(seconds || 0));
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] || character;
  });
}

function makeId() {
  if (window.crypto && "randomUUID" in window.crypto) {
    return window.crypto.randomUUID();
  }

  return `track-${Date.now()}-${Math.floor(Math.random() * 1e7)}`;
}
