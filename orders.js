// orders.js — ระบบจัดการออเดอร์ (เชื่อมกับ Firestore จริงของเว็บ Music Store)
// ใช้ collection "songs" ที่มีอยู่แล้วเป็นแหล่งข้อมูลเพลง/ราคา
// และสร้าง collection ใหม่ชื่อ "orders" สำหรับเก็บออเดอร์
// ===================================================
import { db } from "./firebase-init.js";
import {
  collection, getDocs, getDoc, setDoc, query, orderBy, where, doc, updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ---------------- สถานะออเดอร์ (4 สถานะ) ---------------- */
const STATUS_ORDER = ["pending_verify", "processing", "completed", "cancelled"];
const STATUS_CONFIG = {
  pending_verify: { emoji: "🟡", label: "รอตรวจสอบการโอน", color: "#F5B400", bg: "rgba(245,180,0,.15)" },
  processing:     { emoji: "🔵", label: "ชำระเงินแล้ว - กำลังส่งเพลง", color: "#3B9EFF", bg: "rgba(59,158,255,.15)" },
  completed:      { emoji: "🟢", label: "สำเร็จ", color: "var(--success)", bg: "rgba(41,204,113,.15)" },
  cancelled:      { emoji: "🔴", label: "ยกเลิก", color: "var(--danger)", bg: "rgba(255,107,107,.15)" },
};

function escapeHtml(str) {
  return String(str == null ? "" : str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
// Safari (และเบราว์เซอร์มือถือส่วนใหญ่) เมิน HTML `download` attribute สำหรับลิงก์ข้ามโดเมน
// เลยเปิดไฟล์เสียง/วิดีโอด้วยเครื่องเล่นในตัวแทนที่จะดาวน์โหลดให้ — ต้องสั่ง Cloudinary ให้ส่งไฟล์
// แบบ Content-Disposition: attachment โดยแทรก fl_attachment เข้าไปใน URL แทน
function toCloudinaryDownloadUrl(url) {
  if (!url || typeof url !== "string") return url;
  const marker = "/upload/";
  const idx = url.indexOf(marker);
  if (idx === -1) return url; // ไม่ใช่ URL รูปแบบ Cloudinary มาตรฐาน ปล่อยผ่านไม่แตะต้อง
  if (url.includes("/fl_attachment")) return url; // ใส่ไปแล้ว ไม่ใส่ซ้ำ
  return url.slice(0, idx + marker.length) + "fl_attachment/" + url.slice(idx + marker.length);
}
function formatLAK(v) { return Number(v || 0).toLocaleString("en-US") + " LAK"; }
function debounce(fn, wait) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), wait); }; }
// ชื่อฟิลด์จริงใน Firestore คือ playlist_name แต่รองรับข้อมูลเก่าที่อาจใช้ name ด้วย
function getPlaylistName(playlist) {
  return String(playlist?.playlist_name ?? playlist?.name ?? "");
}

function getReceiptNumber(orderId, createdAt) {
  const date = new Date(createdAt || Date.now());
  const ymd = Number.isNaN(date.getTime())
    ? "00000000"
    : [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0"),
      ].join("");
  return `RCPT-${ymd}-${String(orderId || "000000").slice(-6).toUpperCase()}`;
}

const state = {
  songs: [],        // เพลงทั้งหมด (status: active) จาก collection "songs"
  playlists: [],     // เพลย์ลิสต์ที่ตั้งราคาเหมาไว้แล้ว จาก collection "playlists"
  searchResults: [],
  cartItems: [],     // เพลงที่เลือกไว้ในออเดอร์ที่กำลังกรอก
  allOrders: [],      // แคชออเดอร์ล่าสุดที่โหลดมา (ใช้กรองสถานะโดยไม่ต้องโหลดซ้ำ)
  historyFilter: "all", // สถานะที่กำลังกรองดูในประวัติออเดอร์
  listenersBound: false, // กันการผูก event ซ้ำเมื่อเปิดหน้านี้หลายครั้ง

  // ---- ประเภทออเดอร์ที่กำลังกรอก: "single" (เพลงเดี่ยว) หรือ "playlist" (ยกเพลย์ลิสต์) ----
  orderType: "single",
  playlistSearchResults: [],
  selectedPlaylist: null, // { id, playlist_name, price, ... } เพลย์ลิสต์ที่เลือกในฟอร์มสร้างออเดอร์ใหม่

  // ---- สถานะสำหรับโหมดแก้ไขออเดอร์ (modal) ----
  editingOrderId: null,   // id ของออเดอร์ที่กำลังแก้ไขอยู่ (null = ไม่ได้เปิด modal)
  editCartItems: [],      // เพลงในตะกร้าของ modal แก้ไข
  editSearchResults: [],  // ผลค้นหาเพลงใน modal แก้ไข
  editOrderType: "single",
  editPlaylistSearchResults: [],
  editSelectedPlaylist: null, // เพลย์ลิสต์ที่เลือกใน modal แก้ไข

  // ---- ธงบอกว่า "ยอดรวม" ถูกผู้ใช้แก้ไขเองหรือไม่ ----
  // true = ใช้ค่าที่ผู้ใช้พิมพ์เอง, false = คำนวณอัตโนมัติจากราคาเพลงในตะกร้า (หรือราคาเหมาเพลย์ลิสต์)
  cartTotalEdited: false,     // สำหรับฟอร์มสร้างออเดอร์ใหม่
  editCartTotalEdited: false, // สำหรับ modal แก้ไขออเดอร์
  storeName: "Music Store",
};

/* ---------------- โหลดเพลงจริงจาก Firestore ---------------- */
async function loadSongsFromDatabase() {
  const q = query(collection(db, "songs"), where("status", "==", "active"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ---------------- โหลดออเดอร์ทั้งหมดจาก Firestore ---------------- */
async function loadOrdersFromDatabase() {
  const q = query(collection(db, "orders"), orderBy("created_at", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ---------------- โหลดเพลย์ลิสต์จริงจาก Firestore (สำหรับขายยกเพลย์ลิสต์) ----------------
   หมายเหตุ: เอาไว้เฉพาะเพลย์ลิสต์ที่ตั้ง "ราคาเหมา" ไว้แล้ว (price > 0) เพราะถือว่าเป็นชุดที่ขายทั้งชุดได้
   เพลย์ลิสต์ที่ไม่ได้ตั้งราคา (ปล่อยว่าง/0) จะไม่โผล่ในช่องค้นหานี้ */
async function loadPlaylistsFromDatabase() {
  const snap = await getDocs(collection(db, "playlists"));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(p => Number(p.price || 0) > 0);
}

async function loadStoreName() {
  try {
    const snap = await getDoc(doc(db, "settings", "main"));
    return snap.exists() ? String(snap.data().website_name || "Music Store") : "Music Store";
  } catch (err) {
    console.warn("โหลดชื่อร้านไม่สำเร็จ ใช้ชื่อเริ่มต้นแทน:", err);
    return "Music Store";
  }
}

/* ---------------- หาเพลงทั้งหมดที่อยู่ในเพลย์ลิสต์ที่เลือก ----------------
   อ้างอิงจากฟิลด์ playlist_id บนเอกสารเพลงแต่ละเพลง (บันทึกไว้ตอนเพิ่ม/แก้ไขเพลงในหน้า "จัดการเพลง")
   ถ้าฐานข้อมูลจริงเก็บฟิลด์นี้ชื่ออื่น ให้แก้ตรง s.playlist_id ด้านล่างนี้จุดเดียว */
function getSongsInPlaylist(playlistId) {
  return state.songs.filter((s) => s.playlist_id === playlistId);
}

/* ---------------- คำนวณ ---------------- */
function calculateCartTotal(items) {
  return items.reduce((sum, item) => sum + Number(item.price || 0), 0);
}
function calculateOrderTotal(orderType, items, playlist) {
  return orderType === "playlist" && playlist
    ? Number(playlist.price || 0)
    : calculateCartTotal(items);
}

// รองรับหน้า admin.html รุ่นเก่าที่ยังไม่มี modal ใบเสร็จ
function ensureReceiptElements() {
  if (document.getElementById("receiptBackdrop")) return;

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.id = "receiptBackdrop";
  backdrop.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>ใบเสร็จดิจิทัล</h3>
        <button class="modal-close" id="receiptClose">✕</button>
      </div>
      <div id="receiptContent"></div>
      <button class="btn" id="receiptPrintBtn" style="margin-top:14px;">พิมพ์ / บันทึกเป็น PDF</button>
    </div>
  `;
  document.body.appendChild(backdrop);
}
// รองรับหน้า admin.html รุ่นเก่าที่ยังไม่มี modal ไฟล์เพลงเต็ม
function ensureFullFilesElements() {
  if (document.getElementById("fullFilesBackdrop")) return;

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.id = "fullFilesBackdrop";
  backdrop.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>ไฟล์เพลงเต็มสำหรับส่งลูกค้า</h3>
        <button class="modal-close" id="fullFilesClose">✕</button>
      </div>
      <p style="color:var(--text-dim);font-size:13px;margin-top:0;">ดาวน์โหลดแล้วส่งให้ลูกค้าทาง WhatsApp ด้วยตัวเอง — ลิงก์นี้สำหรับ Admin เท่านั้น ห้ามส่งลิงก์นี้ตรงให้ลูกค้า</p>
      <div id="fullFilesContent"></div>
    </div>
  `;
  document.body.appendChild(backdrop);
}
function calculateStats(orders) {
  // totalOrders = ออเดอร์ทั้งหมดทุกสถานะ (ปริมาณงานรวม)
  // totalSongsSold / totalRevenue = นับเฉพาะออเดอร์ที่ "สำเร็จ" แล้วเท่านั้น
  // เพื่อไม่ให้ออเดอร์ที่ยังรอตรวจสอบหรือถูกยกเลิกไปปนกับยอดขายจริง
  const totalOrders = orders.length;
  const completed = orders.filter((o) => o.status === "completed");
  const totalSongsSold = completed.reduce((sum, o) => sum + (o.items ? o.items.length : 0), 0);
  const totalRevenue = completed.reduce((sum, o) => sum + Number(o.total || 0), 0);
  // แยกนับว่าออเดอร์ที่สำเร็จแล้วเป็นแบบ "เพลงเดี่ยว" หรือ "ยกเพลย์ลิสต์" กี่ออเดอร์
  // ออเดอร์เก่าที่ไม่มีฟิลด์ order_type (สร้างก่อนอัปเดตนี้) ให้นับเป็นเพลงเดี่ยวไว้ก่อน
  const singleCount = completed.filter((o) => (o.order_type || "single") === "single").length;
  const playlistCount = completed.filter((o) => o.order_type === "playlist").length;
  return { totalOrders, totalSongsSold, totalRevenue, singleCount, playlistCount };
}

/* ---------------- Render: ผลค้นหาเพลง (ฟอร์มสร้างออเดอร์ใหม่) ---------------- */
function renderSearchResults() {
  const container = document.getElementById("ordSearchResults");
  container.innerHTML = "";

  if (state.searchResults.length === 0) return;

  state.searchResults.forEach((song) => {
    const alreadyAdded = state.cartItems.some((i) => i.songId === song.id);
    const row = document.createElement("div");
    row.className = "list-row";
    row.innerHTML = `
      <img src="${song.cover_url || ""}">
      <div class="info">
        <div class="n1">${escapeHtml(song.song_name)}</div>
        <div class="n2">${escapeHtml(song.dj_name || song.artist || "-")} · ${formatLAK(song.price)}</div>
      </div>
      <div class="row-actions">
        <button class="icon-btn" data-add="${song.id}" ${alreadyAdded ? "disabled" : ""} style="${alreadyAdded ? "opacity:.4;" : "background:var(--accent);color:#fff;"}">
          ${alreadyAdded ? "✓" : "＋"}
        </button>
      </div>
    `;
    container.appendChild(row);
  });

  container.querySelectorAll("[data-add]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      addToCart(btn.getAttribute("data-add"));
    });
  });
}

/* ---------------- Render: ตะกร้าออเดอร์ปัจจุบัน (ฟอร์มสร้างออเดอร์ใหม่) ---------------- */
function renderCart() {
  const container = document.getElementById("ordCartItems");
  const totalEl = document.getElementById("ordCartTotal");
  const hintEl = document.getElementById("ordTotalHint");
  container.innerHTML = "";

  if (state.orderType === "playlist" && state.selectedPlaylist) {
    const badge = document.createElement("div");
    badge.style.cssText = "font-size:12px;font-weight:700;color:var(--accent);margin-bottom:6px;";
    badge.textContent = `🎶 ยกเพลย์ลิสต์: ${getPlaylistName(state.selectedPlaylist)} (${state.cartItems.length} เพลง)`;
    container.appendChild(badge);
  }

  if (state.cartItems.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.style.padding = "10px 0";
    empty.textContent = state.orderType === "playlist" ? "ยังไม่ได้เลือกเพลย์ลิสต์" : "ยังไม่ได้เลือกเพลง";
    container.appendChild(empty);
  } else {
    state.cartItems.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "list-row";
      // โหมดยกเพลย์ลิสต์: เพลงถูกดึงมาอัตโนมัติทั้งชุด ไม่ให้ลบทีละเพลง (ลบได้แค่ยกเลิกทั้งเพลย์ลิสต์)
      const removeBtn = state.orderType === "playlist"
        ? ""
        : `<div class="row-actions"><button class="icon-btn danger" data-remove="${index}">🗑</button></div>`;
      row.innerHTML = `
        <div class="info"><div class="n1">${escapeHtml(item.title)}</div><div class="n2">${formatLAK(item.price)}</div></div>
        ${removeBtn}
      `;
      container.appendChild(row);
    });
    container.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => removeFromCart(Number(btn.getAttribute("data-remove"))));
    });
  }

  // ยอดเพลงเดี่ยว = ผลรวมราคาเพลง / ยกเพลย์ลิสต์ = ราคาเหมาของเพลย์ลิสต์
  const computedTotal = calculateOrderTotal(
    state.orderType,
    state.cartItems,
    state.selectedPlaylist
  );
  totalEl.value = computedTotal;
  if (hintEl) {
    hintEl.textContent = `คำนวณอัตโนมัติ: ${
      state.orderType === "playlist" ? "ราคาเหมาเพลย์ลิสต์" : "รวมราคาเพลงที่เลือก"
    }`;
  }
}

/* ---------------- Render: ผลค้นหาเพลย์ลิสต์ (ฟอร์มสร้างออเดอร์ใหม่) ---------------- */
function renderPlaylistSearchResults() {
  const container = document.getElementById("ordPlaylistResults");
  if (!container) return;
  container.innerHTML = "";
  if (state.selectedPlaylist) return; // เลือกแล้ว ไม่ต้องโชว์ผลค้นหาซ้ำ
  if (state.playlistSearchResults.length === 0) return;

  state.playlistSearchResults.forEach((pl) => {
    const songCount = getSongsInPlaylist(pl.id).length;
    const card = document.createElement("div");
    card.className = "playlist-result-card";
    card.innerHTML = `
      <img src="${pl.cover_url || ""}">
      <div class="info" style="flex:1;">
        <div class="n1">${escapeHtml(getPlaylistName(pl))}</div>
        <div class="n2">${songCount} เพลง · ราคาเหมา ${formatLAK(pl.price)}</div>
      </div>
    `;
    card.addEventListener("click", () => selectPlaylist(pl.id));
    container.appendChild(card);
  });
}

/* ---------------- Render: การ์ดเพลย์ลิสต์ที่เลือกไว้ (ฟอร์มสร้างออเดอร์ใหม่) ---------------- */
function renderPlaylistSelected() {
  const container = document.getElementById("ordPlaylistSelected");
  if (!container) return;
  container.innerHTML = "";
  if (!state.selectedPlaylist) return;

  const pl = state.selectedPlaylist;
  const card = document.createElement("div");
  card.className = "playlist-selected-card";
  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div style="font-weight:800;">🎶 ${escapeHtml(getPlaylistName(pl))}</div>
      <button class="icon-btn" id="ordPlaylistClearBtn">✕</button>
    </div>
    <div style="font-size:12px;color:var(--text-dim);">${state.cartItems.length} เพลง · ราคาเหมา ${formatLAK(pl.price)}</div>
  `;
  container.appendChild(card);
  document.getElementById("ordPlaylistClearBtn").addEventListener("click", clearSelectedPlaylist);
}

/* ---------------- เลือกเพลย์ลิสต์: ดึงเพลงทั้งชุด + ราคาเหมา มาลงออเดอร์เดียวจบ ---------------- */
function selectPlaylist(playlistId) {
  const pl = state.playlists.find((p) => p.id === playlistId);
  if (!pl) return;

  const songs = getSongsInPlaylist(pl.id);
  state.selectedPlaylist = pl;
  state.cartItems = songs.map((s) => ({ songId: s.id, title: s.song_name, price: Number(s.price || 0) }));
  state.cartTotalEdited = false; // กลับไปใช้ราคาเหมาของเพลย์ลิสต์เป็นค่าตั้งต้นเสมอ
  document.getElementById("ordPlaylistSearch").value = "";
  state.playlistSearchResults = [];

  renderPlaylistSelected();
  renderPlaylistSearchResults();
  renderCart();
}

function clearSelectedPlaylist() {
  state.selectedPlaylist = null;
  state.cartItems = [];
  state.cartTotalEdited = false;
  renderPlaylistSelected();
  renderPlaylistSearchResults();
  renderCart();
}

function handlePlaylistSearchInput(e) {
  const q = e.target.value.trim().toLowerCase();
  state.playlistSearchResults = !q ? [] : state.playlists.filter((p) => getPlaylistName(p).toLowerCase().includes(q));
  renderPlaylistSearchResults();
}

/* ---------------- สลับประเภทออเดอร์: เพลงเดี่ยว ↔ ยกเพลย์ลิสต์ (ฟอร์มสร้างออเดอร์ใหม่) ---------------- */
function switchOrderType(type) {
  if (state.orderType === type) return;
  state.orderType = type;

  document.querySelectorAll('#ordTypeToggle [data-order-type]').forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-order-type") === type);
  });
  document.getElementById("ordSingleSection").style.display = type === "single" ? "" : "none";
  document.getElementById("ordPlaylistSection").style.display = type === "playlist" ? "" : "none";

  // ล้างสิ่งที่เลือกไว้จากโหมดก่อนหน้า กันข้อมูลเพลงเดี่ยว/เพลย์ลิสต์ปนกัน
  state.cartItems = [];
  state.cartTotalEdited = false;
  state.selectedPlaylist = null;
  state.searchResults = [];
  state.playlistSearchResults = [];
  document.getElementById("ordSongSearch").value = "";
  document.getElementById("ordPlaylistSearch").value = "";

  renderSearchResults();
  renderPlaylistSelected();
  renderPlaylistSearchResults();
  renderCart();
}

/* ---------------- Render: Dashboard สถิติออเดอร์ ---------------- */
function renderStats(orders) {
  const stats = calculateStats(orders);
  document.getElementById("ordStatCount").textContent = stats.totalOrders.toLocaleString("en-US");
  document.getElementById("ordStatSongs").textContent = stats.totalSongsSold.toLocaleString("en-US");
  document.getElementById("ordStatRevenue").textContent = formatLAK(stats.totalRevenue);
  document.getElementById("ordStatSingleCount").textContent = stats.singleCount.toLocaleString("en-US");
  document.getElementById("ordStatPlaylistCount").textContent = stats.playlistCount.toLocaleString("en-US");
}

/* ---------------- Render: แถบกรองสถานะ ---------------- */
function renderFilterPills() {
  const wrap = document.getElementById("ordStatusFilter");
  if (!wrap) return;
  const filters = [{ key: "all", label: "ทั้งหมด" }].concat(
    STATUS_ORDER.map((k) => ({ key: k, label: `${STATUS_CONFIG[k].emoji} ${STATUS_CONFIG[k].label}` }))
  );
  wrap.innerHTML = filters.map((f) =>
    `<button data-filter="${f.key}" class="${state.historyFilter === f.key ? "active" : ""}">${f.label}</button>`
  ).join("");
  wrap.querySelectorAll("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.historyFilter = btn.getAttribute("data-filter");
      renderFilterPills();
      renderHistory();
    });
  });
}

/* ---------------- Render: ประวัติออเดอร์ ---------------- */
function renderHistory() {
  const wrap = document.getElementById("ordHistoryList");
  const orders = state.historyFilter === "all"
    ? state.allOrders
    : state.allOrders.filter((o) => o.status === state.historyFilter);

  if (orders.length === 0) {
    wrap.innerHTML = `<div class="empty-state">ไม่พบออเดอร์ในสถานะนี้</div>`;
    return;
  }
  wrap.innerHTML = orders.map((o) => {
    const date = o.created_at ? new Date(o.created_at) : null;
    const dateStr = date ? date.toLocaleDateString("th-TH") + " " + date.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : "-";
    const songNames = (o.items || []).map(i => escapeHtml(i.title)).join(", ");
    const cfg = STATUS_CONFIG[o.status] || STATUS_CONFIG.pending_verify;
    const options = STATUS_ORDER.map((k) =>
      `<option value="${k}" ${o.status === k ? "selected" : ""}>${STATUS_CONFIG[k].emoji} ${STATUS_CONFIG[k].label}</option>`
    ).join("");
    const isPlaylistOrder = o.order_type === "playlist";
    const typeBadge = isPlaylistOrder
      ? `<span class="order-type-badge" style="background:rgba(122,92,255,.15);color:var(--accent);">🎶 ยกเพลย์ลิสต์${o.playlist_name ? " · " + escapeHtml(o.playlist_name) : ""}</span>`
      : `<span class="order-type-badge" style="background:rgba(255,255,255,.08);color:var(--text-dim);">🎵 เพลงเดี่ยว</span>`;
    return `
      <div class="list-row" style="flex-direction:column;align-items:stretch;gap:8px;">
        <div class="info">
          ${typeBadge}
          <div class="n1">${escapeHtml(o.customer_name)} · ${formatLAK(o.total)}</div>
          <div class="n2">${dateStr} · ${escapeHtml(o.whatsapp)}</div>
          <div class="n2">${songNames}</div>
        </div>
        <span class="status-badge" style="background:${cfg.bg};color:${cfg.color};">${cfg.emoji} ${cfg.label}</span>
        <select class="status-select" data-order-id="${o.id}">${options}</select>
        <div class="row-actions" style="justify-content:flex-end;">
          <button class="icon-btn" data-receipt-order="${o.id}" title="ดูใบเสร็จ">🧾</button>
          ${(o.status === "processing" || o.status === "completed") ? `<button class="icon-btn" data-fullfiles-order="${o.id}" title="ไฟล์เต็มสำหรับส่งลูกค้า">📥</button>` : ""}
          <button class="icon-btn" data-edit-order="${o.id}" title="แก้ไขออเดอร์">✏️</button>
          <button class="icon-btn danger" data-delete-order="${o.id}" title="ลบออเดอร์">🗑</button>
        </div>
      </div>
    `;
  }).join("");

  wrap.querySelectorAll("[data-order-id]").forEach((sel) => {
    sel.addEventListener("change", () => handleStatusChange(sel.getAttribute("data-order-id"), sel.value));
  });
  wrap.querySelectorAll("[data-receipt-order]").forEach((btn) => {
    btn.addEventListener("click", () => openReceipt(btn.getAttribute("data-receipt-order")));
  });
  wrap.querySelectorAll("[data-fullfiles-order]").forEach((btn) => {
    btn.addEventListener("click", () => openFullFilesModal(btn.getAttribute("data-fullfiles-order")));
  });
  wrap.querySelectorAll("[data-edit-order]").forEach((btn) => {
    btn.addEventListener("click", () => openEditOrderModal(btn.getAttribute("data-edit-order")));
  });
  wrap.querySelectorAll("[data-delete-order]").forEach((btn) => {
    btn.addEventListener("click", () => handleDeleteOrder(btn.getAttribute("data-delete-order")));
  });
}

/* ---------------- ใบเสร็จดิจิทัล ---------------- */
function openReceipt(orderId) {
  const order = state.allOrders.find((o) => o.id === orderId);
  if (!order) return;
  ensureReceiptElements();

  const playlist = order.playlist_id
    ? state.playlists.find((p) => p.id === order.playlist_id)
    : null;
  const playlistName = order.playlist_name || getPlaylistName(playlist) || "เพลย์ลิสต์";
  const total = Number.isFinite(Number(order.total))
    ? Number(order.total)
    : calculateOrderTotal(order.order_type, order.items || [], playlist);
  const date = order.created_at ? new Date(order.created_at) : new Date();
  const dateText = Number.isNaN(date.getTime())
    ? "-"
    : date.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
  const receiptNumber = order.receipt_number || getReceiptNumber(order.id, order.created_at);

  const itemRows = order.order_type === "playlist"
    ? `
      <div class="receipt-line">
        <div><strong>🎶 ${escapeHtml(playlistName)}</strong><small>ยกเพลย์ลิสต์ · ${(order.items || []).length} เพลง</small></div>
        <strong>${formatLAK(total)}</strong>
      </div>
    `
    : (order.items || []).map((item) => `
      <div class="receipt-line">
        <div><strong>${escapeHtml(item.title || "เพลง")}</strong></div>
        <strong>${formatLAK(item.price)}</strong>
      </div>
    `).join("");

  const content = document.getElementById("receiptContent");
  if (!content) return;
  content.innerHTML = `
    <div class="receipt-paper">
      <div class="receipt-head">
        <h2>${escapeHtml(order.store_name || state.storeName)}</h2>
        <div>ใบเสร็จรับเงิน</div>
        <small>เลขที่ ${escapeHtml(receiptNumber)}</small>
        <small>${escapeHtml(dateText)}</small>
      </div>
      <div class="receipt-customer">
        <div><span>ลูกค้า</span><strong>${escapeHtml(order.customer_name)}</strong></div>
        <div><span>WhatsApp</span><strong>${escapeHtml(order.whatsapp)}</strong></div>
      </div>
      <div class="receipt-items">
        ${itemRows || '<div class="receipt-empty">ไม่มีรายการสินค้า</div>'}
      </div>
      <div class="receipt-total"><span>รวมทั้งสิ้น</span><strong>${formatLAK(total)}</strong></div>
      <div class="receipt-thanks">ขอบคุณที่ใช้บริการ</div>
    </div>
  `;

  const backdrop = document.getElementById("receiptBackdrop");
  backdrop.classList.add("open");
  backdrop.style.display = "flex";
}

function closeReceipt() {
  const backdrop = document.getElementById("receiptBackdrop");
  backdrop.classList.remove("open");
  backdrop.style.display = "none";
}

/* ---------------- ไฟล์เพลงเต็ม WAV สำหรับ Admin ส่งลูกค้า (หลังชำระเงินแล้วเท่านั้น) ---------------- */
async function openFullFilesModal(orderId) {
  const order = state.allOrders.find((o) => o.id === orderId);
  const content = document.getElementById("fullFilesContent");
  const backdrop = document.getElementById("fullFilesBackdrop");
  if (!order || !content || !backdrop) return;

  if (order.status !== "processing" && order.status !== "completed") {
    alert("ออเดอร์นี้ยังไม่ได้ยืนยันการชำระเงิน");
    return;
  }

  content.innerHTML = `<div class="empty-state">กำลังโหลดไฟล์...</div>`;
  backdrop.classList.add("open");
  backdrop.style.display = "flex";

  // ดึงข้อมูลเพลงล่าสุดจาก Firestore ตรงๆ (ไม่ใช้ cache) เพราะเพลงอาจถูกปิดการขาย/แก้ไขไปแล้วหลังสั่งซื้อ
  const items = order.items || [];
  const rows = await Promise.all(items.map(async (item) => {
    try {
      const snap = await getDoc(doc(db, "songs", item.song_id));
      const song = snap.exists() ? snap.data() : null;
      if (!song || !song.full_file_url) {
        return `<div class="receipt-line"><div><strong>${escapeHtml(item.title || "เพลง")}</strong><small>ยังไม่ได้อัปโหลดไฟล์เต็ม WAV</small></div></div>`;
      }
      return `
        <div class="receipt-line">
          <div><strong>${escapeHtml(item.title || song.song_name || "เพลง")}</strong><small>${escapeHtml(song.full_file_name || "full.wav")}</small></div>
          <a class="btn secondary" style="padding:8px 14px;font-size:13px;" href="${toCloudinaryDownloadUrl(song.full_file_url)}" target="_blank" rel="noopener">ดาวน์โหลด</a>
        </div>`;
    } catch (err) {
      return `<div class="receipt-line"><div><strong>${escapeHtml(item.title || "เพลง")}</strong><small>โหลดข้อมูลไม่สำเร็จ</small></div></div>`;
    }
  }));

  content.innerHTML = rows.join("") || `<div class="empty-state">ไม่มีรายการเพลงในออเดอร์นี้</div>`;
}

function closeFullFilesModal() {
  const backdrop = document.getElementById("fullFilesBackdrop");
  backdrop.classList.remove("open");
  backdrop.style.display = "none";
}

/* ---------------- เปลี่ยนสถานะออเดอร์ ---------------- */
async function handleStatusChange(orderId, newStatus) {
  try {
    await updateDoc(doc(db, "orders", orderId), { status: newStatus, updated_at: new Date().toISOString() });
    await refreshDashboardAndHistory();
  } catch (err) {
    alert("เปลี่ยนสถานะไม่สำเร็จ: " + err.message);
  }
}

/* =====================================================================
   ยืนยันก่อนลบ — ใช้ modal ที่มีอยู่แล้วในหน้า (confirmBackdrop) ทั้งเว็บ
   คืนค่าเป็น Promise<boolean> ว่าผู้ใช้กด "ลบ" หรือ "ยกเลิก"
   ===================================================================== */
function askConfirm(message) {
  return new Promise((resolve) => {
    const backdrop = document.getElementById("confirmBackdrop");
    const textEl = document.getElementById("confirmText");
    const okBtn = document.getElementById("confirmOk");
    const cancelBtn = document.getElementById("confirmCancel");

    textEl.textContent = message;
    backdrop.classList.add("open");
    backdrop.style.display = "flex";

    function cleanup(result) {
      backdrop.classList.remove("open");
      backdrop.style.display = "none";
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }

    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
  });
}

/* ---------------- ลบออเดอร์ ---------------- */
async function handleDeleteOrder(orderId) {
  const order = state.allOrders.find((o) => o.id === orderId);
  const label = order ? `ออเดอร์ของ ${order.customer_name} (${formatLAK(order.total)})` : "ออเดอร์นี้";
  const ok = await askConfirm(`ต้องการลบ${label}ใช่หรือไม่? การลบไม่สามารถย้อนกลับได้`);
  if (!ok) return;

  try {
    await deleteDoc(doc(db, "orders", orderId));
    await refreshDashboardAndHistory();
  } catch (err) {
    alert("ลบออเดอร์ไม่สำเร็จ: " + err.message);
  }
}

/* =====================================================================
   แก้ไขออเดอร์ (modal)
   ===================================================================== */
function renderEditSearchResults() {
  const container = document.getElementById("eOrderSearchResults");
  if (!container) return;
  container.innerHTML = "";
  if (state.editSearchResults.length === 0) return;

  state.editSearchResults.forEach((song) => {
    const alreadyAdded = state.editCartItems.some((i) => i.songId === song.id);
    const row = document.createElement("div");
    row.className = "list-row";
    row.innerHTML = `
      <img src="${song.cover_url || ""}">
      <div class="info">
        <div class="n1">${escapeHtml(song.song_name)}</div>
        <div class="n2">${escapeHtml(song.dj_name || song.artist || "-")} · ${formatLAK(song.price)}</div>
      </div>
      <div class="row-actions">
        <button class="icon-btn" data-eadd="${song.id}" ${alreadyAdded ? "disabled" : ""} style="${alreadyAdded ? "opacity:.4;" : "background:var(--accent);color:#fff;"}">
          ${alreadyAdded ? "✓" : "＋"}
        </button>
      </div>
    `;
    container.appendChild(row);
  });

  container.querySelectorAll("[data-eadd]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      addToEditCart(btn.getAttribute("data-eadd"));
    });
  });
}

function renderEditCart() {
  const container = document.getElementById("eOrderCartItems");
  const totalEl = document.getElementById("eOrderCartTotal");
  const hintEl = document.getElementById("eOrderTotalHint");
  if (!container || !totalEl) return;
  container.innerHTML = "";

  if (state.editOrderType === "playlist" && state.editSelectedPlaylist) {
    const badge = document.createElement("div");
    badge.style.cssText = "font-size:12px;font-weight:700;color:var(--accent);margin-bottom:6px;";
    badge.textContent = `🎶 ยกเพลย์ลิสต์: ${getPlaylistName(state.editSelectedPlaylist)} (${state.editCartItems.length} เพลง)`;
    container.appendChild(badge);
  }

  if (state.editCartItems.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.style.padding = "10px 0";
    empty.textContent = state.editOrderType === "playlist" ? "ยังไม่ได้เลือกเพลย์ลิสต์" : "ยังไม่ได้เลือกเพลง";
    container.appendChild(empty);
  } else {
    state.editCartItems.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "list-row";
      const removeBtn = state.editOrderType === "playlist"
        ? ""
        : `<div class="row-actions"><button class="icon-btn danger" data-eremove="${index}">🗑</button></div>`;
      row.innerHTML = `
        <div class="info"><div class="n1">${escapeHtml(item.title)}</div><div class="n2">${formatLAK(item.price)}</div></div>
        ${removeBtn}
      `;
      container.appendChild(row);
    });
    container.querySelectorAll("[data-eremove]").forEach((btn) => {
      btn.addEventListener("click", () => removeFromEditCart(Number(btn.getAttribute("data-eremove"))));
    });
  }

  const computedTotal = calculateOrderTotal(
    state.editOrderType,
    state.editCartItems,
    state.editSelectedPlaylist
  );
  totalEl.value = computedTotal;
  if (hintEl) {
    hintEl.textContent = `คำนวณอัตโนมัติ: ${
      state.editOrderType === "playlist" ? "ราคาเหมาเพลย์ลิสต์" : "รวมราคาเพลงที่เลือก"
    }`;
  }
}

function addToEditCart(songId) {
  const song = state.songs.find((s) => s.id === songId);
  if (!song) return;
  if (state.editCartItems.some((i) => i.songId === song.id)) return;
  state.editCartItems.push({ songId: song.id, title: song.song_name, price: Number(song.price || 0) });
  state.editCartTotalEdited = false; // เพลงในตะกร้าเปลี่ยน ให้กลับไปคำนวณยอดรวมอัตโนมัติอีกครั้ง
  renderEditCart();
  renderEditSearchResults();
}

function removeFromEditCart(index) {
  state.editCartItems.splice(index, 1);
  state.editCartTotalEdited = false; // เพลงในตะกร้าเปลี่ยน ให้กลับไปคำนวณยอดรวมอัตโนมัติอีกครั้ง
  renderEditCart();
  renderEditSearchResults();
}

function handleEditSearchInput(e) {
  const q = e.target.value.trim().toLowerCase();
  if (!q) {
    state.editSearchResults = [];
  } else {
    state.editSearchResults = state.songs.filter((s) =>
      [s.song_name, s.artist, s.dj_name].join(" ").toLowerCase().includes(q)
    );
  }
  renderEditSearchResults();
}

/* ---------------- Render: ผลค้นหาเพลย์ลิสต์ (modal แก้ไขออเดอร์) ---------------- */
function renderEditPlaylistSearchResults() {
  const container = document.getElementById("eOrdPlaylistResults");
  if (!container) return;
  container.innerHTML = "";
  if (state.editSelectedPlaylist) return;
  if (state.editPlaylistSearchResults.length === 0) return;

  state.editPlaylistSearchResults.forEach((pl) => {
    const songCount = getSongsInPlaylist(pl.id).length;
    const card = document.createElement("div");
    card.className = "playlist-result-card";
    card.innerHTML = `
      <img src="${pl.cover_url || ""}">
      <div class="info" style="flex:1;">
        <div class="n1">${escapeHtml(getPlaylistName(pl))}</div>
        <div class="n2">${songCount} เพลง · ราคาเหมา ${formatLAK(pl.price)}</div>
      </div>
    `;
    card.addEventListener("click", () => selectEditPlaylist(pl.id));
    container.appendChild(card);
  });
}

function renderEditPlaylistSelected() {
  const container = document.getElementById("eOrdPlaylistSelected");
  if (!container) return;
  container.innerHTML = "";
  if (!state.editSelectedPlaylist) return;

  const pl = state.editSelectedPlaylist;
  const card = document.createElement("div");
  card.className = "playlist-selected-card";
  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div style="font-weight:800;">🎶 ${escapeHtml(getPlaylistName(pl))}</div>
      <button class="icon-btn" id="eOrdPlaylistClearBtn">✕</button>
    </div>
    <div style="font-size:12px;color:var(--text-dim);">${state.editCartItems.length} เพลง · ราคาเหมา ${formatLAK(pl.price)}</div>
  `;
  container.appendChild(card);
  document.getElementById("eOrdPlaylistClearBtn").addEventListener("click", clearEditSelectedPlaylist);
}

function selectEditPlaylist(playlistId) {
  const pl = state.playlists.find((p) => p.id === playlistId);
  if (!pl) return;

  const songs = getSongsInPlaylist(pl.id);
  state.editSelectedPlaylist = pl;
  state.editCartItems = songs.map((s) => ({ songId: s.id, title: s.song_name, price: Number(s.price || 0) }));
  state.editCartTotalEdited = false;
  document.getElementById("eOrdPlaylistSearch").value = "";
  state.editPlaylistSearchResults = [];

  renderEditPlaylistSelected();
  renderEditPlaylistSearchResults();
  renderEditCart();
}

function clearEditSelectedPlaylist() {
  state.editSelectedPlaylist = null;
  state.editCartItems = [];
  state.editCartTotalEdited = false;
  renderEditPlaylistSelected();
  renderEditPlaylistSearchResults();
  renderEditCart();
}

function handleEditPlaylistSearchInput(e) {
  const q = e.target.value.trim().toLowerCase();
  state.editPlaylistSearchResults = !q ? [] : state.playlists.filter((p) => getPlaylistName(p).toLowerCase().includes(q));
  renderEditPlaylistSearchResults();
}

/* ---------------- สลับประเภทออเดอร์ในโหมดแก้ไข (ไม่ล้างข้อมูลอัตโนมัติ ยกเว้นผู้ใช้กดสลับเอง) ---------------- */
function switchEditOrderType(type) {
  if (state.editOrderType === type) return;
  state.editOrderType = type;

  document.querySelectorAll('#eOrdTypeToggle [data-edit-order-type]').forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-edit-order-type") === type);
  });
  document.getElementById("eOrdSingleSection").style.display = type === "single" ? "" : "none";
  document.getElementById("eOrdPlaylistSection").style.display = type === "playlist" ? "" : "none";

  state.editCartItems = [];
  state.editCartTotalEdited = false;
  state.editSelectedPlaylist = null;
  state.editSearchResults = [];
  state.editPlaylistSearchResults = [];
  document.getElementById("eOrderSongSearch").value = "";
  document.getElementById("eOrdPlaylistSearch").value = "";

  renderEditSearchResults();
  renderEditPlaylistSelected();
  renderEditPlaylistSearchResults();
  renderEditCart();
}

/* เปิด modal แก้ไข พร้อมกรอกข้อมูลออเดอร์เดิมลงในฟอร์ม */
function openEditOrderModal(orderId) {
  const order = state.allOrders.find((o) => o.id === orderId);
  if (!order) return;

  state.editingOrderId = orderId;
  state.editCartItems = (order.items || []).map((i) => ({
    songId: i.song_id, title: i.title, price: Number(i.price || 0),
  }));
  state.editSearchResults = [];
  state.editPlaylistSearchResults = [];

  // ตั้งค่าประเภทออเดอร์และเพลย์ลิสต์ที่เลือกไว้ (ถ้าออเดอร์นี้ถูกสร้างแบบยกเพลย์ลิสต์)
  const orderType = order.order_type === "playlist" ? "playlist" : "single";
  state.editOrderType = orderType;
  state.editSelectedPlaylist = orderType === "playlist" && order.playlist_id
    ? (state.playlists.find((p) => p.id === order.playlist_id) || { id: order.playlist_id, playlist_name: order.playlist_name || "เพลย์ลิสต์", price: order.total })
    : null;

  document.querySelectorAll('#eOrdTypeToggle [data-edit-order-type]').forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-edit-order-type") === orderType);
  });
  document.getElementById("eOrdSingleSection").style.display = orderType === "single" ? "" : "none";
  document.getElementById("eOrdPlaylistSection").style.display = orderType === "playlist" ? "" : "none";

  document.getElementById("eOrderCustomerName").value = order.customer_name || "";
  document.getElementById("eOrderCustomerWhatsapp").value = order.whatsapp || "";
  document.getElementById("eOrderSongSearch").value = "";
  document.getElementById("eOrdPlaylistSearch").value = "";
  document.getElementById("eOrderFeedback").textContent = "";

  // ทุกครั้งที่แก้ไข ให้ยอดรวมกลับมาคำนวณจากข้อมูลสินค้าจริง
  state.editCartTotalEdited = false;

  renderEditCart();
  renderEditSearchResults();
  renderEditPlaylistSelected();
  renderEditPlaylistSearchResults();
  const backdrop = document.getElementById("orderFormBackdrop");
  backdrop.classList.add("open");
  backdrop.style.display = "flex";
}

function closeEditOrderModal() {
  const backdrop = document.getElementById("orderFormBackdrop");
  backdrop.classList.remove("open");
  backdrop.style.display = "none";
  state.editingOrderId = null;
  state.editCartItems = [];
  state.editSearchResults = [];
  state.editCartTotalEdited = false;
  state.editOrderType = "single";
  state.editSelectedPlaylist = null;
  state.editPlaylistSearchResults = [];
}

/* บันทึกการแก้ไขออเดอร์ลง Firestore จริง */
async function handleUpdateOrder() {
  const orderId = state.editingOrderId;
  if (!orderId) return;

  const nameInput = document.getElementById("eOrderCustomerName");
  const whatsappInput = document.getElementById("eOrderCustomerWhatsapp");
  const feedback = document.getElementById("eOrderFeedback");
  const btn = document.getElementById("eOrderSaveBtn");

  const customerName = nameInput.value.trim();
  const whatsapp = whatsappInput.value.trim();
  const total = calculateOrderTotal(
    state.editOrderType,
    state.editCartItems,
    state.editSelectedPlaylist
  );
  const existingOrder = state.allOrders.find((o) => o.id === orderId);

  feedback.style.color = "var(--danger)";
  feedback.textContent = "";

  if (!customerName || !whatsapp) {
    feedback.textContent = "กรุณากรอกชื่อลูกค้าและเบอร์ WhatsApp";
    return;
  }
  if (state.editOrderType === "playlist" && !state.editSelectedPlaylist) {
    feedback.textContent = "กรุณาเลือกเพลย์ลิสต์ที่ต้องการขาย";
    return;
  }
  if (state.editCartItems.length === 0) {
    feedback.textContent = "กรุณาเลือกเพลงอย่างน้อย 1 เพลง";
    return;
  }
  if (!Number.isFinite(total) || total < 0) {
    feedback.textContent = "กรุณากรอกยอดรวมให้ถูกต้อง";
    return;
  }

  btn.disabled = true;
  btn.textContent = "กำลังบันทึก...";

  const updatedData = {
    customer_name: customerName,
    whatsapp: whatsapp,
    items: state.editCartItems.map((i) => ({ song_id: i.songId, title: i.title, price: i.price })),
    total,
    order_type: state.editOrderType, // "single" | "playlist"
    playlist_id: state.editOrderType === "playlist" && state.editSelectedPlaylist ? state.editSelectedPlaylist.id : null,
    playlist_name: state.editOrderType === "playlist" && state.editSelectedPlaylist ? getPlaylistName(state.editSelectedPlaylist) : null,
    store_name: existingOrder?.store_name || state.storeName,
    receipt_number: existingOrder?.receipt_number || getReceiptNumber(orderId, existingOrder?.created_at),
    updated_at: new Date().toISOString(),
  };

  try {
    await updateDoc(doc(db, "orders", orderId), updatedData);
    closeEditOrderModal();
    await refreshDashboardAndHistory();
    openReceipt(orderId);
  } catch (err) {
    feedback.textContent = "บันทึกไม่สำเร็จ: " + err.message;
  }

  btn.disabled = false;
  btn.textContent = "บันทึกการแก้ไข";
}

/* ---------------- Event handlers (ฟอร์มสร้างออเดอร์ใหม่) ---------------- */
function handleSearchInput(e) {
  const q = e.target.value.trim().toLowerCase();
  if (!q) {
    state.searchResults = [];
  } else {
    state.searchResults = state.songs.filter((s) =>
      [s.song_name, s.artist, s.dj_name].join(" ").toLowerCase().includes(q)
    );
  }
  renderSearchResults();
}

function addToCart(songId) {
  const song = state.songs.find((s) => s.id === songId);
  if (!song) return;
  if (state.cartItems.some((i) => i.songId === song.id)) return;
  state.cartItems.push({ songId: song.id, title: song.song_name, price: Number(song.price || 0) });
  state.cartTotalEdited = false; // เพลงในตะกร้าเปลี่ยน ให้กลับไปคำนวณยอดรวมอัตโนมัติอีกครั้ง
  renderCart();
  renderSearchResults();
}

function removeFromCart(index) {
  state.cartItems.splice(index, 1);
  state.cartTotalEdited = false; // เพลงในตะกร้าเปลี่ยน ให้กลับไปคำนวณยอดรวมอัตโนมัติอีกครั้ง
  renderCart();
  renderSearchResults();
}

async function refreshDashboardAndHistory() {
  const orders = await loadOrdersFromDatabase();
  state.allOrders = orders;
  renderStats(orders);
  renderFilterPills();
  renderHistory();
}

async function handleSubmitOrder() {
  const nameInput = document.getElementById("ordCustomerName");
  const whatsappInput = document.getElementById("ordCustomerWhatsapp");
  const feedback = document.getElementById("ordFormFeedback");
  const btn = document.getElementById("ordSubmitBtn");

  const customerName = nameInput.value.trim();
  const whatsapp = whatsappInput.value.trim();
  const total = calculateOrderTotal(
    state.orderType,
    state.cartItems,
    state.selectedPlaylist
  );

  feedback.textContent = "";
  feedback.style.color = "var(--danger)";

  if (!customerName || !whatsapp) {
    feedback.textContent = "กรุณากรอกชื่อลูกค้าและเบอร์ WhatsApp";
    return;
  }
  if (state.orderType === "playlist" && !state.selectedPlaylist) {
    feedback.textContent = "กรุณาเลือกเพลย์ลิสต์ที่ต้องการขาย";
    return;
  }
  if (state.cartItems.length === 0) {
    feedback.textContent = "กรุณาเลือกเพลงอย่างน้อย 1 เพลง";
    return;
  }
  if (!Number.isFinite(total) || total < 0) {
    feedback.textContent = "กรุณากรอกยอดรวมให้ถูกต้อง";
    return;
  }

  btn.disabled = true;
  btn.textContent = "กำลังบันทึก...";

  const order = {
    customer_name: customerName,
    whatsapp: whatsapp,
    items: state.cartItems.map((i) => ({ song_id: i.songId, title: i.title, price: i.price })),
    total,
    order_type: state.orderType, // "single" | "playlist" — ใช้แยกสถิติใน Dashboard
    playlist_id: state.orderType === "playlist" && state.selectedPlaylist ? state.selectedPlaylist.id : null,
    playlist_name: state.orderType === "playlist" && state.selectedPlaylist ? getPlaylistName(state.selectedPlaylist) : null,
    store_name: state.storeName,
    status: "pending_verify",
    created_at: new Date().toISOString(),
  };

  try {
    const orderRef = doc(collection(db, "orders"));
    order.receipt_number = getReceiptNumber(orderRef.id, order.created_at);
    await setDoc(orderRef, order);

    nameInput.value = "";
    whatsappInput.value = "";
    document.getElementById("ordSongSearch").value = "";
    document.getElementById("ordPlaylistSearch").value = "";
    state.cartItems = [];
    state.searchResults = [];
    state.cartTotalEdited = false;
    state.selectedPlaylist = null;
    state.playlistSearchResults = [];
    renderCart();
    renderSearchResults();
    renderPlaylistSelected();
    renderPlaylistSearchResults();

    feedback.style.color = "var(--success)";
    feedback.textContent = `บันทึกออเดอร์ของ ${customerName} เรียบร้อยแล้ว ✓`;

    await refreshDashboardAndHistory();
    openReceipt(orderRef.id);
  } catch (err) {
    feedback.textContent = "บันทึกไม่สำเร็จ: " + err.message;
  }

  btn.disabled = false;
  btn.textContent = "บันทึกออเดอร์";
}

/* ---------------- Init (เรียกทุกครั้งที่เปิดหน้า "จัดการออเดอร์") ---------------- */
export async function initOrdersView() {
  const loadingEl = document.getElementById("ordSongsLoading");
  ensureReceiptElements();
  ensureFullFilesElements();
  loadingEl.style.display = "block";
  loadingEl.textContent = "กำลังโหลดรายชื่อเพลง...";

  try {
    // โหลดทั้งเพลงและเพลย์ลิสต์ (ราคาเหมา) พร้อมกัน เพื่อให้ระบบขายยกเพลย์ลิสต์ใช้งานได้ทันที
    const [songs, playlists, storeName] = await Promise.all([
      loadSongsFromDatabase(),
      loadPlaylistsFromDatabase(),
      loadStoreName(),
    ]);
    state.songs = songs;
    state.playlists = playlists;
    state.storeName = storeName;
    loadingEl.style.display = "none";
  } catch (err) {
    loadingEl.textContent = "โหลดข้อมูลไม่สำเร็จ: " + err.message;
    return;
  }

  if (!state.listenersBound) {
    document.getElementById("ordSongSearch").addEventListener("input", debounce(handleSearchInput, 200));
    document.getElementById("ordSubmitBtn").addEventListener("click", handleSubmitOrder);

    // ปุ่มสลับประเภทออเดอร์: เพลงเดี่ยว / ยกเพลย์ลิสต์ (ฟอร์มสร้างออเดอร์ใหม่)
    document.querySelectorAll('#ordTypeToggle [data-order-type]').forEach((btn) => {
      btn.addEventListener("click", () => switchOrderType(btn.getAttribute("data-order-type")));
    });
    document.getElementById("ordPlaylistSearch").addEventListener("input", debounce(handlePlaylistSearchInput, 200));

    // ปุ่ม/ช่องค้นหาของ modal แก้ไขออเดอร์
    document.getElementById("eOrderSongSearch").addEventListener("input", debounce(handleEditSearchInput, 200));
    document.getElementById("eOrderSaveBtn").addEventListener("click", handleUpdateOrder);
    document.getElementById("orderFormClose").addEventListener("click", closeEditOrderModal);
    document.getElementById("orderFormBackdrop").addEventListener("click", (e) => {
      if (e.target.id === "orderFormBackdrop") closeEditOrderModal();
    });

    // ปุ่มสลับประเภทออเดอร์ในโมดัลแก้ไข
    document.querySelectorAll('#eOrdTypeToggle [data-edit-order-type]').forEach((btn) => {
      btn.addEventListener("click", () => switchEditOrderType(btn.getAttribute("data-edit-order-type")));
    });
    document.getElementById("eOrdPlaylistSearch").addEventListener("input", debounce(handleEditPlaylistSearchInput, 200));

    document.getElementById("receiptClose").addEventListener("click", closeReceipt);
    document.getElementById("receiptPrintBtn").addEventListener("click", () => window.print());
    document.getElementById("receiptBackdrop").addEventListener("click", (e) => {
      if (e.target.id === "receiptBackdrop") closeReceipt();
    });

    document.getElementById("fullFilesClose").addEventListener("click", closeFullFilesModal);
    document.getElementById("fullFilesBackdrop").addEventListener("click", (e) => {
      if (e.target.id === "fullFilesBackdrop") closeFullFilesModal();
    });

    state.listenersBound = true;
  }

  // รีเซ็ตฟอร์มสร้างออเดอร์ใหม่ทุกครั้งที่เปิดหน้านี้ กลับไปเริ่มที่โหมด "เพลงเดี่ยว" เสมอ
  state.cartItems = [];
  state.searchResults = [];
  state.cartTotalEdited = false;
  state.orderType = "single";
  state.selectedPlaylist = null;
  state.playlistSearchResults = [];
  document.querySelectorAll('#ordTypeToggle [data-order-type]').forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-order-type") === "single");
  });
  document.getElementById("ordSingleSection").style.display = "";
  document.getElementById("ordPlaylistSection").style.display = "none";
  document.getElementById("ordSongSearch").value = "";
  document.getElementById("ordPlaylistSearch").value = "";
  document.getElementById("ordFormFeedback").textContent = "";
  renderCart();
  renderSearchResults();
  renderPlaylistSelected();
  renderPlaylistSearchResults();

  await refreshDashboardAndHistory();
}
