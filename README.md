# CPCM Analytics Dashboard

Sales analytics dashboard built with **Next.js 16** + **FastAPI** backend for data transformation.

## Tech Stack

| Component | Technology |
|---|---|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS v4, shadcn/ui, Recharts |
| Backend | Python 3.11, FastAPI, Pandas |
| Auth | NextAuth v5 (JWT + credentials) |
| Database | SQLite (via Prisma ORM) |
| Deployment | Docker Compose |

---

## 🚀 Deploy ke Server (Docker Compose)

### Kebutuhan Server

Yang perlu diinstall di server **hanya**:

- **Docker** (v20+)
- **Docker Compose** (v2+)
- **Git**

### Langkah Deploy

```bash
# 1. Clone repo
git clone https://github.com/williamvinc/CPCM-Analytics_Dashboard.git
cd CPCM-Analytics_Dashboard

# 2. Buat file .env dari template
cp .env.example .env

# 3. Edit .env (WAJIB)
nano .env

# 4. Build & jalankan
docker compose up -d --build

# 5. Cek status
docker compose ps
docker compose logs -f
```

### Akses

- **Frontend**: `http://110.239.80.161:3000`
- **Backend API**: `http://110.239.80.161:8000`

---

## ⚙️ Environment Variables (.env)

| Variable | Wajib? | Deskripsi | Contoh |
|---|---|---|---|
| `AUTH_SECRET` | ✅ **Ya** | Secret key untuk sign JWT token NextAuth. Tanpa ini, auth tidak aman di production. | Generate: `openssl rand -base64 32` |
| `NEXT_PUBLIC_BACKEND_URL` | ✅ **Ya** | URL backend **dari sisi browser** (bukan Docker internal). | `http://110.239.80.161:8000` |
| `SEED_USER_EMAIL` | Opsional | Email admin awal (default: `admin@cpcm.com`) | `admin@cpcm.com` |
| `SEED_USER_PASSWORD` | Opsional | Password admin awal (default: `admin123`) | `admin123` |
| `SEED_USER_NAME` | Opsional | Nama admin awal (default: `Admin`) | `Admin` |

### Kenapa AUTH_SECRET wajib?

NextAuth menggunakan `AUTH_SECRET` untuk **menandatangani (sign) JWT token**. Jika tidak diset:
- Di `auth.ts` ada fallback: `"super-secret-key-for-local-dev-only"` — ini **tidak aman** untuk production
- Siapapun yang tahu key ini bisa membuat token palsu

**Cara generate:**
```bash
openssl rand -base64 32
```

---

## 🛠️ Development (Lokal)

```bash
# Frontend
npm install
npx prisma db push
npm run dev          # http://localhost:3000

# Backend
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

---

## 📁 Struktur Docker

```
├── Dockerfile              # Multi-stage Next.js (deps → build → runner)
├── docker-compose.yml      # 2 services: frontend + backend
├── docker-entrypoint.sh    # Auto: prisma db push + seed admin user
├── .dockerignore
├── .env.example            # Template environment variables
├── backend/
│   ├── Dockerfile          # Python FastAPI image
│   ├── main.py             # Transformation API
│   └── requirements.txt
└── prisma/
    ├── schema.prisma       # User model (SQLite)
    └── seed.js             # Creates admin user on first run
```

## Docker Commands

```bash
# Rebuild setelah pull update
docker compose up -d --build

# Lihat logs
docker compose logs -f frontend
docker compose logs -f backend

# Restart
docker compose restart

# Stop semua
docker compose down

# Stop + hapus data (reset DB)
docker compose down -v
```
