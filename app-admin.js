// ===================================================
// app-admin.js — หน้า Admin: Login (Firebase Auth) + CRUD (Firestore) + อัปโหลดไฟล์ (Cloudinary)
// ===================================================
import { db, auth, uploadToCloudinary } from "./firebase-init.js";
import {
  collection, addDoc, updateDoc, deleteDoc, doc, getDocs, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const CACHE = { songs: [], categories: [], djs: [] };
let editingSongId = null, editingCatId = null, editingDjId = null;
let pendingSongFile = null, pendingCoverFile = null, pendingDjImageFile = null, existingDjImageUrl = "";
let confirmAction = null;

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
function formatPrice(v) { return Number(v || 0).toLocaleString("th-TH") + " บาท"; }
function debounce(fn, wait) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), wait); }; }

// ---------------- Auth ----------------
onAuthStateChanged(auth, (user) => {
  if (user) showAdmin(); else showLogin();
});

document.getElementById("loginBtn").addEventListener("click", async () => {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  document.getElementById("loginError").textContent = "";
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    document.getElementById("loginError").textContent = "เข้าสู่ระบบไม่สำเร็จ: อีเมลหรือรหัสผ่านไม่ถูกต้อง";
  }
});
document.getElementById("logoutBtn").addEventListener("click", () => signOut(auth));

function showLogin() { document.getElementById("loginScreen").style.display = "flex"; document.getElementById("adminShell").style.display = "none"; }
async function showAdmin() {
  document.getElementById("loginScreen").style.display = "none";
  document.getElementById("adminShell").style.display = "block";
  const s = await getDoc(doc(db, "settings", "main"));
  if (s.exists()) document.getElementById("adminSiteName").textContent = s.data().website_name || "Music Store";
  loadDashboard();
}

// ---------------- View switching ----------------
function showView(id) {
  document.querySelectorAll(".view").forEach(v => v.style.display = "none");
  document.getElementById(id).style.display = "block";
}
document.querySelectorAll(".back-btn").forEach(b => b.addEventListener("click", () => { showView("view-dashboard"); loadDashboard(); }));
document.getElementById("qaAddSong").addEventListener("click", async () => { showView("view-songs"); await loadSongs(); openAddSong(); });
document.getElementById("qaManageSongs").addEventListener("click", () => { showView("view-songs"); loadSongs(); });
document.getElementById("qaManageCats").addEventListener("click", () => { showView("view-categories"); loadCategories(); });
document.getElementById("qaManageDjs").addEventListener("click", () => { showView("view-djs"); loadDjs(); });
document.getElementById("qaSettings").addEventListener("click", () => { showView("view-settings"); loadSettings(); });

async function loadDashboard() {
  const [songsSnap, catSnap, djSnap] = await Promise.all([
    getDocs(collection(db, "songs")), getDocs(collection(db, "categories")), getDocs(collection(db, "djs"))
  ]);
  document.getElementById("statSongs").textContent = songsSnap.size;
  document.getElementById("statCats").textContent = catSnap.size;
  document.getElementById("statDjs").textContent = djSnap.size;
}

// ================= SONGS =================
async function loadSongs() {
  const [songsSnap, catSnap, djSnap] = await Promise.all([
    getDocs(collection(db, "songs")), getDocs(collection(db, "categories")), getDocs(collection(db, "djs"))
  ]);
  CACHE.songs = songsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  CACHE.categories = catSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  CACHE.djs = djSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  populateSelect("fCategory", CACHE.categories, "id", "category_name");
  populateSelect("fDj", CACHE.djs, "id", "dj_name");
  renderSongList(CACHE.songs);
}
function populateSelect(id, items, valueKey, labelKey) {
  const sel = document.getElementById(id);
  const current = sel.value;
  sel.innerHTML = '<option value="">— ไม่ระบุ —</option>' + items.map(it => `<option value="${it[valueKey]}">${escapeHtml(it[labelKey])}</option>`).join("");
  sel.value = current;
}
function renderSongList(list) {
  const wrap = document.getElementById("songList");
  if (list.length === 0) { wrap.innerHTML = '<div class="empty-state">ยังไม่มีเพลง</div>'; return; }
  wrap.innerHTML = list.map(s => `
    <div class="list-row">
      <img src="${s.cover_url || ""}">
      <div class="info"><div class="n1">${escapeHtml(s.song_name)}</div>
      <div class="n2">${escapeHtml(s.dj_name || "-")} · ${escapeHtml(s.category_name || "-")} · ${formatPrice(s.price)}</div></div>
      <div class="row-actions">
        <button class="icon-btn" data-edit="${s.id}">✎</button>
        <button class="icon-btn danger" data-del="${s.id}">🗑</button>
      </div>
    </div>`).join("");
  wrap.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => openEditSong(b.getAttribute("data-edit"))));
  wrap.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => confirmDeleteSong(b.getAttribute("data-del"))));
}
document.getElementById("songSearch").addEventListener("input", debounce((e) => {
  const q = e.target.value.trim().toLowerCase();
  renderSongList(CACHE.songs.filter(s => [s.song_name, s.artist, s.dj_name, s.category_name].join(" ").toLowerCase().includes(q)));
}, 200));

function resetSongForm() {
  editingSongId = null; pendingSongFile = null; pendingCoverFile = null;
  document.getElementById("songFormTitle").textContent = "เพิ่มเพลง";
  ["fSongName", "fArtist", "fPrice", "fDesc"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("fDj").value = ""; document.getElementById("fCategory").value = ""; document.getElementById("fStatus").value = "active";
  document.getElementById("songFileInput").value = ""; document.getElementById("coverFileInput").value = "";
  document.getElementById("songFilePicker").textContent = "📁 แตะเพื่อเลือกไฟล์เพลงจาก iPhone/iPad";
  document.getElementById("songFilePicker").className = "file-picker";
  document.getElementById("coverFilePicker").textContent = "🖼️ แตะเพื่อเลือกรูปปก";
  document.getElementById("coverFilePicker").className = "file-picker";
  document.getElementById("songUploadProgressWrap").style.display = "none";
}
function openAddSong() { resetSongForm(); document.getElementById("songFormBackdrop").classList.add("show"); }
function openEditSong(id) {
  resetSongForm();
  const s = CACHE.songs.find(x => x.id === id);
  if (!s) return;
  editingSongId = id;
  document.getElementById("songFormTitle").textContent = "แก้ไขเพลง";
  document.getElementById("fSongName").value = s.song_name || "";
  document.getElementById("fArtist").value = s.artist || "";
  document.getElementById("fPrice").value = s.price || 0;
  document.getElementById("fDesc").value = s.description || "";
  document.getElementById("fStatus").value = s.status || "active";
  const dj = CACHE.djs.find(d => d.dj_name === s.dj_name);
  document.getElementById("fDj").value = dj ? dj.id : "";
  document.getElementById("fCategory").value = s.category_id || "";
  if (s.file_url) { document.getElementById("songFilePicker").textContent = "✔ มีไฟล์เพลงอยู่แล้ว (ไม่บังคับอัปโหลดใหม่)"; document.getElementById("songFilePicker").className = "file-picker filled"; }
  if (s.cover_url) { document.getElementById("coverFilePicker").textContent = "✔ มีรูปปกอยู่แล้ว"; document.getElementById("coverFilePicker").className = "file-picker filled"; }
  document.getElementById("songFormBackdrop").classList.add("show");
}
document.getElementById("addSongBtn").addEventListener("click", openAddSong);
document.getElementById("songFormClose").addEventListener("click", () => document.getElementById("songFormBackdrop").classList.remove("show"));

document.getElementById("songFileInput").addEventListener("change", (e) => {
  const f = e.target.files[0]; if (!f) return;
  pendingSongFile = f;
  document.getElementById("songFilePicker").textContent = "🎵 " + f.name;
  document.getElementById("songFilePicker").className = "file-picker filled";
});
document.getElementById("coverFileInput").addEventListener("change", (e) => {
  const f = e.target.files[0]; if (!f) return;
  pendingCoverFile = f;
  document.getElementById("coverFilePicker").textContent = "🖼️ " + f.name;
  document.getElementById("coverFilePicker").className = "file-picker filled";
});

document.getElementById("songSaveBtn").addEventListener("click", async function () {
  const name = document.getElementById("fSongName").value.trim();
  if (!name) { showToast("กรุณากรอกชื่อเพลง", "error"); return; }
  const btn = this; btn.disabled = true; btn.textContent = "กำลังบันทึก...";
  try {
    let fileUrl = null, coverUrl = null;
    if (pendingSongFile) {
      document.getElementById("songUploadProgressWrap").style.display = "block";
      const prog = document.getElementById("songUploadProgress");
      const res = await uploadToCloudinary(pendingSongFile, (pct) => { prog.style.width = pct + "%"; });
      fileUrl = res.url;
    }
    if (pendingCoverFile) {
      const res = await uploadToCloudinary(pendingCoverFile);
      coverUrl = res.url;
    }
    const djSel = document.getElementById("fDj");
    const catSel = document.getElementById("fCategory");
    const payload = {
      song_name: name,
      artist: document.getElementById("fArtist").value.trim(),
      dj_name: djSel.value ? djSel.options[djSel.selectedIndex].text : "",
      category_id: catSel.value,
      category_name: catSel.value ? catSel.options[catSel.selectedIndex].text : "",
      price: Number(document.getElementById("fPrice").value || 0),
      description: document.getElementById("fDesc").value.trim(),
      status: document.getElementById("fStatus").value,
      updated_at: new Date().toISOString()
    };
    if (fileUrl) payload.file_url = fileUrl;
    if (coverUrl) payload.cover_url = coverUrl;

    if (editingSongId) {
      await updateDoc(doc(db, "songs", editingSongId), payload);
    } else {
      payload.created_at = new Date().toISOString();
      await addDoc(collection(db, "songs"), payload);
    }
    showToast("บันทึกเพลงสำเร็จ", "success");
    document.getElementById("songFormBackdrop").classList.remove("show");
    loadSongs();
  } catch (err) {
    showToast("บันทึกไม่สำเร็จ: " + err.message, "error");
  }
  btn.disabled = false; btn.textContent = "บันทึกเพลง";
});

function confirmDeleteSong(id) {
  openConfirm("คุณต้องการลบเพลงนี้หรือไม่?", async () => {
    await deleteDoc(doc(db, "songs", id));
    showToast("ลบเพลงแล้ว", "success");
    loadSongs();
  });
}

// ================= CATEGORIES =================
async function loadCategories() {
  const snap = await getDocs(collection(db, "categories"));
  CACHE.categories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const wrap = document.getElementById("catList");
  if (CACHE.categories.length === 0) { wrap.innerHTML = '<div class="empty-state">ยังไม่มีหมวดหมู่</div>'; return; }
  wrap.innerHTML = CACHE.categories.map(c => `
    <div class="list-row"><div class="info"><div class="n1">${escapeHtml(c.category_name)}</div>
    <div class="n2">${escapeHtml(c.description || "")}</div></div>
    <div class="row-actions"><button class="icon-btn" data-edit="${c.id}">✎</button>
    <button class="icon-btn danger" data-del="${c.id}">🗑</button></div></div>`).join("");
  wrap.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => openEditCat(b.getAttribute("data-edit"))));
  wrap.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => {
    openConfirm("ลบหมวดหมู่นี้หรือไม่?", async () => {
      await deleteDoc(doc(db, "categories", b.getAttribute("data-del")));
      showToast("ลบแล้ว", "success"); loadCategories();
    });
  }));
}
function openAddCat() { editingCatId = null; document.getElementById("catFormTitle").textContent = "เพิ่มหมวดหมู่"; document.getElementById("fCatName").value = ""; document.getElementById("fCatDesc").value = ""; document.getElementById("catFormBackdrop").classList.add("show"); }
function openEditCat(id) {
  const c = CACHE.categories.find(x => x.id === id); if (!c) return;
  editingCatId = id; document.getElementById("catFormTitle").textContent = "แก้ไขหมวดหมู่";
  document.getElementById("fCatName").value = c.category_name; document.getElementById("fCatDesc").value = c.description || "";
  document.getElementById("catFormBackdrop").classList.add("show");
}
document.getElementById("addCatBtn").addEventListener("click", openAddCat);
document.getElementById("catFormClose").addEventListener("click", () => document.getElementById("catFormBackdrop").classList.remove("show"));
document.getElementById("catSaveBtn").addEventListener("click", async () => {
  const name = document.getElementById("fCatName").value.trim();
  if (!name) { showToast("กรุณากรอกชื่อหมวดหมู่", "error"); return; }
  const payload = { category_name: name, description: document.getElementById("fCatDesc").value.trim() };
  try {
    if (editingCatId) await updateDoc(doc(db, "categories", editingCatId), payload);
    else { payload.created_at = new Date().toISOString(); await addDoc(collection(db, "categories"), payload); }
    showToast("บันทึกแล้ว", "success"); document.getElementById("catFormBackdrop").classList.remove("show"); loadCategories();
  } catch (err) { showToast("บันทึกไม่สำเร็จ: " + err.message, "error"); }
});

// ================= DJs =================
async function loadDjs() {
  const snap = await getDocs(collection(db, "djs"));
  CACHE.djs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const wrap = document.getElementById("djList");
  if (CACHE.djs.length === 0) { wrap.innerHTML = '<div class="empty-state">ยังไม่มี DJ</div>'; return; }
  wrap.innerHTML = CACHE.djs.map(d => `
    <div class="list-row"><img src="${d.image_url || ""}">
    <div class="info"><div class="n1">${escapeHtml(d.dj_name)}</div><div class="n2">${escapeHtml(d.description || "")}</div></div>
    <div class="row-actions"><button class="icon-btn" data-edit="${d.id}">✎</button>
    <button class="icon-btn danger" data-del="${d.id}">🗑</button></div></div>`).join("");
  wrap.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => openEditDj(b.getAttribute("data-edit"))));
  wrap.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => {
    openConfirm("ลบ DJ นี้หรือไม่?", async () => {
      await deleteDoc(doc(db, "djs", b.getAttribute("data-del")));
      showToast("ลบแล้ว", "success"); loadDjs();
    });
  }));
}
function resetDjForm() {
  editingDjId = null; pendingDjImageFile = null; existingDjImageUrl = "";
  document.getElementById("fDjName").value = ""; document.getElementById("fDjDesc").value = "";
  document.getElementById("djImageInput").value = "";
  document.getElementById("djImagePicker").textContent = "🖼️ แตะเพื่อเลือกรูปจาก iPhone/iPad";
  document.getElementById("djImagePicker").className = "file-picker";
}
function openAddDj() { resetDjForm(); document.getElementById("djFormTitle").textContent = "เพิ่ม DJ"; document.getElementById("djFormBackdrop").classList.add("show"); }
function openEditDj(id) {
  const d = CACHE.djs.find(x => x.id === id); if (!d) return;
  resetDjForm();
  editingDjId = id; existingDjImageUrl = d.image_url || "";
  document.getElementById("djFormTitle").textContent = "แก้ไข DJ";
  document.getElementById("fDjName").value = d.dj_name; document.getElementById("fDjDesc").value = d.description || "";
  if (existingDjImageUrl) { document.getElementById("djImagePicker").textContent = "✔ มีรูปอยู่แล้ว (แตะเพื่อเปลี่ยนรูปใหม่)"; document.getElementById("djImagePicker").className = "file-picker filled"; }
  document.getElementById("djFormBackdrop").classList.add("show");
}
document.getElementById("addDjBtn").addEventListener("click", openAddDj);
document.getElementById("djFormClose").addEventListener("click", () => document.getElementById("djFormBackdrop").classList.remove("show"));
document.getElementById("djImageInput").addEventListener("change", (e) => {
  const f = e.target.files[0]; if (!f) return;
  pendingDjImageFile = f;
  document.getElementById("djImagePicker").textContent = "🖼️ " + f.name;
  document.getElementById("djImagePicker").className = "file-picker filled";
});
document.getElementById("djSaveBtn").addEventListener("click", async function () {
  const name = document.getElementById("fDjName").value.trim();
  if (!name) { showToast("กรุณากรอกชื่อ DJ", "error"); return; }
  const btn = this; btn.disabled = true; btn.textContent = "กำลังบันทึก...";
  try {
    let imageUrl = existingDjImageUrl;
    if (pendingDjImageFile) {
      const res = await uploadToCloudinary(pendingDjImageFile);
      imageUrl = res.url;
    }
    const payload = { dj_name: name, description: document.getElementById("fDjDesc").value.trim(), image_url: imageUrl };
    if (editingDjId) await updateDoc(doc(db, "djs", editingDjId), payload);
    else { payload.created_at = new Date().toISOString(); await addDoc(collection(db, "djs"), payload); }
    showToast("บันทึกแล้ว", "success"); document.getElementById("djFormBackdrop").classList.remove("show"); loadDjs();
  } catch (err) {
    showToast("บันทึกไม่สำเร็จ: " + err.message, "error");
  }
  btn.disabled = false; btn.textContent = "บันทึก";
});

// ================= SETTINGS =================
async function loadSettings() {
  const snap = await getDoc(doc(db, "settings", "main"));
  const s = snap.exists() ? snap.data() : {};
  document.getElementById("setWebsiteName").value = s.website_name || "";
  document.getElementById("setAdminName").value = s.admin_name || "";
  document.getElementById("setWhatsapp").value = s.whatsapp_number || "";
  document.getElementById("setLogo").value = s.website_logo || "";
}
document.getElementById("saveSettingsBtn").addEventListener("click", async () => {
  const payload = {
    website_name: document.getElementById("setWebsiteName").value.trim(),
    admin_name: document.getElementById("setAdminName").value.trim(),
    whatsapp_number: document.getElementById("setWhatsapp").value.trim(),
    website_logo: document.getElementById("setLogo").value.trim()
  };
  try {
    await setDoc(doc(db, "settings", "main"), payload, { merge: true });
    showToast("บันทึกการตั้งค่าแล้ว", "success");
  } catch (err) {
    showToast("บันทึกไม่สำเร็จ: " + err.message, "error");
  }
});

// ================= Confirm modal =================
function openConfirm(text, onOk) {
  document.getElementById("confirmText").textContent = text;
  confirmAction = onOk;
  document.getElementById("confirmBackdrop").classList.add("show");
}
document.getElementById("confirmCancel").addEventListener("click", () => document.getElementById("confirmBackdrop").classList.remove("show"));
document.getElementById("confirmOk").addEventListener("click", async () => {
  document.getElementById("confirmBackdrop").classList.remove("show");
  if (confirmAction) await confirmAction();
});
