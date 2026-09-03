// orders.js — ระบบจัดการออเดอร์ (เชื่อมกับ Firestore จริงของเว็บ Music Store)
// ใช้ collection "songs" ที่มีอยู่แล้วเป็นแหล่งข้อมูลเพลง/ราคา
// และสร้าง collection ใหม่ชื่อ "orders" สำหรับเก็บออเดอร์
// ===================================================
import { db } from "./firebase-init.js";
import {
  collection, addDoc, getDocs, query, orderBy, where, doc, updateDoc
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
function formatLAK(v) { return Number(v || 0).toLocaleString("en-US") + " LAK"; }
function debounce(fn, wait) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), wait); }; }

const state = {
  songs: [],        // เพลงทั้งหมด (status: active) จาก collection "songs"
  searchResults: [],
  cartItems: [],     // เพลงที่เลือกไว้ในออเดอร์ที่กำลังกรอก
  allOrders: [],      // แคชออเดอร์ล่าสุดที่โหลดมา (ใช้กรองสถานะโดยไม่ต้องโหลดซ้ำ)
  historyFilter: "all", // สถานะที่กำลังกรองดูในประวัติออเดอร์
  listenersBound: false, // กันการผูก event ซ้ำเมื่อเปิดหน้านี้หลายครั้ง
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

/* ---------------- คำนวณ ---------------- */
function calculateCartTotal(items) {
  return items.reduce((sum, item) => sum + item.price, 0);
}
function calculateStats(orders) {
  // totalOrders = ออเดอร์ทั้งหมดทุกสถานะ (ปริมาณงานรวม)
  // totalSongsSold / totalRevenue = นับเฉพาะออเดอร์ที่ "สำเร็จ" แล้วเท่านั้น
  // เพื่อไม่ให้ออเดอร์ที่ยังรอตรวจสอบหรือถูกยกเลิกไปปนกับยอดขายจริง
  const totalOrders = orders.length;
  const completed = orders.filter((o) => o.status === "completed");
  const totalSongsSold = completed.reduce((sum, o) => sum + (o.items ? o.items.length : 0), 0);
  const totalRevenue = completed.reduce((sum, o) => sum + (o.total || 0), 0);
  return { totalOrders, totalSongsSold, totalRevenue };
}

/* ---------------- Render: ผลค้นหาเพลง ---------------- */
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

/* ---------------- Render: ตะกร้าออเดอร์ปัจจุบัน ---------------- */
function renderCart() {
  const container = document.getElementById("ordCartItems");
  const totalEl = document.getElementById("ordCartTotal");
  container.innerHTML = "";

  if (state.cartItems.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:10px 0;">ยังไม่ได้เลือกเพลง</div>`;
  } else {
    state.cartItems.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "list-row";
      row.innerHTML = `
        <div class="info"><div class="n1">${escapeHtml(item.title)}</div><div class="n2">${formatLAK(item.price)}</div></div>
        <div class="row-actions"><button class="icon-btn danger" data-remove="${index}">🗑</button></div>
      `;
      container.appendChild(row);
    });
    container.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => removeFromCart(Number(btn.getAttribute("data-remove"))));
    });
  }

  totalEl.textContent = formatLAK(calculateCartTotal(state.cartItems));
}

/* ---------------- Render: Dashboard สถิติออเดอร์ ---------------- */
function renderStats(orders) {
  const stats = calculateStats(orders);
  document.getElementById("ordStatCount").textContent = stats.totalOrders.toLocaleString("en-US");
  document.getElementById("ordStatSongs").textContent = stats.totalSongsSold.toLocaleString("en-US");
  document.getElementById("ordStatRevenue").textContent = formatLAK(stats.totalRevenue);
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
    return `
      <div class="list-row" style="flex-direction:column;align-items:stretch;gap:8px;">
        <div class="info">
          <div class="n1">${escapeHtml(o.customer_name)} · ${formatLAK(o.total)}</div>
          <div class="n2">${dateStr} · ${escapeHtml(o.whatsapp)}</div>
          <div class="n2">${songNames}</div>
        </div>
        <span class="status-badge" style="background:${cfg.bg};color:${cfg.color};">${cfg.emoji} ${cfg.label}</span>
        <select class="status-select" data-order-id="${o.id}">${options}</select>
      </div>
    `;
  }).join("");

  wrap.querySelectorAll("[data-order-id]").forEach((sel) => {
    sel.addEventListener("change", () => handleStatusChange(sel.getAttribute("data-order-id"), sel.value));
  });
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

/* ---------------- Event handlers ---------------- */
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
  renderCart();
  renderSearchResults();
}

function removeFromCart(index) {
  state.cartItems.splice(index, 1);
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

  feedback.textContent = "";
  feedback.style.color = "var(--danger)";

  if (!customerName || !whatsapp) {
    feedback.textContent = "กรุณากรอกชื่อลูกค้าและเบอร์ WhatsApp";
    return;
  }
  if (state.cartItems.length === 0) {
    feedback.textContent = "กรุณาเลือกเพลงอย่างน้อย 1 เพลง";
    return;
  }

  btn.disabled = true;
  btn.textContent = "กำลังบันทึก...";

  const order = {
    customer_name: customerName,
    whatsapp: whatsapp,
    items: state.cartItems.map((i) => ({ song_id: i.songId, title: i.title, price: i.price })),
    total: calculateCartTotal(state.cartItems),
    status: "pending_verify",
    created_at: new Date().toISOString(),
  };

  try {
    await addDoc(collection(db, "orders"), order);

    nameInput.value = "";
    whatsappInput.value = "";
    document.getElementById("ordSongSearch").value = "";
    state.cartItems = [];
    state.searchResults = [];
    renderCart();
    renderSearchResults();

    feedback.style.color = "var(--success)";
    feedback.textContent = `บันทึกออเดอร์ของ ${customerName} เรียบร้อยแล้ว ✓`;

    await refreshDashboardAndHistory();
  } catch (err) {
    feedback.textContent = "บันทึกไม่สำเร็จ: " + err.message;
  }

  btn.disabled = false;
  btn.textContent = "บันทึกออเดอร์";
}

/* ---------------- Init (เรียกทุกครั้งที่เปิดหน้า "จัดการออเดอร์") ---------------- */
export async function initOrdersView() {
  const loadingEl = document.getElementById("ordSongsLoading");
  loadingEl.style.display = "block";
  loadingEl.textContent = "กำลังโหลดรายชื่อเพลง...";

  try {
    state.songs = await loadSongsFromDatabase();
    loadingEl.style.display = "none";
  } catch (err) {
    loadingEl.textContent = "โหลดรายชื่อเพลงไม่สำเร็จ: " + err.message;
    return;
  }

  if (!state.listenersBound) {
    document.getElementById("ordSongSearch").addEventListener("input", debounce(handleSearchInput, 200));
    document.getElementById("ordSubmitBtn").addEventListener("click", handleSubmitOrder);
    state.listenersBound = true;
  }

  state.cartItems = [];
  state.searchResults = [];
  document.getElementById("ordSongSearch").value = "";
  document.getElementById("ordFormFeedback").textContent = "";
  renderCart();
  renderSearchResults();

  await refreshDashboardAndHistory();
}
