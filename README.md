# CPCM Analytics Dashboard

Sales analytics dashboard built with Next.js 16 and a FastAPI backend for data transformation.

## Tech Stack

| Component | Technology |
|---|---|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS v4, shadcn/ui, Recharts |
| Backend | Python 3.11, FastAPI, Pandas |
| Auth | NextAuth v5 (JWT + credentials) |
| Database | SQLite (via Prisma ORM) |
| Deployment | Docker Compose |

---

## Features Usage

- **Machine Rate Tracker**: Upload primary Excel data containing machine inputs and ticket outputs to view analytics. Optionally upload a secondary Card/Ticket Leak Excel file using the "Ticket Machine & Card" tab to right-join data by Machine Name and evaluate the overall adjusted Rate `(Ticket Out + Ticket Leak) / Coin In`.

---

## Deployment (Docker Compose)

### Server Requirements

- Docker (v20+)
- Docker Compose (v2+)
- Git

### Deployment Steps

1. Clone the repository
```bash
git clone https://github.com/williamvinc/CPCM-Analytics_Dashboard.git
cd CPCM-Analytics_Dashboard
```

2. Create environment variables
```bash
cp .env.example .env
nano .env
```

3. Build and run containers
```bash
docker compose up -d --build
```

4. Check logs
```bash
docker compose logs -f
```

### Accessing the App

- Frontend: `http://<SERVER_IP>:3000`
- Backend API: `http://<SERVER_IP>:8000`

---

## Environment Variables (.env)

| Variable | Required | Description | Example |
|---|---|---|---|
| `AUTH_SECRET` | Yes | Secret key to sign NextAuth JWT tokens. | Generate via: `openssl rand -base64 32` |
| `NEXT_PUBLIC_BACKEND_URL` | Yes | Backend URL accessed from the client browser. | `http://110.239.80.161:8000` |
| `SEED_USER_EMAIL` | No | Initial admin email (default: admin@cpcm.com). | `admin@cpcm.com` |
| `SEED_USER_PASSWORD` | No | Initial admin password (default: admin123). | `admin123` |
| `SEED_USER_NAME` | No | Initial admin name (default: Admin). | `Admin` |

### Note on AUTH_SECRET
NextAuth relies on `AUTH_SECRET` to sign JWT tokens. A fallback is temporarily hardcoded for local development, but deploying without a strong secret compromises authentication. Always generate a random 32-character string for production use.

---

## Local Development

### Frontend Setup

```bash
npm install
npx prisma db push
npm run dev
```
The frontend will be available at `http://localhost:3000`.

### Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install fastapi uvicorn pandas openpyxl python-multipart
uvicorn main:app --reload --port 8000
```
The backend will run on `http://127.0.0.1:8000`.

---

## Docker Maintenance

Rebuild after pulling updates:
```bash
docker compose up -d --build
```

Restart services:
```bash
docker compose restart
```

Stop all containers:
```bash
docker compose down
```

Stop and reset database volume:
```bash
docker compose down -v
```
