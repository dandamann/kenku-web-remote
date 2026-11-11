const boardsEl = document.getElementById("boards");
const statusEl = document.getElementById("status");
const stopAllBtn = document.getElementById("stopAll");
const toastEl = document.getElementById("toast");

let soundsById = new Map(); // id -> full sound object
let playing = new Set(); // ids currently playing (from Kenku)
let pending = new Set(); // ids we just tapped, awaiting confirmation
let toastTimer;

function toast(msg, isError = false) {
  toastEl.textContent = msg;
  toastEl.classList.toggle("error", isError);
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3200);
}

function setOnline(ok) {
  statusEl.classList.toggle("ok", ok);
  statusEl.classList.toggle("bad", !ok);
}

async function api(pathname, init) {
  const res = await fetch(pathname, init);
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(body.message || res.statusText);
    err.body = body;
    throw err;
  }
  return body;
}

function isHttp(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

// A sound titled "Airhorn 📯" shows the emoji large and "Airhorn" as the label.
const TRAILING_EMOJI =
  /\s*((?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:\uFE0F|\u200D|\p{Emoji_Modifier}|\p{Extended_Pictographic}|\p{Regional_Indicator})*)\s*$/u;

function splitEmoji(title) {
  const m = TRAILING_EMOJI.exec(title);
  const name = m ? title.slice(0, m.index).trim() : title;
  // A title that is only an emoji stays as plain text.
  return m && name ? { name, emoji: m[1] } : { name: title, emoji: "" };
}

async function loadBoards() {
  try {
    const data = await api("/api/soundboard");
    setOnline(true);

    soundsById = new Map((data.sounds || []).map((s) => [s.id, s]));
    const boards = data.soundboards || [];

    if (boards.length === 0) {
      boardsEl.innerHTML =
        '<p class="empty">No soundboards found in Kenku FM.<br>Create a soundboard in the Kenku app, then pull to refresh.</p>';
      return;
    }

    boardsEl.innerHTML = "";
    for (const board of boards) {
      const section = document.createElement("section");

      const h = document.createElement("h2");
      h.className = "board-title";
      h.textContent = board.title || "Soundboard";
      section.appendChild(h);

      const grid = document.createElement("div");
      grid.className = "grid";

      for (const soundId of board.sounds || []) {
        const sound = soundsById.get(soundId);
        if (!sound) continue;

        const btn = document.createElement("button");
        btn.className = "sound";
        btn.type = "button";
        btn.dataset.id = sound.id;
        if (isHttp(board.background)) {
          btn.style.backgroundImage = `url("${board.background}")`;
        }
        const { name, emoji } = splitEmoji(sound.title || "Untitled");
        if (emoji) {
          const icon = document.createElement("span");
          icon.className = "emoji";
          icon.textContent = emoji;
          btn.appendChild(icon);
        }
        const label = document.createElement("span");
        label.textContent = name;
        btn.appendChild(label);
        btn.addEventListener("click", () => toggle(sound.id));
        grid.appendChild(btn);
      }

      section.appendChild(grid);
      boardsEl.appendChild(section);
    }
    applyPlayingClasses();
  } catch (err) {
    setOnline(false);
    boardsEl.innerHTML = `<p class="empty">${escapeHtml(
      err.body?.message || err.message
    )}<br><br>Check that Kenku FM is running and the remote is enabled.</p>`;
  }
}

function applyPlayingClasses() {
  for (const btn of boardsEl.querySelectorAll(".sound")) {
    const id = btn.dataset.id;
    btn.classList.toggle("playing", playing.has(id));
    btn.classList.toggle("pending", pending.has(id) && !playing.has(id));
  }
}

async function toggle(id) {
  const isPlaying = playing.has(id);
  pending.add(id);
  applyPlayingClasses();
  try {
    await api(`/api/soundboard/${isPlaying ? "stop" : "play"}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    // Optimistically reflect the new state until the next poll confirms it.
    if (isPlaying) playing.delete(id);
    else playing.add(id);
    applyPlayingClasses();
    refreshPlayback();
  } catch (err) {
    setOnline(false);
    toast(err.body?.message || err.message, true);
  } finally {
    pending.delete(id);
    applyPlayingClasses();
  }
}

async function refreshPlayback() {
  try {
    const data = await api("/api/soundboard/playback");
    setOnline(true);
    playing = new Set((data.sounds || []).map((s) => s.id));
    applyPlayingClasses();
  } catch {
    setOnline(false);
  }
}

async function stopAll() {
  const ids = [...playing];
  if (ids.length === 0) return;
  stopAllBtn.disabled = true;
  try {
    await Promise.all(
      ids.map((id) =>
        api("/api/soundboard/stop", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        })
      )
    );
    playing.clear();
    applyPlayingClasses();
    refreshPlayback();
  } catch (err) {
    toast(err.body?.message || err.message, true);
  } finally {
    stopAllBtn.disabled = false;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

stopAllBtn.addEventListener("click", stopAll);

// Poll playback for the now-playing highlight, but only while the page is
// actually on screen — no point hammering Kenku when the phone is locked.
const POLL_MS = 5000;
let pollTimer;
function startPolling() {
  if (pollTimer) return;
  refreshPlayback();
  pollTimer = setInterval(refreshPlayback, POLL_MS);
}
function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

// When the phone wakes / tab refocuses, refetch boards (a soundboard added in
// Kenku mid-session shows up without a manual reload) and resume polling.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopPolling();
  } else {
    loadBoards();
    startPolling();
  }
});

loadBoards();
startPolling();
