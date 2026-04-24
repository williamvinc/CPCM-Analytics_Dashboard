# MooBoard Dashboard — Backend

FastAPI backend for data transformation services.

## Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate   # Linux/Mac
pip install -r requirements.txt
```

## Run

```bash
uvicorn main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`.

## Endpoints

| Method | Path                     | Description                        |
|--------|--------------------------|------------------------------------|
| POST   | `/api/transform/sales`   | Transform SalesDetails Excel file  |
