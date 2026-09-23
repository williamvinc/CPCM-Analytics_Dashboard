# MooBoard Analytics Dashboard

Sales analytics dashboard for Cow Play Cow Moo — built with Next.js 16 and a FastAPI backend.

## Tech Stack

| Component | Technology |
|---|---|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS v4, shadcn/ui, Recharts |
| Backend | Python 3.11, FastAPI, Pandas |
| Auth | NextAuth v5 (JWT + credentials, bcryptjs) |
| Database | PostgreSQL (POS/bank data), SQLite via Prisma (user auth) |
| Cache | Redis 7 (gzip compressed, allkeys-lru, 2GB) |
| Reverse Proxy | Caddy (auto HTTPS, Let's Encrypt) |
| Deployment | Docker Compose |

---

## Features

- **Ticketing Report**: Gross Amount, Net Sales, Discount, Tax metrics with period comparison. Daily trend, category/source breakdown, payment methods pie chart, busiest days analysis.
- **POS vs Bank Reconciliation**: Daily comparison of POS gross sales vs BCA + BRI bank transactions.
- **F&B Report**: Revenue metrics, peak hours chart, Food vs Beverages split (% of total sales), top/bottom 10 items with "See all" view.
- **Machine Rate Tracker**: Upload Excel to analyze machine ticket out vs coin in rates.
- **Shared Filters**: Date range + multi-select outlet filter applied across all report sections.
- **Redis Caching**: 10-minute TTL, gzip compressed — cached requests respond in < 1s.

---

## Domain Setup (Caddy)

| Domain | Service |
|---|---|
| `mooboard.id` | Frontend (Next.js :3000) |
| `api.mooboard.id` | Backend (FastAPI :8000) |

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

### Services

- Frontend: `https://mooboard.id`
- Backend API: `https://api.mooboard.id`
- Redis: internal (port 6379, not exposed externally)

---

## Environment Variables (.env)

| Variable | Required | Description | Example |
|---|---|---|---|
| `AUTH_SECRET` | Yes | Secret key to sign NextAuth JWT tokens. | Generate via: `openssl rand -base64 32` |
| `AUTH_URL` | Yes | Public URL of the frontend (for NextAuth). | `https://mooboard.id` |
| `NEXT_PUBLIC_BACKEND_URL` | Yes | Backend URL accessed from the client browser. | `https://api.mooboard.id` |

---

## Local Development

### Frontend Setup

```bash
npm install
npx prisma db push
npm run dev
```
Frontend at `http://localhost:3000`.

### Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
Backend at `http://localhost:8000`.

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

Flush Redis cache:
```bash
docker exec cpcm-analytics_dashboard-redis-1 redis-cli FLUSHALL
```
