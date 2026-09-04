// storage-adapter.js
// ===================================================
// ชั้นกลางสำหรับอัปโหลดไฟล์ (เพลง/รูปภาพ) — ทุกส่วนของแอปเรียกผ่านฟังก์ชันในไฟล์นี้
// แทนที่จะยิงไปหา Cloudinary ตรงๆ เพื่อให้สลับผู้ให้บริการ Storage ในอนาคต (เช่น Cloudflare R2)
// ได้โดยไม่ต้องแก้โค้ดฝั่ง admin/orders เลย
//
// วิธีย้ายไป R2 ในอนาคต:
//   1. Implement เมธอด upload() ใน R2Provider ด้านล่างให้ครบ (ต้องมี backend/Cloud Function
//      สร้าง presigned URL ให้ก่อน เพราะ R2 secret key ห้ามฝังในโค้ดฝั่ง browser)
//   2. เปลี่ยนค่า ACTIVE_PROVIDER เป็น "r2"
//   3. เสร็จ — โค้ดที่เหลือไม่ต้องแก้
// ===================================================
import { CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET } from "./firebase-init.js";

// ---------------- Cloudinary Provider (ใช้งานจริงตอนนี้) ----------------
const CloudinaryProvider = {
  name: "cloudinary",

  // folder: โฟลเดอร์ปลายทางใน Cloudinary
  // หมายเหตุ: ถ้า unsigned upload preset ตั้งค่า "Folder" เป็น Fixed/Disabled ไว้ พารามิเตอร์นี้จะถูกเมิน
  // และไฟล์จะถูกเก็บตาม path ที่ preset กำหนดแทน — เข้า Cloudinary Console > Upload presets เพื่อเช็ค/แก้ได้
  async upload(file, { folder = "" } = {}, onProgress) {
    return new Promise((resolve, reject) => {
      const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`;
      const formData = new FormData();
      formData.append("file", file);
      formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
      if (folder) formData.append("folder", folder);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.upload.onprogress = (e) => {
        if (onProgress && e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300 && data.secure_url) {
            resolve({ url: data.secure_url, publicId: data.public_id, provider: "cloudinary" });
          } else {
            reject(new Error(data.error ? data.error.message : "อัปโหลดไม่สำเร็จ"));
          }
        } catch (err) {
          reject(err);
        }
      };
      xhr.onerror = () => reject(new Error("เชื่อมต่อ Cloudinary ไม่สำเร็จ"));
      xhr.send(formData);
    });
  },
};

// ---------------- R2 Provider (เตรียมโครงไว้ — ยังไม่เปิดใช้งานจริง) ----------------
// ยังไม่ implement เพราะการอัปโหลดตรงจาก browser ไป R2 ต้องมี backend เซ็น (presign) request
// ให้ก่อนเสมอ — ไม่สามารถฝัง R2 Access Key/Secret ไว้ในโค้ดฝั่งเว็บได้
const R2Provider = {
  name: "r2",
  async upload() {
    throw new Error("R2Provider ยังไม่เปิดใช้งาน — ต้องตั้งค่า backend สำหรับสร้าง presigned URL ก่อนใช้งานจริง");
  },
};

const PROVIDERS = { cloudinary: CloudinaryProvider, r2: R2Provider };

// เปลี่ยนค่านี้เป็น "r2" ตอนพร้อมย้ายจริงในอนาคต (หลัง implement R2Provider ครบแล้ว)
const ACTIVE_PROVIDER = "cloudinary";

export function getStorageProvider() {
  return PROVIDERS[ACTIVE_PROVIDER];
}

// อัปโหลดไฟล์เพลงตัวอย่าง/รูปภาพ (ใช้ folder เดิม หรือไม่ระบุก็ได้) — คงพฤติกรรมเดิมไว้ทุกประการ
export async function uploadToStorage(file, onProgress, folder = "") {
  return getStorageProvider().upload(file, { folder }, onProgress);
}

// อัปโหลดไฟล์เพลงเต็ม WAV — เก็บแยกโฟลเดอร์ "full-songs" ไม่ปนกับไฟล์ตัวอย่างที่โชว์บนเว็บ user
// (โฟลเดอร์นี้ไม่ถูก reference จากหน้าเว็บ user เลย ใช้เฉพาะฝั่ง Admin เท่านั้น)
export async function uploadFullSong(file, onProgress) {
  return getStorageProvider().upload(file, { folder: "full-songs" }, onProgress);
}

// อัปโหลด ZIP ที่ระบบสร้างจากไฟล์ WAV เต็มของออเดอร์
// แยกโฟลเดอร์จากไฟล์เพลงเดิม เพื่อไม่กระทบลิงก์/ข้อมูลเพลงที่มีอยู่แล้ว
export async function uploadOrderZip(file, onProgress) {
  return getStorageProvider().upload(file, { folder: "order-zips" }, onProgress);
}
