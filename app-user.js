// ===================================================
// app-user.js — หน้า User: ดึงข้อมูลจาก Firestore, เล่นเพลงจาก Cloudinary โดยตรง
// ===================================================
import { db } from "./firebase-init.js";
import { collection, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const STATE = {
  songs: [], categories: [], djs: [], playlists: [], settings: {},
  currentCategory: "all", currentDj: null, search: "",
  currentPlayingId: null,   // id ของเพลงที่กำลังเล่น/พักอยู่ในเครื่องเล่น
  currentLoadingId: null    // id ของเพลงที่กำลังโหลดอยู่
};
const AUDIO = new Audio();
let audioUnlocked = false;

function showToast(message, type) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.className = "toast show" + (type ? " " + type : "");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { el.className = "toast"; }, 2600);
}
function escapeHtml(str) {
  return String(str == null ? "" : str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function formatPrice(v) { return Number(v || 0).toLocaleString("en-US") + " LAK"; }
function formatTime(sec) {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return m + ":" + (s < 10 ? "0" : "") + s;
}
function buildWhatsAppLink(number, text) {
  const clean = String(number || "").replace(/[^0-9]/g, "");
  return "https://wa.me/" + clean + "?text=" + encodeURIComponent(text);
}
function debounce(fn, wait) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), wait); }; }

async function init() {
  const [songsSnap, catSnap, djSnap, playlistSnap, settingsSnap] = await Promise.all([
    getDocs(collection(db, "songs")),
    getDocs(collection(db, "categories")),
    getDocs(collection(db, "djs")),
    getDocs(collection(db, "playlists")),
    getDoc(doc(db, "settings", "main"))
  ]);
  STATE.songs = songsSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(s => s.status !== "hidden");
  STATE.categories = catSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  STATE.djs = djSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  STATE.playlists = playlistSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  STATE.settings = settingsSnap.exists() ? settingsSnap.data() : {};

  document.getElementById("siteName").textContent = STATE.settings.website_name || "Music Store";
  document.title = STATE.settings.website_name || "Music Store";
  if (STATE.settings.meta_description) {
    const metaTag = document.querySelector('meta[name="description"]');
    if (metaTag) metaTag.setAttribute("content", STATE.settings.meta_description);
  }
  if (STATE.settings.website_logo) {
    const logo = document.getElementById("siteLogo");
    logo.src = STATE.settings.website_logo;
    logo.style.display = "block";
  }
  renderCategoryChips();
  renderDjRow();
  renderPlaylists();
  renderSongGrid();
}

function renderCategoryChips() {
  const wrap = document.getElementById("categoryChips");
  let html = `<div class="chip${STATE.currentCategory === "all" ? " active" : ""}" data-cat="all">ทั้งหมด</div>`;
  STATE.categories.forEach(c => {
    html += `<div class="chip${STATE.currentCategory === c.id ? " active" : ""}" data-cat="${c.id}">${escapeHtml(c.category_name)}</div>`;
  });
  wrap.innerHTML = html;
  wrap.querySelectorAll(".chip").forEach(el => {
    el.addEventListener("click", () => {
      STATE.currentCategory = el.getAttribute("data-cat");
      STATE.currentDj = null;
      renderCategoryChips();
      renderSongGrid();
    });
  });
}

function renderDjRow() {
  const wrap = document.getElementById("djRow");
  wrap.innerHTML = STATE.djs.map(d =>
    `<div class="dj-item" data-dj="${d.id}">
      <img class="dj-avatar" src="${d.image_url || ""}">
      <div class="dj-name">${escapeHtml(d.dj_name)}</div>
    </div>`
  ).join("");
  wrap.querySelectorAll(".dj-item").forEach(el => {
    el.addEventListener("click", () => {
      STATE.currentDj = el.getAttribute("data-dj");
      STATE.currentCategory = "all";
      renderCategoryChips();
      renderSongGrid();
      document.getElementById("gridTitle").scrollIntoView({ behavior: "smooth" });
    });
  });
}

function getFilteredSongs() {
  return STATE.songs.filter(s => {
    if (STATE.currentDj) {
      const dj = STATE.djs.find(d => d.id === STATE.currentDj);
      if (!dj || s.dj_name !== dj.dj_name) return false;
    }
    if (STATE.currentCategory !== "all" && s.category_id !== STATE.currentCategory) return false;
    if (STATE.search) {
      const q = STATE.search.toLowerCase();
      const hay = [s.song_name, s.artist, s.dj_name, s.category_name].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderSongGrid() {
  const list = getFilteredSongs();
  const grid = document.getElementById("songGrid");
  const empty = document.getElementById("emptyState");
  if (list.length === 0) { grid.innerHTML = ""; empty.style.display = "block"; return; }
  empty.style.display = "none";
  grid.innerHTML = list.map(s => `
    <div class="song-card" data-id="${s.id}">
      <div class="song-cover">
        <img src="${s.cover_url || ""}">
        <button class="play-btn" data-play="${s.id}"><svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg></button>
      </div>
      <div class="song-info">
        <div class="song-name">${escapeHtml(s.song_name)}</div>
        <div class="song-artist">${escapeHtml(s.artist || "")}</div>
        ${s.dj_name ? `<div class="song-dj">DJ: ${escapeHtml(s.dj_name)}</div>` : ""}
        <div class="song-footer">
          <span class="song-price">${formatPrice(s.price)}</span>
          <span class="buy-btn">ดูเพิ่ม</span>
        </div>
      </div>
    </div>
  `).join("");

  grid.querySelectorAll("[data-play]").forEach(el => {
    el.addEventListener("click", (ev) => { ev.stopPropagation(); unlockAudio(); playSong(el.getAttribute("data-play")); });
  });
  grid.querySelectorAll(".song-card").forEach(el => {
    el.addEventListener("click", () => openSongModal(el.getAttribute("data-id")));
  });
  updatePlayButtonsUI();
}

function renderPlaylists() {
  const container = document.getElementById("playlistsContainer");
  if (STATE.playlists.length === 0) { container.innerHTML = ""; return; }

  container.innerHTML = STATE.playlists.map(pl => {
    const songs = STATE.songs.filter(s => s.playlist_id === pl.id);
    if (songs.length === 0) return "";
    return `
      <div class="playlist-block">
        <div class="section-title playlist-heading">${escapeHtml(pl.playlist_name)}</div>
        <div class="playlist-row">
          ${songs.map(s => `
            <div class="playlist-song-row" data-id="${s.id}">
              <div class="playlist-cover">
                <img src="${s.cover_url || pl.cover_url || ""}">
                <button class="playlist-play-btn" data-play="${s.id}">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg>
                </button>
              </div>
              <div class="playlist-info">
                <div class="playlist-item-name">${escapeHtml(s.song_name)}</div>
                <div class="playlist-item-sub">${escapeHtml(s.dj_name || s.artist || "")}</div>
              </div>
              <div class="playlist-item-price">${formatPrice(s.price)}</div>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }).join("");

  container.querySelectorAll("[data-play]").forEach(el => {
    el.addEventListener("click", (ev) => { ev.stopPropagation(); unlockAudio(); playSong(el.getAttribute("data-play")); });
  });
  container.querySelectorAll(".playlist-song-row").forEach(el => {
    el.addEventListener("click", () => openSongModal(el.getAttribute("data-id")));
  });
  updatePlayButtonsUI();
}

function findSong(id) { return STATE.songs.find(s => s.id === id); }

function unlockAudio() {
  if (audioUnlocked) return;
  AUDIO.play().catch(() => {});
  AUDIO.pause();
  audioUnlocked = true;
}

// ---- ไอคอน: สามเหลี่ยม (เล่น) / สี่เหลี่ยม (กำลังเล่นอยู่ กดเพื่อหยุด) ----
function playIconPath() { return '<path d="M8 5v14l11-7z"/>'; }
function stopIconPath() { return '<rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/>'; }

function setPlayerIcon(playing) {
  document.getElementById("playerIcon").innerHTML = playing ? stopIconPath() : playIconPath();
}
function setPlayerLoading(loading) {
  document.getElementById("playerIcon").style.display = loading ? "none" : "block";
  document.getElementById("playerSpinner").style.display = loading ? "block" : "none";
}

// อัปเดตไอคอนของ "ทุกปุ่มฟังเพลง" ในหน้า (การ์ดเพลง, playlist, modal, แถบเล่นเพลงด้านล่าง)
// ให้ตรงกับสถานะปัจจุบัน: กำลังโหลด = วงกลมหมุน, กำลังเล่น = สี่เหลี่ยม, หยุด/ยังไม่เล่น = สามเหลี่ยม
function updatePlayButtonsUI() {
  const playingId = (!AUDIO.paused && !STATE.currentLoadingId) ? STATE.currentPlayingId : null;
  const loadingId = STATE.currentLoadingId;

  document.querySelectorAll(".play-btn[data-play], .playlist-play-btn[data-play]").forEach(btn => {
    const id = btn.getAttribute("data-play");
    let svg = btn.querySelector("svg");
    let spinner = btn.querySelector(".mini-play-spinner");
    if (!spinner) {
      spinner = document.createElement("div");
      spinner.className = "spinner mini-play-spinner";
      // ขนาดวงกลมหมุนของปุ่มเล่นเพลง (การ์ดเพลง/playlist) — แก้ตัวเลข width/height/border-width ตรงนี้เพื่อปรับขนาด
      spinner.style.cssText = "width:20px;height:20px;border-width:2px;display:none;";
      btn.appendChild(spinner);
    }
    if (id === loadingId) {
      if (svg) svg.style.display = "none";
      spinner.style.display = "block";
    } else {
      spinner.style.display = "none";
      if (svg) {
        svg.style.display = "block";
        svg.innerHTML = id === playingId ? stopIconPath() : playIconPath();
      }
    }
  });

  const modalBtn = document.getElementById("modalPlayBtn");
  const modalIcon = document.getElementById("modalPlayIcon");
  const modalSpinner = document.getElementById("modalPlaySpinner");
  const modalLabel = document.getElementById("modalPlayLabel");
  if (modalBtn && modalIcon) {
    const modalId = modalBtn.getAttribute("data-play");
    if (modalId && modalId === loadingId) {
      modalIcon.style.display = "none";
      if (modalSpinner) modalSpinner.style.display = "block";
      if (modalLabel) modalLabel.textContent = "กำลังโหลด...";
    } else {
      if (modalSpinner) modalSpinner.style.display = "none";
      modalIcon.style.display = "block";
      const isPlaying = modalId && modalId === playingId;
      modalIcon.innerHTML = isPlaying ? stopIconPath() : playIconPath();
      if (modalLabel) modalLabel.textContent = isPlaying ? "หยุดเพลง" : "ฟังเพลง";
    }
  }

  setPlayerIcon(playingId !== null);
  setPlayerLoading(loadingId !== null);
}

function playSong(songId) {
  const song = findSong(songId);
  if (!song || !song.file_url) { showToast("ไม่พบไฟล์เพลง", "error"); return; }

  // ถ้ากดปุ่มของเพลงเดียวกับที่กำลังเล่น/พักอยู่ -> สลับ เล่น/หยุด แทนการโหลดใหม่
  if (STATE.currentPlayingId === songId && !STATE.currentLoadingId && AUDIO.src) {
    if (AUDIO.paused) {
      AUDIO.play().then(updatePlayButtonsUI).catch(() => {});
    } else {
      AUDIO.pause();
    }
    updatePlayButtonsUI();
    return;
  }

  AUDIO.pause();
  STATE.currentPlayingId = songId;
  STATE.currentLoadingId = songId;
  updatePlayButtonsUI();

  document.getElementById("playerCover").src = song.cover_url || "";
  document.getElementById("playerTitle").textContent = song.song_name;
  document.getElementById("playerSub").textContent = song.dj_name || song.artist || "";
  document.getElementById("playerBar").classList.add("show");
  document.getElementById("playerCurrentTime").textContent = "0:00";
  document.getElementById("playerDuration").textContent = "0:00";
  document.getElementById("playerSeek").value = 0;

  // Cloudinary สตรีมไฟล์โดยตรง เร็วและรองรับ seek ในตัว ไม่ต้องโหลดทั้งไฟล์ก่อนเหมือนระบบเดิม
  AUDIO.src = song.file_url;
  AUDIO.load();
  AUDIO.play().then(() => {
    STATE.currentLoadingId = null;
    updatePlayButtonsUI();
  }).catch(() => {
    showToast("แตะปุ่มเล่นที่แถบด้านล่างอีกครั้ง");
    STATE.currentLoadingId = null;
    updatePlayButtonsUI();
  });
}

document.getElementById("playerToggle").addEventListener("click", () => {
  unlockAudio();
  if (!AUDIO.src) return;
  if (AUDIO.paused) { AUDIO.play().then(updatePlayButtonsUI).catch(() => {}); } else { AUDIO.pause(); }
  updatePlayButtonsUI();
});

let isSeeking = false;
const seekEl = document.getElementById("playerSeek");
AUDIO.addEventListener("loadedmetadata", () => {
  document.getElementById("playerDuration").textContent = formatTime(AUDIO.duration);
  seekEl.max = AUDIO.duration || 0;
});
AUDIO.addEventListener("timeupdate", () => {
  if (isSeeking) return;
  document.getElementById("playerCurrentTime").textContent = formatTime(AUDIO.currentTime);
  seekEl.value = AUDIO.currentTime;
});
seekEl.addEventListener("input", () => { isSeeking = true; document.getElementById("playerCurrentTime").textContent = formatTime(Number(seekEl.value)); });
seekEl.addEventListener("change", () => { AUDIO.currentTime = Number(seekEl.value); isSeeking = false; });
AUDIO.addEventListener("ended", () => { STATE.currentPlayingId = null; updatePlayButtonsUI(); seekEl.value = 0; });
AUDIO.addEventListener("pause", updatePlayButtonsUI);
AUDIO.addEventListener("play", updatePlayButtonsUI);
AUDIO.addEventListener("waiting", () => { STATE.currentLoadingId = STATE.currentPlayingId; updatePlayButtonsUI(); });
AUDIO.addEventListener("playing", () => { STATE.currentLoadingId = null; updatePlayButtonsUI(); });

function openSongModal(songId) {
  const song = findSong(songId);
  if (!song) return;
  document.getElementById("modalCover").src = song.cover_url || "";
  document.getElementById("modalName").textContent = song.song_name;
  document.getElementById("modalArtist").textContent = song.artist || "";
  document.getElementById("modalDj").textContent = song.dj_name ? "DJ: " + song.dj_name : "";
  document.getElementById("modalDesc").textContent = song.description || "";
  document.getElementById("modalPrice").textContent = formatPrice(song.price);
  const modalBtn = document.getElementById("modalPlayBtn");
  modalBtn.setAttribute("data-play", songId);
  modalBtn.onclick = () => { unlockAudio(); playSong(songId); };
  document.getElementById("modalBuyBtn").onclick = () => {
    const text = `สวัสดีครับ\nสนใจซื้อเพลง:\nชื่อเพลง: ${song.song_name}\nDJ: ${song.dj_name || "-"}\nราคา: ${formatPrice(song.price)}`;
    window.open(buildWhatsAppLink(STATE.settings.whatsapp_number, text), "_blank");
  };
  updatePlayButtonsUI();
  document.getElementById("songModalBackdrop").classList.add("show");
}
document.getElementById("songModalClose").addEventListener("click", () => document.getElementById("songModalBackdrop").classList.remove("show"));
document.getElementById("songModalBackdrop").addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.classList.remove("show"); });

document.getElementById("searchInput").addEventListener("input", debounce((e) => { STATE.search = e.target.value.trim(); renderSongGrid(); }, 250));

document.querySelectorAll(".bottom-nav button").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".bottom-nav button").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.getAttribute("data-tab");
    if (tab === "home") { STATE.currentCategory = "all"; STATE.currentDj = null; renderCategoryChips(); renderSongGrid(); window.scrollTo({ top: 0, behavior: "smooth" }); }
    else if (tab === "category") document.getElementById("categoryChips").scrollIntoView({ behavior: "smooth" });
    else if (tab === "dj") document.getElementById("djSection").scrollIntoView({ behavior: "smooth" });
    else if (tab === "contact") window.open(buildWhatsAppLink(STATE.settings.whatsapp_number, "สวัสดีครับ/ค่ะ ต้องการสอบถามเกี่ยวกับร้านเพลง"), "_blank");
  });
});

init().catch(err => showToast("โหลดข้อมูลไม่สำเร็จ: " + err.message, "error"));





