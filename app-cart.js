// app-cart.js — ระบบตะกร้าสินค้า
// ===================================================
import { db } from "./firebase-init.js";
import {
  collection, doc, getDoc, getDocs, query, setDoc, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const CART_STORAGE_KEY = "music_store_cart_v1";
const CHECKOUT_ORDER_KEY = "music_store_checkout_order_v1";

export function initCart({ state, showToast, escapeHtml, formatPrice, buildWhatsAppLink }) {
  let submitting = false;
  let activeOrderId = null;
  let activeOrderKey = null;

  function loadCart() {
    try {
      const raw = localStorage.getItem(CART_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) throw new Error("cart is not an array");
      const uniqueItems = new Map();
      parsed
        .filter(item => item && item.id && item.song_name)
        .forEach(item => {
          const id = String(item.id);
          if (!uniqueItems.has(id)) {
            uniqueItems.set(id, {
              id,
              song_name: String(item.song_name),
              cover_url: String(item.cover_url || ""),
              dj_name: String(item.dj_name || ""),
              price: Math.max(0, Number(item.price) || 0),
              kind: item.kind === "playlist" ? "playlist" : "song",
              quantity: 1
            });
          }
        });
      state.cart = Array.from(uniqueItems.values());
    } catch (_) {
      state.cart = [];
      try { localStorage.removeItem(CART_STORAGE_KEY); } catch (__) {}
    }
    renderCart();
  }

  function saveCart() {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(state.cart));
    } catch (_) {
      showToast("บันทึกตะกร้าไม่ได้ กรุณาตรวจสอบพื้นที่จัดเก็บของเบราว์เซอร์", "error");
    }
    renderCart();
  }

  function cartQuantity() {
    return state.cart.reduce((total, item) => total + item.quantity, 0);
  }

  function cartTotal() {
    return state.cart.reduce((total, item) => total + item.price * item.quantity, 0);
  }

  function addToCart(song) {
    if (!song || !song.id) return;
    const kind = song.kind === "playlist" ? "playlist" : "song";
    if (state.cart.length > 0 && state.cart.some(item => item.kind !== kind)) {
      showToast("เพลงเดี่ยวและเพลย์ลิสต์ต้องสั่งแยก Order กัน", "error");
      return;
    }
    if (kind === "playlist" && state.cart.length > 0) {
      showToast("เพลย์ลิสต์ต้องสั่งทีละชุดต่อหนึ่ง Order", "error");
      return;
    }
    const existing = state.cart.find(item => item.id === String(song.id));
    if (existing) {
      showToast("รายการนี้อยู่ในตะกร้าแล้ว", "error");
      return;
    }
    activeOrderId = null;
    activeOrderKey = null;
    state.cart.push({
      id: String(song.id),
      song_name: String(song.song_name || ""),
      cover_url: String(song.cover_url || ""),
      dj_name: String(song.dj_name || ""),
      price: Math.max(0, Number(song.price) || 0),
      kind,
      quantity: 1
    });
    showToast("เพิ่มลงตะกร้าแล้ว", "success");
    saveCart();
  }

  function removeFromCart(itemId) {
    state.cart = state.cart.filter(item => item.id !== itemId);
    saveCart();
  }

  function renderCart() {
    const itemsEl = document.getElementById("cartItems");
    const summaryEl = document.getElementById("cartSummary");
    const badgeEl = document.getElementById("cartBadge");
    if (!itemsEl) return;

    const quantity = cartQuantity();
    if (badgeEl) {
      badgeEl.textContent = quantity > 99 ? "99+" : String(quantity);
      badgeEl.hidden = quantity === 0;
    }

    if (state.cart.length === 0) {
      itemsEl.innerHTML = `
        <div class="cart-empty">
          <p>ยังไม่มีเพลงในตะกร้า</p>
          <button class="btn secondary" type="button" data-cart-continue>กลับไปเลือกซื้อเพลง</button>
        </div>`;
      if (summaryEl) summaryEl.hidden = true;
      return;
    }

    itemsEl.innerHTML = state.cart.map(item => `
      <div class="cart-item" data-cart-item="${escapeHtml(item.id)}">
        <img class="cart-item-cover" src="${escapeHtml(item.cover_url)}" alt="">
        <div class="cart-item-info">
          <div class="cart-item-name">${escapeHtml(item.song_name)}</div>
          <div class="cart-item-meta">${item.kind === "playlist" ? "เพลย์ลิสต์" : escapeHtml(item.dj_name || "เพลง Remix")} · ${formatPrice(item.price)}${item.kind === "playlist" ? "" : " / เพลง"}</div>
        </div>
        <div class="cart-item-total">${formatPrice(item.price * item.quantity)}</div>
        <button class="cart-remove" type="button" data-cart-remove="${escapeHtml(item.id)}">ลบ</button>
      </div>
    `).join("");

    if (summaryEl) summaryEl.hidden = false;
    const quantityEl = document.getElementById("cartTotalQuantity");
    const priceEl = document.getElementById("cartTotalPrice");
    if (quantityEl) quantityEl.textContent = `${quantity} เพลง`;
    if (priceEl) priceEl.textContent = formatPrice(cartTotal());
  }

  function openCart() {
    const backdrop = document.getElementById("cartBackdrop");
    if (!backdrop) return;
    renderCart();
    backdrop.classList.add("show");
    backdrop.setAttribute("aria-hidden", "false");
  }

  function closeCart() {
    const backdrop = document.getElementById("cartBackdrop");
    if (!backdrop) return;
    backdrop.classList.remove("show");
    backdrop.setAttribute("aria-hidden", "true");
  }

  function renderCheckoutSummary() {
    const el = document.getElementById("checkoutSummary");
    if (!el) return;
    el.innerHTML = `
      <div class="cart-summary-row">
        <span style="color:var(--text-dim);">รายการ</span>
        <strong>${cartQuantity()} เพลง</strong>
      </div>
      <div class="cart-summary-row">
        <span style="color:var(--text-dim);">ยอดรวมโดยประมาณ</span>
        <strong style="color:var(--success);">${formatPrice(cartTotal())}</strong>
      </div>
      <div style="font-size:11px;color:var(--text-dim);margin-top:8px;">
        ระบบจะตรวจสอบราคาและรายการล่าสุดจากฐานข้อมูลอีกครั้งก่อนสร้าง Order
      </div>
    `;
  }

  function openCheckout() {
    if (state.cart.length === 0) {
      showToast("ยังไม่มีเพลงในตะกร้า", "error");
      return;
    }
    renderCheckoutSummary();
    const feedback = document.getElementById("checkoutFeedback");
    if (feedback) feedback.textContent = "";
    closeCart();
    const backdrop = document.getElementById("checkoutBackdrop");
    if (backdrop) {
      backdrop.classList.add("show");
      backdrop.setAttribute("aria-hidden", "false");
    }
  }

  function closeCheckout() {
    if (submitting) return;
    const backdrop = document.getElementById("checkoutBackdrop");
    if (!backdrop) return;
    backdrop.classList.remove("show");
    backdrop.setAttribute("aria-hidden", "true");
  }

  function setCheckoutFeedback(message, type = "error") {
    const el = document.getElementById("checkoutFeedback");
    if (!el) return;
    el.textContent = message;
    el.style.color = type === "success" ? "var(--success)" : "var(--danger)";
  }

  function getReceiptNumber(orderId, createdAt) {
    const date = new Date(createdAt || Date.now());
    const ymd = Number.isNaN(date.getTime())
      ? "00000000"
      : [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("");
    return `RCPT-${ymd}-${String(orderId || "000000").slice(-6).toUpperCase()}`;
  }

  function hashCheckoutKey(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function getCheckoutKey(customerName, whatsapp) {
    return hashCheckoutKey(JSON.stringify({
      customerName,
      whatsapp,
      items: state.cart.map(item => ({ id: item.id, kind: item.kind }))
    }));
  }

  function getStoredOrderId(checkoutKey) {
    try {
      const stored = JSON.parse(sessionStorage.getItem(CHECKOUT_ORDER_KEY) || "null");
      return stored?.key === checkoutKey && stored.id ? String(stored.id) : null;
    } catch (_) {
      return null;
    }
  }

  function storeOrderId(checkoutKey, orderId) {
    try {
      sessionStorage.setItem(CHECKOUT_ORDER_KEY, JSON.stringify({ key: checkoutKey, id: orderId }));
    } catch (_) {}
  }

  function clearStoredOrderId() {
    try { sessionStorage.removeItem(CHECKOUT_ORDER_KEY); } catch (_) {}
  }

  async function resolveCartFromDatabase() {
    const cartItems = [];
    let kind = null;
    let playlist = null;
    if (state.cart.filter(item => item.kind === "playlist").length > 1) {
      throw new Error("เพลย์ลิสต์ต้องสั่งทีละชุดต่อหนึ่ง Order");
    }

    for (const cartItem of state.cart) {
      const itemKind = cartItem.kind === "playlist" ? "playlist" : "song";
      if (kind && kind !== itemKind) {
        throw new Error("เพลงเดี่ยวและเพลย์ลิสต์ต้องสั่งแยก Order กัน");
      }
      kind = itemKind;

      if (itemKind === "song") {
        const songSnap = await getDoc(doc(db, "songs", String(cartItem.id)));
        if (!songSnap.exists()) throw new Error(`ไม่พบเพลง "${cartItem.song_name}" ในฐานข้อมูล`);
        const song = songSnap.data();
        if (song.status === "hidden") throw new Error(`เพลง "${song.song_name || cartItem.song_name}" ปิดการขายแล้ว`);
        const price = Number(song.price);
        if (!Number.isFinite(price) || price < 0) throw new Error(`ราคาเพลง "${song.song_name || cartItem.song_name}" ไม่ถูกต้อง`);
        cartItems.push({
          song_id: songSnap.id,
          title: String(song.song_name || cartItem.song_name || "เพลง"),
          price,
          quantity: 1
        });
        continue;
      }

      const playlistId = String(cartItem.id).replace(/^playlist:/, "");
      const playlistSnap = await getDoc(doc(db, "playlists", playlistId));
      if (!playlistSnap.exists()) throw new Error(`ไม่พบเพลย์ลิสต์ "${cartItem.song_name}" ในฐานข้อมูล`);
      playlist = { id: playlistSnap.id, ...playlistSnap.data() };
      const playlistPrice = Number(playlist.price);
      if (!Number.isFinite(playlistPrice) || playlistPrice <= 0) {
        throw new Error(`เพลย์ลิสต์ "${playlist.playlist_name || cartItem.song_name}" ยังไม่มีราคาขาย`);
      }

      const songsSnap = await getDocs(query(collection(db, "songs"), where("playlist_id", "==", playlistId)));
      songsSnap.docs.forEach(songDoc => {
        const song = songDoc.data();
        if (song.status === "hidden") return;
        cartItems.push({
          song_id: songDoc.id,
          title: String(song.song_name || "เพลง"),
          price: Number.isFinite(Number(song.price)) ? Number(song.price) : 0,
          quantity: 1
        });
      });
      if (cartItems.length === 0) throw new Error("เพลย์ลิสต์นี้ยังไม่มีเพลงที่เปิดขาย");
    }

    const settingsSnap = await getDoc(doc(db, "settings", "main"));
    const settings = settingsSnap.exists() ? settingsSnap.data() : {};
    const total = kind === "playlist" ? Number(playlist.price) : cartItems.reduce((sum, item) => sum + item.price, 0);
    if (!Number.isFinite(total) || total < 0) throw new Error("คำนวณยอดรวมจากฐานข้อมูลไม่สำเร็จ");

    return {
      items: cartItems,
      total,
      orderType: kind === "playlist" ? "playlist" : "single",
      playlist,
      settings
    };
  }

  function buildAdminWhatsAppText(order, receiptNumber, storeName) {
    const lines = order.order_type === "playlist"
      ? [`1. เพลย์ลิสต์: ${order.playlist_name || "ไม่ระบุชื่อ"} — ${formatPrice(order.total)}`]
      : order.items.map((item, index) =>
          `${index + 1}. ${item.title} — ${formatPrice(item.price)}`
        );
    return [
      `สวัสดีครับ มี Order ใหม่จาก ${storeName || "Music Store"}`,
      "",
      `🧾 Order: ${receiptNumber}`,
      `👤 ลูกค้า: ${order.customer_name}`,
      `📱 WhatsApp ลูกค้า: ${order.whatsapp}`,
      "",
      "🛒 รายการสั่งซื้อ",
      ...lines,
      "",
      `🎵 จำนวนทั้งหมด: ${order.items.length} เพลง${order.order_type === "playlist" ? "ในเพลย์ลิสต์" : ""}`,
      `💰 ราคารวม: ${formatPrice(order.total)}`,
      "",
      "สถานะ: รอตรวจสอบการโอน"
    ].join("\n");
  }

  async function checkoutCart() {
    if (submitting) return;
    const nameInput = document.getElementById("checkoutCustomerName");
    const whatsappInput = document.getElementById("checkoutCustomerWhatsapp");
    const customerName = nameInput?.value.trim() || "";
    const whatsapp = whatsappInput?.value.trim() || "";
    if (!customerName || !whatsapp) {
      setCheckoutFeedback("กรุณากรอกชื่อลูกค้าและเบอร์ WhatsApp");
      return;
    }
    if (state.cart.length === 0) {
      setCheckoutFeedback("ยังไม่มีเพลงในตะกร้า");
      return;
    }

    submitting = true;
    const btn = document.getElementById("submitCartOrderBtn");
    if (btn) { btn.disabled = true; btn.textContent = "กำลังตรวจสอบและบันทึก..."; }
    setCheckoutFeedback("กำลังตรวจสอบรายการและราคาจากฐานข้อมูล...", "success");

    try {
      const resolved = await resolveCartFromDatabase();
      const createdAt = new Date().toISOString();
      const checkoutKey = getCheckoutKey(customerName, whatsapp);
      const reusableOrderId = activeOrderKey === checkoutKey
        ? activeOrderId
        : getStoredOrderId(checkoutKey);
      const orderRef = reusableOrderId
        ? doc(db, "orders", reusableOrderId)
        : doc(collection(db, "orders"));
      activeOrderId = orderRef.id;
      activeOrderKey = checkoutKey;
      storeOrderId(checkoutKey, orderRef.id);
      const receiptNumber = getReceiptNumber(orderRef.id, createdAt);
      const order = {
        customer_name: customerName,
        whatsapp,
        items: resolved.items,
        total: resolved.total,
        order_type: resolved.orderType,
        playlist_id: resolved.playlist?.id || null,
        playlist_name: resolved.playlist?.playlist_name || null,
        store_name: resolved.settings.website_name || "Music Store",
        status: "pending_verify",
        created_at: createdAt,
        receipt_number: receiptNumber
      };
      await setDoc(orderRef, order);

      state.cart = [];
      try { localStorage.removeItem(CART_STORAGE_KEY); } catch (_) {}
      activeOrderId = null;
      activeOrderKey = null;
      clearStoredOrderId();
      renderCart();
      if (nameInput) nameInput.value = "";
      if (whatsappInput) whatsappInput.value = "";
      setCheckoutFeedback(`บันทึก Order ${receiptNumber} สำเร็จแล้ว`, "success");

      const number = String(resolved.settings.whatsapp_number || "").replace(/[^0-9]/g, "");
      if (number) {
        const text = buildAdminWhatsAppText(order, receiptNumber, order.store_name);
        window.open(buildWhatsAppLink(number, text), "_blank", "noopener");
      } else {
        showToast("บันทึก Order แล้ว แต่ร้านยังไม่ได้ตั้งค่าเบอร์ WhatsApp", "error");
      }
      setTimeout(closeCheckout, 900);
    } catch (err) {
      setCheckoutFeedback("บันทึก Order ไม่สำเร็จ: " + (err?.message || err));
    } finally {
      submitting = false;
      if (btn) { btn.disabled = false; btn.textContent = "ยืนยันสั่งซื้อ"; }
    }
  }

  function bindCartEvents() {
    document.getElementById("cartToggleBtn")?.addEventListener("click", openCart);
    document.getElementById("cartCloseBtn")?.addEventListener("click", closeCart);
    document.getElementById("cartBackdrop")?.addEventListener("click", event => {
      if (event.target === event.currentTarget) closeCart();
    });
    document.getElementById("checkoutCloseBtn")?.addEventListener("click", closeCheckout);
    document.getElementById("checkoutBackdrop")?.addEventListener("click", event => {
      if (event.target === event.currentTarget) closeCheckout();
    });
    document.getElementById("cartItems")?.addEventListener("click", event => {
      const button = event.target.closest("button");
      if (!button) return;
      if (button.matches("[data-cart-continue]")) { closeCart(); return; }
      if (button.dataset.cartRemove) {
        activeOrderId = null;
        activeOrderKey = null;
        removeFromCart(button.dataset.cartRemove);
      }
    });
    document.getElementById("clearCartBtn")?.addEventListener("click", () => {
      if (state.cart.length && window.confirm("ต้องการล้างเพลงทั้งหมดออกจากตะกร้าหรือไม่?")) {
        state.cart = [];
        activeOrderId = null;
        activeOrderKey = null;
        saveCart();
        showToast("ล้างตะกร้าแล้ว", "success");
      }
    });
    document.getElementById("checkoutCartBtn")?.addEventListener("click", openCheckout);
    document.getElementById("submitCartOrderBtn")?.addEventListener("click", checkoutCart);
  }

  return {
    loadCart,
    bindCartEvents,
    addToCart,
    renderCart,
    openCart,
    closeCart,
    checkoutCart
  };
}
