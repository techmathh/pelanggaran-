# Panduan Pemisahan Frontend & Backend SiPiket OSIS (Anti Hilang Data Saat Redeploy)

Memisahkan **Frontend** (tampilan website) dan **Backend** (API + Database SQLite) membuat:
1. **Update tampilan / Frontend tidak merestart Backend maupun menyentuh database.**
2. **Data di Backend aman 100% saat redeploy** karena tersimpan di **Railway Persistent Volume (`/data/sipiket.db`)** dan otomatis melakukan `WAL checkpoint` saat container berhenti.

---

## Arsitektur 2 Service Terpisah di Railway (1 Repo GitHub)

Buat **2 Service** di dalam 1 Project Railway dari repository yang sama:

### 1. Service Backend (`sipiket-backend`)
- **Config File (opsional)** atau atur di *Service Settings*:
  - **Build Command**: `npm install` *(lihat `railway.backend.json`)*
  - **Start Command**: `npm run start:backend`
  - **Healthcheck Path**: `/api/health`
- **WAJIB — Pasang Persistent Volume agar data TIDAK hilang saat redeploy:**
  1. Buka Service Backend -> tab **Volumes** -> **Add Volume**.
  2. Isi **Mount Path**: `/data`
  3. Di tab **Variables**, tambahkan:
     - `NODE_ENV=production`
     - `BACKEND_ONLY=true`
     - `DATA_DIR=/data` *(sistem juga otomatis membaca `RAILWAY_VOLUME_MOUNT_PATH` dari Railway)*
     - `ALLOWED_ORIGINS=https://NAMA-DOMAIN-FRONTEND.up.railway.app`
     - `SESSION_SECRET=isi-kode-rahasia-panjang-acak`
  4. Generate domain publik untuk Backend (misal: `https://sipiket-backend.up.railway.app`).
  5. Cek `/api/health`: pastikan muncul `"volumeMounted": true` dan `"persistence": "volume"`.

---

### 2. Service Frontend (`sipiket-frontend`)
- **Config File (opsional)** atau atur di *Service Settings*:
  - **Build Command**: `npm run build:frontend` *(lihat `railway.frontend.json`)*
  - **Start Command**: `npm run start:frontend`
  - **Healthcheck Path**: `/healthz`
- Di tab **Variables**, tambahkan:
  - `API_BASE_URL=https://sipiket-backend.up.railway.app`
  - `VITE_API_BASE_URL=https://sipiket-backend.up.railway.app`
- Generate domain publik untuk Frontend (misal: `https://sipiket-frontend.up.railway.app`), lalu pastikan domain tersebut sudah dimasukkan ke `ALLOWED_ORIGINS` pada Service Backend.

> **Catatan:** Service Frontend (`frontend-server.ts`) menyuntikkan `API_BASE_URL` secara dinamis lewat `/env-config.js`, sehingga jika URL Backend berubah, cukup ubah Variable & restart Frontend tanpa perlu memengaruhi Backend.

---

## Alternatif: Frontend di Vercel / Cloudflare Pages + Backend di Railway
Jika suatu saat ingin menaruh Frontend di Vercel/Cloudflare Pages:
- **Build Command**: `npm run build:frontend`
- **Output Directory**: `dist`
- **Environment Variable**: `VITE_API_BASE_URL=https://sipiket-backend.up.railway.app`
- Pastikan domain Vercel/Cloudflare ditambahkan ke `ALLOWED_ORIGINS` di Railway Backend.
