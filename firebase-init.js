// ===================================================
// firebase-init.js — ตั้งค่ากลาง ใช้ร่วมกันทั้ง index.html และ admin.html
// ===================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyA6wfgjq7OwEIgOb3krxQdg1EFKiVcxX1o",
  authDomain: "musicbox-store.firebaseapp.com",
  projectId: "musicbox-store",
  storageBucket: "musicbox-store.firebasestorage.app",
  messagingSenderId: "435724064019",
  appId: "1:435724064019:web:51653bba1eaa82658576e6"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// ค่า Cloudinary (ใช้เก็บไฟล์เพลง/รูปภาพ แทน Firebase Storage)
export const CLOUDINARY_CLOUD_NAME = "g4nmb7ho";
export const CLOUDINARY_UPLOAD_PRESET = "music_store_unsigned";

// อัปโหลดไฟล์ใดๆ (เพลง/รูปภาพ) ขึ้น Cloudinary แบบ unsigned — คืนค่า URL ที่ใช้เล่น/แสดงได้ทันที
export async function uploadToCloudinary(file, onProgress) {
  return new Promise((resolve, reject) => {
    const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => {
      if (onProgress && e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && data.secure_url) {
          resolve({ url: data.secure_url, publicId: data.public_id });
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
}
