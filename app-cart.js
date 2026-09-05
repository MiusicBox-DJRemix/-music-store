// app-cart.js — ระบบตะกร้าสินค้า
// ===================================================

const CART_STORAGE_KEY = "music_store_cart_v1";

export function initCart({ state, showToast, escapeHtml, formatPrice, buildWhatsAppLink }) {
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
    const existing = state.cart.find(item => item.id === String(song.id));
    if (existing) {
      showToast("รายการนี้อยู่ในตะกร้าแล้ว", "error");
      return;
    }
    state.cart.push({
      id: String(song.id),
      song_name: String(song.song_name || ""),
      cover_url: String(song.cover_url || ""),
      dj_name: String(song.dj_name || ""),
      price: Math.max(0, Number(song.price) || 0),
      kind: song.kind === "playlist" ? "playlist" : "song",
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

  function checkoutCart() {
    if (state.cart.length === 0) {
      showToast("ยังไม่มีเพลงในตะกร้า", "error");
      return;
    }
    const lines = state.cart.map((item, index) =>
      `${index + 1}. ${item.song_name} — ${formatPrice(item.price)}`
    );
    const text = [
      "สวัสดีครับ ต้องการสั่งซื้อเพลงดังต่อไปนี้",
      "",
      "🛒 รายการสั่งซื้อ",
      ...lines,
      "",
      `🎵 จำนวนทั้งหมด: ${cartQuantity()} เพลง`,
      `💰 ราคารวม: ${formatPrice(cartTotal())}`,
      "",
      "รบกวนแจ้งรายละเอียดการชำระเงินด้วยครับ"
    ].join("\n");
    const number = String(state.settings.whatsapp_number || "").replace(/[^0-9]/g, "");
    if (!number) {
      showToast("ร้านยังไม่ได้ตั้งค่าเบอร์ WhatsApp", "error");
      return;
    }
    // คงรายการในตะกร้าไว้หลังเปิด WhatsApp เพื่อให้ลูกค้าตรวจสอบการชำระเงินก่อน
    window.open(buildWhatsAppLink(number, text), "_blank");
  }

  function bindCartEvents() {
    document.getElementById("cartToggleBtn")?.addEventListener("click", openCart);
    document.getElementById("cartCloseBtn")?.addEventListener("click", closeCart);
    document.getElementById("cartBackdrop")?.addEventListener("click", event => {
      if (event.target === event.currentTarget) closeCart();
    });
    document.getElementById("cartItems")?.addEventListener("click", event => {
      const button = event.target.closest("button");
      if (!button) return;
      if (button.matches("[data-cart-continue]")) { closeCart(); return; }
      if (button.dataset.cartRemove) removeFromCart(button.dataset.cartRemove);
    });
    document.getElementById("clearCartBtn")?.addEventListener("click", () => {
      if (state.cart.length && window.confirm("ต้องการล้างเพลงทั้งหมดออกจากตะกร้าหรือไม่?")) {
        state.cart = [];
        saveCart();
        showToast("ล้างตะกร้าแล้ว", "success");
      }
    });
    document.getElementById("checkoutCartBtn")?.addEventListener("click", checkoutCart);
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
