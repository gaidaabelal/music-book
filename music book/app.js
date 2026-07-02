const DB_NAME = "music-book-db";
const DB_VERSION = 2;
const STORE_NAME = "tracks";
const SETTINGS_STORE_NAME = "settings";
const SEARCH_HISTORY_STORE_NAME = "searchHistory";
const ARCHIVE_SEARCH_ENDPOINT = "https://archive.org/advancedsearch.php";
const ARCHIVE_METADATA_ENDPOINT = "https://archive.org/metadata";
const ARCHIVE_IMAGE_ENDPOINT = "https://archive.org/services/img";
const LYRICS_SEARCH_ENDPOINT = "https://lrclib.net/api/search";
const LYRICS_FALLBACK_ENDPOINT = "https://api.lyrics.ovh/v1";
const ARCHIVE_FETCH_ROWS = 60;
const ARCHIVE_RESULT_LIMIT = 14;
const NETWORK_TIMEOUT_MS = 15000;
const SEARCH_HISTORY_LIMIT = 6;
const LOCAL_HOST_PATTERN = /^(localhost|127(?:\.\d+){3}|\[::1\])$/i;
const IOS_DEVICE_PATTERN = /iphone|ipad|ipod/i;
const ARCHIVE_PUBLIC_FILTER =
  " AND -access-restricted-item:(true) AND -collection:(loggedin) AND -collection:(deemphasize) AND -collection:(geo_restricted)";
const ARCHIVE_NON_MUSIC_FILTER =
  " AND -collection:(podcasts_mirror) AND -collection:(podcasts) AND -collection:(podcasts_miscellaneous)";
const ARCHIVE_BLOCKED_COLLECTIONS = new Set([
  "loggedin",
  "deemphasize",
  "geo_restricted",
]);
const DEFAULT_LYRIC_LINES = [
  "Stars are gathering for the next song.",
  "Choose a record and the room will start singing.",
  "Move through the sky and wake the glow.",
];

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
  searchHistory: [],
  searchToken: 0,
  starNodes: [],
  pendingGlowFrame: 0,
  pointerX: window.innerWidth / 2,
  pointerY: window.innerHeight / 2,
  lyricTrackKey: "",
  lyricEntries: [],
  lyricSourceLabel: "",
  lyricFetchPromise: null,
  lyricStatus: "idle",
  currentLyricIndex: -1,
  lyricPlayingState: false,
};

const audio = document.getElementById("audioPlayer");
const elements = {
  starsLayer: document.getElementById("starsLayer"),
  pointerAura: document.getElementById("pointerAura"),
  cdPlayer: document.getElementById("cdPlayer"),
  discShell: document.getElementById("discShell"),
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
  searchHistory: document.getElementById("searchHistory"),
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
  lyricsPanel: document.getElementById("lyricsPanel"),
  lyricsStack: document.getElementById("lyricsStack"),
  moodButtons: Array.from(document.querySelectorAll("[data-mood]")),
};

init().catch((error) => {
  console.error(error);
  setStatus(
    elements.searchStatus,
    "The listening room hit a snag while loading. Refresh the page and try again."
  );
});

async function init() {
  createStars();
  bindEvents();
  renderSearchResults();
  renderLibrary();
  renderSearchHistory();
  updateCounts();
  updatePlayerUI();
  syncLyricsPanel();
  registerServiceWorker();
  updateInstallAvailability();

  if ("indexedDB" in window) {
    state.db = await openDatabase();
    await Promise.all([refreshLibrary(), hydrateDatabaseState()]);
  } else {
    setStatus(
      elements.libraryStatus,
      "This browser does not support local saving with IndexedDB."
    );
  }

  applyLaunchPreferences();
}

function bindEvents() {
  elements.searchForm.addEventListener("submit", handleSearch);
  elements.searchHistory?.addEventListener("click", handleSearchHistoryClick);
  elements.fileInput.addEventListener("change", handleFileImport);
  elements.downloadForm.addEventListener("submit", handleDirectSave);
  elements.searchResults.addEventListener("click", handleSearchResultClick);
  elements.libraryList.addEventListener("click", handleLibraryClick);
  elements.playPauseBtn.addEventListener("click", togglePlayPause);
  elements.discShell.addEventListener("click", handleDiscInteraction);
  elements.prevBtn.addEventListener("click", () => stepQueue(-1));
  elements.nextBtn.addEventListener("click", () => stepQueue(1));
  elements.shuffleBtn.addEventListener("click", startLuckyMix);
  elements.luckyMixCardBtn.addEventListener("click", startLuckyMix);
  elements.progressRail.addEventListener("click", seekAudio);
  elements.installBtn.addEventListener("click", installApp);

  window.addEventListener("mousemove", handlePointerMove);
  window.addEventListener("pointerdown", handlePointerDown);
  window.addEventListener("resize", createStars);
  window.addEventListener("blur", resetStarGlow);
  document.addEventListener("mouseleave", resetStarGlow);

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
      "This recording could not be played. Try another one."
    );
    updatePlaybackState();
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.installPrompt = event;
    updateInstallAvailability();
  });

  window.addEventListener("appinstalled", () => {
    state.installPrompt = null;
    updateInstallAvailability();
  });

  window.addEventListener("beforeunload", cleanupBlobUrl);
}

async function handleSearch(event) {
  event.preventDefault();
  const query = elements.searchInput.value.trim();
  await searchCatalog(query);
}

function handleSearchHistoryClick(event) {
  const button = event.target.closest("[data-history-query]");
  if (!button) {
    return;
  }

  const query = button.dataset.historyQuery || "";
  if (!query) {
    return;
  }

  elements.searchInput.value = query;
  void searchCatalog(query);
}

async function searchCatalog(query) {
  if (!query) {
    setStatus(elements.searchStatus, "Type something to search for first.");
    return;
  }

  void rememberSearch(query);
  state.searchToken += 1;
  const searchToken = state.searchToken;
  state.searchTerm = query;
  setStatus(elements.searchStatus, `Searching the archive for "${query}"...`);
  elements.searchResults.innerHTML = "";

  try {
    const payload = await fetchArchiveSearch(query);
    const docs = Array.isArray(payload.docs) ? payload.docs : [];

    if (searchToken !== state.searchToken) {
      return;
    }

    if (!docs.length) {
      state.onlineResults = [];
      renderSearchResults();
      updateCounts();
      setStatus(
        elements.searchStatus,
        `No archive matches turned up for "${query}". Try broader words like jazz, choir, piano, soundtrack, or radio.`
      );
      return;
    }

    state.onlineResults = docs.map((doc) => createArchiveSeedTrack(doc, query));
    renderSearchResults();
    updateCounts();
    setStatus(
      elements.searchStatus,
      `${docs.length} archive records appeared. I'm tuning the closest playable ones now.`
    );

    void hydrateArchiveResults(searchToken);
  } catch (error) {
    if (searchToken !== state.searchToken) {
      return;
    }

    console.error(error);
    state.onlineResults = [];
    renderSearchResults();
    updateCounts();
    setStatus(
      elements.searchStatus,
      "The archive shelf could not load right now. Check your internet connection and try again."
    );
  }
}

async function hydrateArchiveResults(searchToken) {
  const pending = state.onlineResults.map((track) =>
    resolveArchiveTrack(track, searchToken)
  );

  await Promise.allSettled(pending);

  if (searchToken !== state.searchToken) {
    return;
  }

  const readyCount = state.onlineResults.filter((track) => track.status === "ready").length;
  if (!readyCount) {
    setStatus(
      elements.searchStatus,
      `The archive found records for "${state.searchTerm}", but none became playable yet. Try another search or click a card to retry its signal.`
    );
    return;
  }

  setStatus(
    elements.searchStatus,
    `${readyCount} playable full tracks are glowing and ready for "${state.searchTerm}".`
  );
}

function createArchiveSeedTrack(doc, query) {
  const identifier = readArchiveField(doc.identifier);
  const title = readArchiveField(doc.title) || "Archive recording";
  const creator = readArchiveField(doc.creator) || "Archive artist";
  const collections = readArchiveList(doc.collection);

  return {
    id: `ia-${identifier}`,
    identifier,
    title,
    artist: creator,
    album: "Open archive recording",
    art: identifier ? `${ARCHIVE_IMAGE_ENDPOINT}/${encodeURIComponent(identifier)}` : "",
    audioUrl: "",
    lyricsTitle: cleanArchiveTrackTitle(title),
    lyricsArtist: cleanArchiveArtist(creator),
    source: "archive",
    kind: "archive-item",
    durationText: "0:00",
    badgeText: "Tuning signal",
    status: "loading",
    collections,
    searchQuery: query,
    searchScore: scoreArchiveCandidate(query, {
      title,
      creator,
      identifier,
      collections,
      subject: readArchiveField(doc.subject),
      description: readArchiveField(doc.description),
    }),
    loadingPromise: null,
  };
}

async function handleSearchResultClick(event) {
  const button = event.target.closest("[data-action='play-archive']");
  if (!button) {
    return;
  }

  const trackId = button.dataset.id;
  const track = state.onlineResults.find((item) => item.id === trackId);
  if (!track) {
    return;
  }

  const preparedTrack = await resolveArchiveTrack(track, state.searchToken, true);
  if (!preparedTrack || !preparedTrack.audioUrl) {
    setStatus(
      elements.searchStatus,
      `I couldn't wake up "${track.title}" yet. Try another record or tap this one again in a moment.`
    );
    return;
  }

  const readyTracks = state.onlineResults.filter((item) => item.status === "ready");
  const readyIndex = readyTracks.findIndex((item) => item.id === trackId);
  if (readyIndex === -1) {
    return;
  }

  playQueue(
    readyTracks,
    readyIndex,
    `Archive shelf for "${state.searchTerm || "your search"}"`
  );
}

async function resolveArchiveTrack(track, searchToken, force = false) {
  if (!track) {
    return null;
  }

  if (!force && track.status === "ready" && track.audioUrl) {
    return track;
  }

  if (track.loadingPromise) {
    return track.loadingPromise;
  }

  track.status = "loading";
  track.badgeText = "Tuning signal";
  renderSearchResults();

  track.loadingPromise = (async () => {
    try {
      const payload = await fetchArchiveMetadata(track.identifier);
      if (isArchiveItemRestricted(payload.metadata)) {
        throw new Error("This archive item is access restricted.");
      }

      if (searchToken !== state.searchToken && track.source === "archive") {
        return null;
      }

      const files = Array.isArray(payload.files) ? payload.files : [];
      const audioFile = pickArchiveAudioFile(files);
      if (!audioFile?.name) {
        throw new Error("No playable audio file was found.");
      }

      const artFile = pickArchiveArtworkFile(files);
      const duration = parseArchiveDuration(
        audioFile.length || audioFile.duration || audioFile.time
      );
      const trackProfile = buildArchiveTrackProfile(track, payload, audioFile);

      track.title = trackProfile.title;
      track.artist = trackProfile.artist;
      track.album = trackProfile.album;
      track.lyricsTitle = trackProfile.lyricsTitle;
      track.lyricsArtist = trackProfile.lyricsArtist;
      track.audioUrl = buildArchiveDownloadUrl(track.identifier, audioFile.name);
      track.art = artFile
        ? buildArchiveDownloadUrl(track.identifier, artFile.name)
        : `${ARCHIVE_IMAGE_ENDPOINT}/${encodeURIComponent(track.identifier)}`;
      track.durationText = duration.timeText;
      track.badgeText = duration.badgeText;
      track.searchScore = scoreResolvedArchiveTrack(
        state.searchTerm,
        track,
        audioFile,
        duration.seconds
      );
      track.status = "ready";
    } catch (error) {
      console.error(`Archive item "${track.identifier}" could not be prepared:`, error);
      track.audioUrl = "";
      track.badgeText = "Retry signal";
      track.status = "error";
    } finally {
      track.loadingPromise = null;
      sortArchiveResults(state.searchTerm);
      renderSearchResults();
      updateCounts();
    }

    return track.status === "ready" ? track : null;
  })();

  return track.loadingPromise;
}

async function handleFileImport(event) {
  const files = Array.from(event.target.files || []).filter(isAudioFile);

  if (!files.length) {
    setStatus(
      elements.libraryStatus,
      "No audio files were selected. Pick full tracks to stock your library."
    );
    return;
  }

  if (!state.db) {
    setStatus(
      elements.libraryStatus,
      "Local saving is not available in this browser."
    );
    return;
  }

  setStatus(elements.libraryStatus, `Saving ${files.length} track(s) into your library...`);

  for (const file of files) {
    const parsed = parseTrackName(file.name);
    const trackRecord = {
      id: makeId(),
      title: parsed.title,
      artist: parsed.artist,
      album: "Imported recording",
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
    `${files.length} track(s) joined your saved library.`
  );
}

async function handleDirectSave(event) {
  event.preventDefault();

  if (!state.db) {
    setStatus(
      elements.libraryStatus,
      "Local saving is not available in this browser."
    );
    return;
  }

  const url = elements.downloadUrl.value.trim();
  if (!url) {
    setStatus(elements.libraryStatus, "Paste a direct audio link first.");
    return;
  }

  let safeUrl;
  try {
    safeUrl = validateDirectAudioUrl(url);
  } catch (error) {
    setStatus(
      elements.libraryStatus,
      error instanceof Error ? error.message : "Paste a safe direct audio link first."
    );
    return;
  }

  setStatus(elements.libraryStatus, "Fetching audio into your saved library...");

  try {
    const response = await fetchWithTimeout(safeUrl.href);
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const blob = await response.blob();
    const blobType = blob.type || "";

    if (blobType && !blobType.startsWith("audio/")) {
      throw new Error("The provided link did not return an audio file.");
    }

    if (!blobType && !looksLikeAudioUrl(safeUrl.href)) {
      throw new Error("The provided link did not return an audio file.");
    }

    const filename = safeUrl.pathname.split("/").pop() || "Saved track";
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
      `"${trackRecord.title}" is saved and ready for full listening.`
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
    playQueue(state.library, index, "Saved library");
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
  setStatus(elements.libraryStatus, "Track removed from your library.");
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
  } else {
    playableTrack.audioUrl = sanitizeMediaUrl(playableTrack.audioUrl, {
      allowBlob: true,
    });
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

function handleDiscInteraction() {
  if (!state.currentTrack) {
    startLuckyMix();
    return;
  }

  togglePlayPause();
}

function stepQueue(direction) {
  if (!state.queue.length) {
    setStatus(
      elements.searchStatus,
      "Load an archive result or one of your own tracks first so the player has a queue."
    );
    return;
  }

  const nextIndex = state.queueIndex + direction;
  if (nextIndex < 0 || nextIndex >= state.queue.length) {
    setStatus(
      elements.searchStatus,
      direction > 0
        ? "You reached the end of this stack."
        : "You are already at the start of this stack."
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
  const combined = [...state.library, ...state.onlineResults.filter((track) => track.status === "ready")];
  if (!combined.length) {
    setStatus(
      elements.searchStatus,
      "Add a few archive tracks or your own songs first, then Lucky Mix can surprise you."
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
  syncLyricsPanel();
}

function updatePlayerUI() {
  const track = state.currentTrack;
  const isPlaying = !audio.paused && !audio.ended && Boolean(track);

  elements.queueHint.textContent = state.queueLabel;
  elements.onlineCount.textContent = String(
    state.onlineResults.filter((item) => item.status === "ready").length
  );
  elements.offlineCount.textContent = String(state.library.length);

  if (!track) {
    elements.screenTitle.textContent = "Choose a full record";
    elements.screenMeta.textContent =
      "Search the archive, load your own songs, or tap the disc to start a lucky mix.";
    elements.sourceBadge.textContent = "Idle Tray";
    elements.mixNowPlaying.textContent = "Nothing yet";
    elements.mixNowPlayingMeta.textContent =
      "Pick a full track and the center disc will wake up.";
    elements.discShell.setAttribute("aria-label", "Start a lucky mix");
    elements.discShell.title = "Start a lucky mix";
    elements.discArt.removeAttribute("src");
    elements.discArt.hidden = true;
    elements.discArt.alt = "";
    elements.discArt.classList.remove("has-image");
    elements.discArtRing.classList.remove("has-image");
    elements.discArtRing.style.background = "";
    elements.discInitials.textContent = "AB";
    syncLyricsPanel();
    return;
  }

  const accent = pickArtworkPalette(track.title + track.artist);
  elements.discArtRing.style.background = `linear-gradient(135deg, ${accent[0]} 0%, ${accent[1]} 100%)`;
  elements.screenTitle.textContent = track.title;
  elements.screenMeta.textContent = `${track.artist} - ${track.album}`;
  elements.sourceBadge.textContent =
    track.source === "archive" ? "Open Archive" : "Saved Library";
  elements.mixNowPlaying.textContent = track.title;
  elements.mixNowPlayingMeta.textContent =
    `${track.artist} - ${isPlaying ? "spinning now" : "paused in tray"}`;
  elements.discShell.setAttribute(
    "aria-label",
    isPlaying ? "Pause the current track" : "Play the current track"
  );
  elements.discShell.title = isPlaying ? "Pause the current track" : "Play the current track";
  elements.discInitials.textContent = makeInitials(track.title);

  const safeArt = sanitizeMediaUrl(track.art, { allowBlob: true });
  if (safeArt) {
    elements.discArt.src = safeArt;
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

  syncLyricsPanel();
}

function renderSearchResults() {
  if (!state.onlineResults.length) {
    elements.searchResults.innerHTML = `
      <article class="result-card">
        <div class="result-card-art" style="--swatch-a:#7d93aa;--swatch-b:#d6b88d;">
          <div class="art-fallback">AB</div>
        </div>
          <div class="result-card-body">
            <div class="result-card-header">
              <h3>The archive shelf is quiet</h3>
            <p class="result-card-meta">Search by title, mood, era, or instrument and Audio Book will pull in playable recordings here.</p>
            </div>
          </div>
        </article>
    `;
    return;
  }

  elements.searchResults.innerHTML = state.onlineResults
    .map((track) => {
      const [swatchA, swatchB] = pickArtworkPalette(track.title + track.artist);
      const buttonLabel = getArchiveActionLabel(track);
      return `
        <article class="result-card ${track.status === "ready" ? "is-ready" : ""}">
          <div class="result-card-art" style="--swatch-a:${swatchA};--swatch-b:${swatchB};">
            ${renderArtwork(track, "Archive artwork")}
          </div>
          <div class="result-card-body">
            <div class="result-card-header">
              <span class="result-chip">${escapeHtml(track.badgeText || "Full Track")}</span>
              <h3>${escapeHtml(track.title)}</h3>
              <p class="result-card-meta">${escapeHtml(track.artist)} - ${escapeHtml(track.album)}</p>
            </div>
            <div class="result-card-actions">
              <button
                class="action-button"
                type="button"
                data-action="play-archive"
                data-id="${escapeHtml(track.id)}"
              >
                ${escapeHtml(buttonLabel)}
              </button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function getArchiveActionLabel(track) {
  if (track.status === "ready") {
    return "Play Full Track";
  }

  if (track.status === "error") {
    return "Retry Signal";
  }

  return "Tune & Play";
}

function renderLibrary() {
  if (!state.library.length) {
    elements.libraryList.innerHTML = `
      <article class="library-row">
        <div class="library-art" style="--swatch-a:#8ca2b8;--swatch-b:#d6b88d;">
          <div class="art-fallback">CD</div>
        </div>
        <div class="library-card-main">
          <h3>Your library is ready</h3>
          <p class="library-card-meta">Import full songs from your device or save a direct audio file link to build a personal listening shelf.</p>
        </div>
      </article>
    `;
    return;
  }

  elements.libraryList.innerHTML = state.library
    .map((track) => {
      const [swatchA, swatchB] = pickArtworkPalette(track.title + track.artist);
      return `
        <article class="library-row">
          <div class="library-art" style="--swatch-a:${swatchA};--swatch-b:${swatchB};">
            ${renderArtwork(track, "Saved artwork")}
          </div>
          <div class="library-card-main">
            <h3>${escapeHtml(track.title)}</h3>
            <p class="library-card-meta">${escapeHtml(track.artist)} - ${escapeHtml(
        track.kind === "link-save" ? "Saved from link" : "Imported recording"
      )}</p>
            <div class="library-actions-row">
              <button class="action-button alt" type="button" data-action="play-offline" data-id="${escapeHtml(
        track.id
      )}">
                Play Saved Track
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
}

function renderArtwork(track, label) {
  const safeArt = sanitizeMediaUrl(track.art, { allowBlob: true });
  if (safeArt) {
    return `<img src="${escapeHtml(safeArt)}" alt="${escapeHtml(label)}" loading="lazy" referrerpolicy="no-referrer" />`;
  }

  return `<div class="art-fallback">${escapeHtml(makeInitials(track.title))}</div>`;
}

function renderSearchHistory() {
  if (!elements.searchHistory) {
    return;
  }

  if (!state.searchHistory.length) {
    elements.searchHistory.hidden = true;
    elements.searchHistory.innerHTML = "";
    return;
  }

  elements.searchHistory.hidden = false;
  elements.searchHistory.innerHTML = `
    <span class="search-history-label">Recent searches</span>
    ${state.searchHistory
      .map(
        (term) => `
          <button
            class="history-chip"
            type="button"
            data-history-query="${escapeHtml(term)}"
          >
            ${escapeHtml(term)}
          </button>
        `
      )
      .join("")}
  `;
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
    setStatus(elements.libraryStatus, "Your saved library is empty for now.");
  }
}

async function hydrateDatabaseState() {
  if (!state.db) {
    return;
  }

  try {
    const [historyRecords, lastSearch] = await Promise.all([
      getSearchHistoryRecords(),
      getSettingValue("lastSearch"),
    ]);

    state.searchHistory = historyRecords
      .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0))
      .slice(0, SEARCH_HISTORY_LIMIT)
      .map((record) => record.term)
      .filter(Boolean);
    renderSearchHistory();

    if (!elements.searchInput.value && typeof lastSearch === "string" && lastSearch.trim()) {
      elements.searchInput.value = lastSearch.trim();
    }
  } catch (error) {
    console.error("Database state hydration failed:", error);
  }
}

async function rememberSearch(query) {
  if (!state.db) {
    return;
  }

  const trimmedQuery = String(query || "").trim();
  if (!trimmedQuery) {
    return;
  }

  try {
    await Promise.all([
      setSettingValue("lastSearch", trimmedQuery),
      upsertSearchHistory(trimmedQuery),
    ]);

    state.searchHistory = [
      trimmedQuery,
      ...state.searchHistory.filter((term) => term !== trimmedQuery),
    ].slice(0, SEARCH_HISTORY_LIMIT);
    renderSearchHistory();
  } catch (error) {
    console.error("Search history persistence failed:", error);
  }
}

function updateCounts() {
  elements.onlineCount.textContent = String(
    state.onlineResults.filter((track) => track.status === "ready").length
  );
  elements.offlineCount.textContent = String(state.library.length);
}

function syncLyricsPanel() {
  if (!elements.lyricsPanel || !elements.lyricsStack) {
    return;
  }

  const track = state.currentTrack;
  const isPlaying = !audio.paused && !audio.ended && Boolean(track);

  if (!track) {
    elements.lyricsPanel.classList.remove("is-awake", "is-singing");
    renderLyricsLines(DEFAULT_LYRIC_LINES, 0);
    state.lyricTrackKey = "";
    state.lyricEntries = [];
    state.lyricSourceLabel = "";
    state.lyricFetchPromise = null;
    state.lyricStatus = "idle";
    state.currentLyricIndex = -1;
    state.lyricPlayingState = false;
    return;
  }

  const trackKey = `${track.id}-${track.title}-${track.artist}`;
  if (state.lyricTrackKey !== trackKey) {
    state.lyricTrackKey = trackKey;
    state.lyricEntries = [];
    state.lyricSourceLabel = "";
    state.lyricStatus = "loading";
    state.lyricFetchPromise = null;
    state.currentLyricIndex = -1;
    void loadLyricsForCurrentTrack(track, trackKey);
  }

  elements.lyricsPanel.classList.add("is-awake");
  elements.lyricsPanel.classList.toggle("is-singing", isPlaying);

  if (state.lyricStatus === "loading") {
    renderLyricsLines(
      [
        `Searching live lyrics for "${track.title}"...`,
        `${track.artist} is opening a lyric channel.`,
        "If no official lyric match appears, the player will keep glowing without them.",
      ],
      0
    );
    return;
  }

  if (state.lyricStatus === "empty") {
    renderLyricsLines(
      [
        `No live lyrics showed up for "${track.title}".`,
        "This recording may not have a lyric match in the lyric library yet.",
        "Try another track, or keep listening with the star room anyway.",
      ],
      0
    );
    return;
  }

  if (state.lyricStatus === "error") {
    renderLyricsLines(
      [
        "The lyric signal faded for this track.",
        "Playback still works, but the lyric lookup did not respond cleanly.",
        "Try the song again in a moment.",
      ],
      0
    );
    return;
  }

  const lyricCount = state.lyricEntries.length || DEFAULT_LYRIC_LINES.length;
  const nextIndex = getActiveLyricIndex(lyricCount);

  if (
    nextIndex !== state.currentLyricIndex ||
    state.lyricPlayingState !== isPlaying
  ) {
    state.currentLyricIndex = nextIndex;
    state.lyricPlayingState = isPlaying;
    renderLyricsLines(
      getLyricWindow(state.lyricEntries, nextIndex).map((entry) => entry.text),
      1
    );
  }
}

async function loadLyricsForCurrentTrack(track, trackKey) {
  if (state.lyricFetchPromise) {
    return state.lyricFetchPromise;
  }

  state.lyricFetchPromise = (async () => {
    try {
      const lyricPayload = await fetchLyricsForTrack(track);
      if (state.lyricTrackKey !== trackKey) {
        return;
      }

      state.lyricEntries = lyricPayload.entries;
      state.lyricSourceLabel = lyricPayload.sourceLabel;
      state.lyricStatus = lyricPayload.entries.length ? "ready" : "empty";
      state.currentLyricIndex = -1;
      syncLyricsPanel();
    } catch (error) {
      console.error("Lyric lookup failed:", error);
      if (state.lyricTrackKey !== trackKey) {
        return;
      }

      state.lyricEntries = [];
      state.lyricSourceLabel = "";
      state.lyricStatus = "error";
      state.currentLyricIndex = -1;
      syncLyricsPanel();
    } finally {
      if (state.lyricTrackKey === trackKey) {
        state.lyricFetchPromise = null;
      }
    }
  })();

  return state.lyricFetchPromise;
}

function getActiveLyricIndex(lyricCount) {
  if (!lyricCount) {
    return 0;
  }

  const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  for (let index = lyricCount - 1; index >= 0; index -= 1) {
    if (current >= state.lyricEntries[index].time) {
      return index;
    }
  }

  return 0;
}

function getLyricWindow(entries, index) {
  const source = Array.isArray(entries) && entries.length
    ? entries
    : DEFAULT_LYRIC_LINES.map((text, lineIndex) => ({ time: lineIndex * 6, text }));
  const safeIndex = clamp(index, 0, source.length - 1);
  return [
    source[Math.max(0, safeIndex - 1)],
    source[safeIndex],
    source[Math.min(source.length - 1, safeIndex + 1)],
  ];
}

function renderLyricsLines(lines, index) {
  const source = Array.isArray(lines) && lines.length ? lines : DEFAULT_LYRIC_LINES;
  const safeIndex = clamp(index, 0, source.length - 1);
  const previous = source[Math.max(0, safeIndex - 1)];
  const current = source[safeIndex];
  const next = source[Math.min(source.length - 1, safeIndex + 1)];

  elements.lyricsStack.innerHTML = `
    <p class="lyrics-line is-ghost">${escapeHtml(previous)}</p>
    <p class="lyrics-line is-current">${escapeHtml(current)}</p>
    <p class="lyrics-line is-next">${escapeHtml(next)}</p>
  `;
}

function buildLyricsLookupCandidates(track) {
  const preferredArtist = sanitizeLyricsTerm(track.lyricsArtist || track.artist);
  const preferredTitle = sanitizeLyricsTerm(track.lyricsTitle || track.title);
  const parsedTitle = extractArtistTitle(track.title);
  const parsedQuery = extractArtistTitle(track.searchQuery || "");
  const strippedQueryTitle = stripArtistFromQuery(
    track.searchQuery || "",
    preferredArtist || sanitizeLyricsTerm(track.artist)
  );

  const rawCandidates = [
    { artist: preferredArtist, title: preferredTitle },
    { artist: sanitizeLyricsTerm(track.artist), title: sanitizeLyricsTerm(track.title) },
    parsedTitle.artist && parsedTitle.title
      ? {
        artist: sanitizeLyricsTerm(parsedTitle.artist),
        title: sanitizeLyricsTerm(parsedTitle.title),
      }
      : null,
    strippedQueryTitle && preferredArtist
      ? {
        artist: preferredArtist,
        title: sanitizeLyricsTerm(strippedQueryTitle),
      }
      : null,
    parsedQuery.artist && parsedQuery.title
      ? {
        artist: sanitizeLyricsTerm(parsedQuery.artist),
        title: sanitizeLyricsTerm(parsedQuery.title),
      }
      : null,
  ];

  const seen = new Set();
  return rawCandidates.filter((candidate) => {
    if (!candidate?.artist || !candidate?.title) {
      return false;
    }

    const key = `${candidate.artist}::${candidate.title}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

async function fetchLyricsForTrack(track) {
  const lookupCandidates = buildLyricsLookupCandidates(track);
  for (const candidate of lookupCandidates) {
    let syncedMatches = [];
    try {
      syncedMatches = await fetchSyncedLyrics(candidate.artist, candidate.title);
    } catch (error) {
      console.error("Synced lyric lookup failed:", error);
    }

    if (syncedMatches.length) {
      return {
        entries: syncedMatches,
        sourceLabel: "Synced lyrics",
      };
    }

    let plainMatches = [];
    try {
      plainMatches = await fetchPlainLyrics(candidate.artist, candidate.title);
    } catch (error) {
      console.error("Plain lyric lookup failed:", error);
    }

    if (plainMatches.length) {
      return {
        entries: buildTimedLyricEntries(plainMatches, audio.duration),
        sourceLabel: "Lyrics",
      };
    }
  }

  return { entries: [], sourceLabel: "" };
}

async function fetchSyncedLyrics(artist, title) {
  const params = new URLSearchParams();
  params.set("track_name", title);
  params.set("artist_name", artist);

  const response = await fetchWithTimeout(
    `${LYRICS_SEARCH_ENDPOINT}?${params.toString()}`
  );
  if (!response.ok) {
    throw new Error(`Lyrics search failed with status ${response.status}`);
  }

  const payload = await response.json();
  const matches = Array.isArray(payload) ? payload : [];
  const picked = pickBestLyricsMatch(matches, artist, title);
  if (!picked) {
    return [];
  }

  const synced = parseSyncedLyrics(picked.syncedLyrics || "");
  if (synced.length) {
    return synced;
  }

  const plain = splitPlainLyrics(picked.plainLyrics || "");
  return buildTimedLyricEntries(plain, audio.duration);
}

async function fetchPlainLyrics(artist, title) {
  const response = await fetchWithTimeout(
    `${LYRICS_FALLBACK_ENDPOINT}/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`
  );

  if (!response.ok) {
    return [];
  }

  const payload = await response.json();
  return splitPlainLyrics(payload.lyrics || "");
}

function pickBestLyricsMatch(matches, artist, title) {
  if (!matches.length) {
    return null;
  }

  const normalizedArtist = normalizeSearchText(artist);
  const normalizedTitle = normalizeSearchText(title);

  const ranked = matches
    .map((match) => {
      const trackName = normalizeSearchText(match.trackName || match.name || "");
      const artistName = normalizeSearchText(match.artistName || "");
      let score = 0;

      if (trackName === normalizedTitle) {
        score += 200;
      } else if (trackName.includes(normalizedTitle)) {
        score += 130;
      }

      if (artistName === normalizedArtist) {
        score += 180;
      } else if (artistName.includes(normalizedArtist) || normalizedArtist.includes(artistName)) {
        score += 120;
      }

      if (match.syncedLyrics) {
        score += 40;
      }

      return { match, score };
    })
    .sort((left, right) => right.score - left.score);

  return ranked[0]?.score > 0 ? ranked[0].match : null;
}

function parseSyncedLyrics(value) {
  const entries = String(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^\[(\d{2}):(\d{2})(?:\.(\d{1,3}))?\]\s*(.*)$/);
      if (!match) {
        return null;
      }

      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const fraction = Number((match[3] || "0").padEnd(3, "0"));
      const text = match[4].trim();
      if (!text) {
        return null;
      }

      return {
        time: minutes * 60 + seconds + fraction / 1000,
        text,
      };
    })
    .filter(Boolean);

  return entries;
}

function splitPlainLyrics(value) {
  return String(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildTimedLyricEntries(lines, durationValue) {
  const entries = Array.isArray(lines) ? lines.filter(Boolean) : [];
  if (!entries.length) {
    return [];
  }

  const duration = Number.isFinite(durationValue) && durationValue > 0
    ? durationValue
    : entries.length * 5;
  const step = duration / Math.max(entries.length, 1);

  return entries.map((text, index) => ({
    time: index * step,
    text,
  }));
}

function sanitizeLyricsTerm(value) {
  return cleanArchiveTrackTitle(
    String(value || "")
      .replace(/\[[^\]]+\]/g, " ")
      .replace(/\([^)]*\)/g, " ")
      .replace(/[_]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

async function fetchWithTimeout(resource, options = {}, timeoutMs = NETWORK_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(resource, {
      cache: "no-store",
      referrerPolicy: "no-referrer",
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("The request took too long to respond.");
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function sanitizeMediaUrl(value, options = {}) {
  const { allowBlob = false, allowData = false } = options;
  const rawValue = String(value || "").trim();
  if (!rawValue) {
    return "";
  }

  if (allowBlob && rawValue.startsWith("blob:")) {
    return rawValue;
  }

  if (allowData && /^data:(audio|image)\//i.test(rawValue)) {
    return rawValue;
  }

  try {
    const url = new URL(rawValue, window.location.href);
    const isLocalHost = LOCAL_HOST_PATTERN.test(url.hostname);
    const isSecureProtocol =
      url.protocol === "https:" ||
      (url.protocol === "http:" && isLocalHost) ||
      url.origin === window.location.origin;

    return isSecureProtocol ? url.href : "";
  } catch (error) {
    return "";
  }
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") {
    return;
  }

  navigator.serviceWorker
    .register("service-worker.js")
    .then((registration) => registration.update().catch(() => undefined))
    .catch((error) => {
      console.error("Service worker registration failed:", error);
    });
}

function updateInstallAvailability() {
  if (!elements.installBtn || !elements.installStatus) {
    return;
  }

  if (isStandaloneMode()) {
    elements.installBtn.hidden = true;
    elements.installStatus.textContent =
      "Audio Book is installed. Your listening room now lives on this device.";
    return;
  }

  if (location.protocol === "file:") {
    elements.installBtn.hidden = true;
    elements.installStatus.textContent =
      "Install works after you open Audio Book from HTTPS hosting or localhost.";
    return;
  }

  if (!("serviceWorker" in navigator)) {
    elements.installBtn.hidden = true;
    elements.installStatus.textContent =
      "Use a modern browser with app install support to add Audio Book to your device.";
    return;
  }

  elements.installBtn.hidden = false;

  if (state.installPrompt) {
    elements.installStatus.textContent =
      "Audio Book is ready to install. Add it to your device for a calmer listening space.";
    return;
  }

  if (isIosInstallCandidate()) {
    elements.installStatus.textContent =
      "On iPhone or iPad, tap Share and choose Add to Home Screen to install Audio Book.";
    return;
  }

  elements.installStatus.textContent =
    "Use the Install button or your browser menu to add Audio Book to your phone, tablet, or desktop.";
}

function isStandaloneMode() {
  const matchesStandalone =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches;
  return matchesStandalone || window.navigator.standalone === true;
}

function isIosInstallCandidate() {
  const userAgent = window.navigator.userAgent || "";
  const desktopIpad =
    window.navigator.platform === "MacIntel" &&
    Number(window.navigator.maxTouchPoints || 0) > 1;

  return IOS_DEVICE_PATTERN.test(userAgent) || desktopIpad;
}

async function installApp() {
  if (isStandaloneMode()) {
    elements.installStatus.textContent =
      "Audio Book is already installed on this device.";
    return;
  }

  if (!state.installPrompt) {
    elements.installStatus.textContent =
      isIosInstallCandidate()
        ? "On iPhone or iPad, tap Share, then Add to Home Screen."
        : "Open your browser menu and choose Install App or Add to Home Screen if the install prompt does not appear.";
    return;
  }

  state.installPrompt.prompt();
  const outcome = await state.installPrompt.userChoice;
  state.installPrompt = null;
  if (outcome.outcome === "accepted") {
    elements.installStatus.textContent = "Audio Book is joining your device.";
    return;
  }

  elements.installStatus.textContent =
    "Install was skipped for now, but the player is still ready when you are.";
  updateInstallAvailability();
}

function applyLaunchPreferences() {
  const params = new URLSearchParams(window.location.search);
  const query = (params.get("search") || params.get("mood") || "").trim();

  if (!query) {
    return;
  }

  elements.searchInput.value = query;
  void searchCatalog(query);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(SETTINGS_STORE_NAME)) {
        db.createObjectStore(SETTINGS_STORE_NAME, { keyPath: "key" });
      }

      if (!db.objectStoreNames.contains(SEARCH_HISTORY_STORE_NAME)) {
        const searchHistoryStore = db.createObjectStore(SEARCH_HISTORY_STORE_NAME, {
          keyPath: "term",
        });
        searchHistoryStore.createIndex("updatedAt", "updatedAt");
      }
    };

    request.onblocked = () => {
      reject(new Error("Database access is blocked by another open Audio Book tab."));
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAllRecords() {
  return getAllStoreRecords(STORE_NAME);
}

function putRecord(record) {
  return putStoreRecord(STORE_NAME, record);
}

function deleteRecord(id) {
  return deleteStoreRecord(STORE_NAME, id);
}

function getStoreRecord(storeName, key) {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction(storeName, "readonly");
    const store = transaction.objectStore(storeName);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

function getAllStoreRecords(storeName) {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction(storeName, "readonly");
    const store = transaction.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function putStoreRecord(storeName, record) {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    const request = store.put(record);
    request.onsuccess = () => resolve(record);
    request.onerror = () => reject(request.error);
  });
}

function deleteStoreRecord(storeName, key) {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function getSearchHistoryRecords() {
  return getAllStoreRecords(SEARCH_HISTORY_STORE_NAME);
}

async function upsertSearchHistory(term) {
  const trimmedTerm = String(term || "").trim();
  if (!trimmedTerm) {
    return;
  }

  await putStoreRecord(SEARCH_HISTORY_STORE_NAME, {
    term: trimmedTerm,
    updatedAt: Date.now(),
  });

  const records = await getSearchHistoryRecords();
  const overflow = records
    .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0))
    .slice(SEARCH_HISTORY_LIMIT);

  await Promise.all(
    overflow.map((record) => deleteStoreRecord(SEARCH_HISTORY_STORE_NAME, record.term))
  );
}

async function getSettingValue(key) {
  const record = await getStoreRecord(SETTINGS_STORE_NAME, key);
  return record?.value ?? null;
}

function setSettingValue(key, value) {
  return putStoreRecord(SETTINGS_STORE_NAME, {
    key,
    value,
    updatedAt: Date.now(),
  });
}

async function fetchArchiveSearch(query) {
  const escapedQuery = String(query).replace(/"/g, "").trim();
  const spokenQuery = querySuggestsSpokenAudio(query);
  const queryFilters = spokenQuery
    ? ARCHIVE_PUBLIC_FILTER
    : `${ARCHIVE_PUBLIC_FILTER}${ARCHIVE_NON_MUSIC_FILTER}`;
  const preciseQuery =
    `((title:"${escapedQuery}") OR (creator:"${escapedQuery}") OR ` +
    `(subject:"${escapedQuery}") OR (description:"${escapedQuery}")) AND mediatype:(audio)` +
    queryFilters;
  const broadQuery = `${escapedQuery} AND mediatype:(audio)` + queryFilters;

  const [precisePayload, broadPayload] = await Promise.all([
    fetchArchiveSearchVariant(preciseQuery),
    fetchArchiveSearchVariant(broadQuery),
  ]);

  const mergedDocs = mergeArchiveDocs([
    ...(precisePayload.response?.docs || []),
    ...(broadPayload.response?.docs || []),
  ]).filter(isArchiveResultPublic);

  const scoredDocs = mergedDocs
    .map((doc) => ({
      doc,
      score: scoreArchiveCandidate(query, {
        title: readArchiveField(doc.title),
        creator: readArchiveField(doc.creator),
        identifier: readArchiveField(doc.identifier),
        collections: readArchiveList(doc.collection),
        subject: readArchiveField(doc.subject),
        description: readArchiveField(doc.description),
      }),
    }))
    .sort((left, right) => right.score - left.score);

  const filteredDocs = !spokenQuery
    ? scoredDocs.filter((entry) => entry.score > 0)
    : scoredDocs;
  const rankedDocs = (filteredDocs.length ? filteredDocs : scoredDocs)
    .slice(0, ARCHIVE_RESULT_LIMIT)
    .map((entry) => entry.doc);

  return {
    docs: rankedDocs,
  };
}

async function fetchArchiveMetadata(identifier) {
  const response = await fetchWithTimeout(
    `${ARCHIVE_METADATA_ENDPOINT}/${encodeURIComponent(identifier)}`
  );
  if (!response.ok) {
    throw new Error(`Archive metadata failed with status ${response.status}`);
  }

  return response.json();
}

async function fetchArchiveSearchVariant(archiveQuery) {
  const params = new URLSearchParams();
  params.set("q", archiveQuery);
  params.append("fl[]", "identifier");
  params.append("fl[]", "title");
  params.append("fl[]", "creator");
  params.append("fl[]", "subject");
  params.append("fl[]", "description");
  params.append("fl[]", "collection");
  params.append("fl[]", "access-restricted-item");
  params.set("rows", String(ARCHIVE_FETCH_ROWS));
  params.set("page", "1");
  params.set("output", "json");

  const response = await fetchWithTimeout(
    `${ARCHIVE_SEARCH_ENDPOINT}?${params.toString()}`
  );
  if (!response.ok) {
    throw new Error(`Archive search failed with status ${response.status}`);
  }

  return response.json();
}

function mergeArchiveDocs(docs) {
  const seen = new Set();
  const merged = [];

  for (const doc of docs) {
    const identifier = readArchiveField(doc.identifier);
    if (!identifier || seen.has(identifier)) {
      continue;
    }

    seen.add(identifier);
    merged.push(doc);
  }

  return merged;
}

function sortArchiveResults(query) {
  state.onlineResults.sort((left, right) => {
    const scoreGap = (right.searchScore || 0) - (left.searchScore || 0);
    if (scoreGap !== 0) {
      return scoreGap;
    }

    return scoreArchiveCandidate(query, {
      title: right.title,
      creator: right.artist,
      identifier: right.identifier,
      collections: right.collections,
      subject: "",
      description: right.album,
    }) - scoreArchiveCandidate(query, {
      title: left.title,
      creator: left.artist,
      identifier: left.identifier,
      collections: left.collections,
      subject: "",
      description: left.album,
    });
  });
}

function scoreResolvedArchiveTrack(query, track, audioFile, durationSeconds) {
  const baseScore = scoreArchiveCandidate(query, {
    title: track.lyricsTitle || track.title || readArchiveField(audioFile.title),
    creator: track.lyricsArtist || track.artist || readArchiveField(audioFile.artist),
    identifier: track.identifier,
    collections: track.collections,
    subject: "",
    description: track.album,
  });

  let score = baseScore;
  const spokenQuery = querySuggestsSpokenAudio(query);

  if (!spokenQuery && durationSeconds > 0) {
    if (durationSeconds <= 480) {
      score += 60;
    } else if (durationSeconds <= 900) {
      score += 18;
    } else if (durationSeconds > 1800) {
      score -= 220;
    } else if (durationSeconds > 900) {
      score -= 80;
    }
  }

  const format = readArchiveField(audioFile.format).toLowerCase();
  if (format.includes("mp3")) {
    score += 18;
  }

  return score;
}

function scoreArchiveCandidate(query, fields) {
  const needle = normalizeSearchText(query);
  const tokens = needle.split(" ").filter(Boolean);
  const title = normalizeSearchText(fields.title);
  const creator = normalizeSearchText(fields.creator);
  const identifier = normalizeSearchText(fields.identifier);
  const collectionList = readArchiveList(fields.collections || fields.collection).map(
    normalizeSearchText
  );
  const collectionText = collectionList.join(" ");
  const subject = normalizeSearchText(fields.subject);
  const description = normalizeSearchText(fields.description);
  const haystack = [title, creator, identifier, collectionText, subject, description].join(" ");
  let score = 0;

  if (!needle) {
    return 0;
  }

  if (title.includes(needle)) {
    score += 240;
  }

  if (creator.includes(needle)) {
    score += 160;
  }

  if (identifier.includes(needle)) {
    score += 120;
  }

  if (tokens.length > 1 && tokens.every((token) => title.includes(token))) {
    score += 120;
  }

  for (const token of tokens) {
    if (title.includes(token)) {
      score += 40;
    }
    if (creator.includes(token)) {
      score += 24;
    }
    if (subject.includes(token)) {
      score += 16;
    }
    if (description.includes(token)) {
      score += 10;
    }
  }

  if (/\b(song|music|album|single|recording|record)\b/.test(subject)) {
    score += 26;
  }

  if (
    /\b(opensource audio|audio music|freemusicarchive|netlabels|etree|jamendo albums|78rpm)\b/.test(
      collectionText
    )
  ) {
    score += 70;
  }

  if (querySuggestsSpokenAudio(query)) {
    if (/\b(podcast|episode|interview|radio|story|audiobook|chapter)\b/.test(haystack)) {
      score += 60;
    }
  } else {
    if (
      /\b(podcasts mirror|podcasts miscellaneous|podcasts|audiobook|oral history|stream only|speech)\b/.test(
        collectionText
      )
    ) {
      score -= 420;
    }

    if (/\b(podcast|episode|interview|chapter|sermon|audiobook|oral history)\b/.test(haystack)) {
      score -= 240;
    }
  }

  if (/\b(mix|track|song|jazz|folk|ambient|piano|instrumental|album|volume|ep|lp)\b/.test(haystack)) {
    score += 18;
  }

  return score;
}

function querySuggestsSpokenAudio(query) {
  return /\b(radio|podcast|interview|story|audiobook|chapter|lecture|speech)\b/i.test(
    String(query)
  );
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pickArchiveAudioFile(files) {
  const candidates = files.filter((file) => {
    if (!file?.name) {
      return false;
    }

    if (archiveFlagEnabled(file.private)) {
      return false;
    }

    const format = readArchiveField(file.format).toLowerCase();
    if (
      format.includes("metadata") ||
      format.includes("sqlite") ||
      format.includes("torrent") ||
      format.includes("jpeg") ||
      format.includes("png") ||
      format.includes("xml")
    ) {
      return false;
    }

    return looksLikeAudioUrl(file.name);
  });

  candidates.sort(
    (left, right) => scoreArchiveAudioFile(right) - scoreArchiveAudioFile(left)
  );
  return candidates[0] || null;
}

function isArchiveResultPublic(doc) {
  if (!doc || archiveFlagEnabled(doc["access-restricted-item"])) {
    return false;
  }

  return !readArchiveList(doc.collection).some((collection) =>
    ARCHIVE_BLOCKED_COLLECTIONS.has(normalizeSearchText(collection))
  );
}

function isArchiveItemRestricted(metadata) {
  return archiveFlagEnabled(metadata?.["access-restricted-item"]);
}

function archiveFlagEnabled(value) {
  return /^(true|1|yes)$/i.test(readArchiveField(value));
}

function scoreArchiveAudioFile(file) {
  const format = readArchiveField(file.format).toLowerCase();
  const name = String(file.name).toLowerCase();
  let score = 0;

  if (format.includes("vbr mp3")) {
    score += 120;
  } else if (format.includes("mp3")) {
    score += 110;
  } else if (format.includes("ogg")) {
    score += 95;
  } else if (format.includes("mpeg4 audio") || name.endsWith(".m4a")) {
    score += 85;
  } else if (format.includes("flac")) {
    score += 75;
  } else if (format.includes("wav")) {
    score += 65;
  } else if (looksLikeAudioUrl(name)) {
    score += 40;
  }

  if (String(file.source).toLowerCase() === "derivative") {
    score += 8;
  }

  if (name.includes("64kb")) {
    score -= 8;
  }

  return score;
}

function pickArchiveArtworkFile(files) {
  const candidates = files.filter((file) => {
    if (!file?.name) {
      return false;
    }

    return /\.(jpg|jpeg|png|webp)$/i.test(file.name);
  });

  candidates.sort(
    (left, right) => scoreArchiveArtworkFile(right) - scoreArchiveArtworkFile(left)
  );
  return candidates[0] || null;
}

function scoreArchiveArtworkFile(file) {
  const name = String(file.name).toLowerCase();
  let score = 0;

  if (name.includes("cover")) {
    score += 30;
  }

  if (name.includes("front")) {
    score += 24;
  }

  if (name.includes("__ia_thumb")) {
    score += 20;
  }

  if (name.includes("thumb")) {
    score += 18;
  }

  return score;
}

function buildArchiveDownloadUrl(identifier, fileName) {
  return `https://archive.org/download/${encodeURIComponent(
    identifier
  )}/${encodePathSegments(fileName)}`;
}

function encodePathSegments(path) {
  return String(path)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function parseArchiveDuration(value) {
  const raw = readArchiveField(value);
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return {
      seconds: raw,
      timeText: formatTime(raw),
      badgeText: formatTime(raw),
    };
  }

  const text = String(raw || "").trim();
  if (/^\d+(\.\d+)?$/.test(text)) {
    const seconds = Number(text);
    return {
      seconds,
      timeText: formatTime(seconds),
      badgeText: formatTime(seconds),
    };
  }

  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(text)) {
    const seconds = text
      .split(":")
      .map((part) => Number(part))
      .reduce((total, part) => total * 60 + part, 0);

    return {
      seconds,
      timeText: formatTime(seconds),
      badgeText: formatTime(seconds),
    };
  }

  return {
    seconds: 0,
    timeText: "0:00",
    badgeText: "Full Track",
  };
}

function cleanArchiveFilename(value) {
  return String(value)
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim();
}

function buildArchiveTrackProfile(track, payload, audioFile) {
  const metadataTitle = cleanArchiveTrackTitle(readArchiveField(payload.metadata?.title));
  const metadataArtist = cleanArchiveArtist(readArchiveField(payload.metadata?.creator));
  const parsedAudioTitle = extractArtistTitle(readArchiveField(audioFile.title));
  const cleanedSeedTitle = cleanArchiveTrackTitle(track.title);
  const cleanedSeedArtist = cleanArchiveArtist(track.artist);
  const fileTitle = cleanArchiveTrackTitle(cleanArchiveFilename(audioFile.name));
  const audioArtist = cleanArchiveArtist(readArchiveField(audioFile.artist));

  const artist =
    metadataArtist ||
    cleanedSeedArtist ||
    (!isNoisyArchiveArtist(audioArtist) ? audioArtist : "") ||
    cleanArchiveArtist(parsedAudioTitle.artist) ||
    "Archive artist";

  const titleCandidates = [
    cleanArchiveTrackTitle(parsedAudioTitle.title),
    trimArtistFromTitle(metadataTitle, artist),
    trimArtistFromTitle(cleanedSeedTitle, artist),
    trimArtistFromTitle(fileTitle, artist),
    stripArtistFromQuery(track.searchQuery || "", artist),
  ].filter(Boolean);

  const title =
    titleCandidates[0] ||
    metadataTitle ||
    cleanedSeedTitle ||
    fileTitle ||
    "Archive recording";

  const lyricsArtist =
    cleanArchiveArtist(parsedAudioTitle.artist) ||
    metadataArtist ||
    cleanedSeedArtist ||
    (!isNoisyArchiveArtist(audioArtist) ? audioArtist : "") ||
    artist;

  const lyricsTitle =
    cleanArchiveTrackTitle(parsedAudioTitle.title) ||
    stripArtistFromQuery(track.searchQuery || "", lyricsArtist) ||
    title;

  return {
    title,
    artist,
    album: metadataTitle || track.album || "Open archive recording",
    lyricsTitle,
    lyricsArtist,
  };
}

function cleanArchiveTrackTitle(value) {
  return String(value || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_]+/g, " ")
    .replace(/\((?:lyrics?|official[^)]*|sub[^)]*|mp3|[0-9.\s]+kbps)[^)]*\)/gi, " ")
    .replace(/\[(?:lyrics?|official[^\]]*|sub[^\]]*|mp3|[0-9.\s]+kbps)[^\]]*\]/gi, " ")
    .replace(/\b(?:lyrics?|official video|official audio|mp3|kbps|download)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanArchiveArtist(value) {
  return String(value || "")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\((?:official|topic|channel|lyrics?|audio|video)[^)]*\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractArtistTitle(value) {
  const raw = String(value || "")
    .replace(/\.[^.]+$/, "")
    .replace(/_/g, " ")
    .trim();
  const separators = [" - ", " – ", " — ", ": "];

  for (const separator of separators) {
    if (!raw.includes(separator)) {
      continue;
    }

    const parts = raw.split(separator).map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2) {
      continue;
    }

    return {
      artist: cleanArchiveArtist(parts[0]),
      title: cleanArchiveTrackTitle(parts.slice(1).join(" - ")),
    };
  }

  return { artist: "", title: cleanArchiveTrackTitle(raw) };
}

function trimArtistFromTitle(title, artist) {
  const cleanedTitle = cleanArchiveTrackTitle(title);
  const cleanedArtist = cleanArchiveArtist(artist);
  if (!cleanedTitle || !cleanedArtist) {
    return cleanedTitle;
  }

  const normalizedArtist = normalizeSearchText(cleanedArtist);
  const normalizedTitle = normalizeSearchText(cleanedTitle);
  if (!normalizedTitle.startsWith(normalizedArtist)) {
    return cleanedTitle;
  }

  const pattern = new RegExp(`^${escapeRegExp(cleanedArtist)}\\s*[-:|]?\\s*`, "i");
  return cleanedTitle.replace(pattern, "").trim() || cleanedTitle;
}

function stripArtistFromQuery(query, artist) {
  const cleanedQuery = cleanArchiveTrackTitle(query);
  const cleanedArtist = cleanArchiveArtist(artist);
  if (!cleanedQuery || !cleanedArtist) {
    return "";
  }

  const tokens = normalizeSearchText(cleanedArtist).split(" ").filter(Boolean);
  if (!tokens.length) {
    return "";
  }

  let remainder = cleanedQuery;
  for (const token of tokens) {
    remainder = remainder.replace(new RegExp(`\\b${escapeRegExp(token)}\\b`, "ig"), " ");
  }

  const cleanedRemainder = remainder.replace(/\s+/g, " ").trim();
  return cleanedRemainder && cleanedRemainder.length < cleanedQuery.length
    ? cleanedRemainder
    : "";
}

function isNoisyArchiveArtist(value) {
  return /\b(lyrics?|karaoke|vevo|topic|official|channel)\b/i.test(String(value || ""));
}

function readArchiveList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").trim()).filter(Boolean);
  }

  const single = readArchiveField(value);
  return single ? [single] : [];
}

function readArchiveField(value) {
  if (Array.isArray(value)) {
    return readArchiveField(value.find(Boolean));
  }

  if (value == null) {
    return "";
  }

  return String(value).trim();
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

function validateDirectAudioUrl(value) {
  let url;

  try {
    url = new URL(String(value).trim());
  } catch (error) {
    throw new Error("Paste a valid direct audio URL first.");
  }

  const isLocalHost = LOCAL_HOST_PATTERN.test(url.hostname);
  const isSecureProtocol =
    url.protocol === "https:" || (url.protocol === "http:" && isLocalHost);

  if (!isSecureProtocol) {
    throw new Error("Use an HTTPS audio link, or localhost while testing.");
  }

  if (url.username || url.password) {
    throw new Error("Links with embedded usernames or passwords are not allowed.");
  }

  return url;
}

function createStars() {
  if (!elements.starsLayer) {
    return;
  }

  const starCount = Math.max(70, Math.floor(window.innerWidth / 18));
  const stars = [];

  for (let index = 0; index < starCount; index += 1) {
    const x = seededPercent(index * 17 + 3);
    const y = seededPercent(index * 29 + 11);
    const size = 3 + Math.round(seededPercent(index * 13 + 5, 1) * 6);
    const drift = (seededPercent(index * 19 + 7, 1) * 8 - 4).toFixed(2);

    stars.push(`
      <span
        class="star"
        data-x="${x}"
        data-y="${y}"
        style="--star-x:${x}%;--star-y:${y}%;--star-size:${size}px;--star-drift:${drift}px;--twinkle-delay:${(
        index % 9
      ) * 0.45}s;"
      ></span>
    `);
  }

  elements.starsLayer.innerHTML = stars.join("");
  state.starNodes = Array.from(elements.starsLayer.querySelectorAll(".star"));
  resetStarGlow();
}

function seededPercent(seed, scale = 100) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return Number((value - Math.floor(value)) * scale).toFixed(2);
}

function handlePointerMove(event) {
  state.pointerX = event.clientX;
  state.pointerY = event.clientY;

  if (elements.pointerAura) {
    elements.pointerAura.style.left = `${event.clientX}px`;
    elements.pointerAura.style.top = `${event.clientY}px`;
    elements.pointerAura.classList.add("is-awake");
  }

  if (state.pendingGlowFrame) {
    return;
  }

  state.pendingGlowFrame = window.requestAnimationFrame(() => {
    state.pendingGlowFrame = 0;
    updateStarGlow(state.pointerX, state.pointerY);
  });
}

function handlePointerDown(event) {
  spawnStarBurst(event.clientX, event.clientY);
}

function updateStarGlow(pointerX, pointerY) {
  for (const star of state.starNodes) {
    const x = (Number(star.dataset.x) / 100) * window.innerWidth;
    const y = (Number(star.dataset.y) / 100) * window.innerHeight;
    const distance = Math.hypot(x - pointerX, y - pointerY);
    const glow = clamp(1 - distance / 240, 0, 1);
    applyStarGlow(star, glow);
  }
}

function applyStarGlow(star, glow) {
  star.style.setProperty("--star-opacity", (0.22 + glow * 0.82).toFixed(3));
  star.style.setProperty("--star-scale", (0.9 + glow * 1.6).toFixed(3));
  star.style.setProperty("--star-shadow", `${10 + glow * 30}px`);
  star.style.setProperty("--star-blur", `${2 + glow * 12}px`);
}

function resetStarGlow() {
  if (state.pendingGlowFrame) {
    window.cancelAnimationFrame(state.pendingGlowFrame);
    state.pendingGlowFrame = 0;
  }

  if (elements.pointerAura) {
    elements.pointerAura.classList.remove("is-awake");
  }

  for (const star of state.starNodes) {
    applyStarGlow(star, 0);
  }
}

function spawnStarBurst(x, y) {
  if (!elements.starsLayer) {
    return;
  }

  const burst = document.createElement("span");
  burst.className = "star-burst";
  burst.style.left = `${x}px`;
  burst.style.top = `${y}px`;
  elements.starsLayer.append(burst);
  burst.addEventListener("animationend", () => burst.remove(), { once: true });
}

function makeInitials(value) {
  const words = String(value)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (!words.length) {
    return "AB";
  }

  return words.map((word) => word[0]).join("").toUpperCase();
}

function pickArtworkPalette(seed) {
  const palettes = [
    ["#7b95b6", "#d9ba89"],
    ["#51677e", "#d8c19b"],
    ["#97aecd", "#f0ddbf"],
    ["#38506b", "#d8b47c"],
    ["#7889a7", "#cfddeb"],
    ["#5d6f8e", "#ebcf9d"],
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
