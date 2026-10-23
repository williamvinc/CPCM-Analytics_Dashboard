import os
import json
import hashlib
import gzip
import pandas as pd
import re
import io
import base64
import math
import psycopg2
import redis
import logging
from typing import List, Optional
from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

logger = logging.getLogger("cpcm-dashboard")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
redis_client = redis.from_url(REDIS_URL, decode_responses=False)
CACHE_TTL = 600  # 10 minutes

def cache_key(*args) -> str:
    raw = json.dumps(args, sort_keys=True)
    return f"mooboard:{hashlib.md5(raw.encode()).hexdigest()}"

def get_cached(key: str):
    data = redis_client.get(key)
    if data:
        return json.loads(gzip.decompress(data))
    return None

def set_cached(key: str, value):
    try:
        compressed = gzip.compress(json.dumps(value, default=str).encode())
        redis_client.setex(key, CACHE_TTL, compressed)
    except Exception:
        pass

DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = int(os.getenv("DB_PORT", "41828"))
DB_NAME = os.getenv("DB_NAME", "mooboard")
DB_USER = os.getenv("DB_USER", "mooboard")
DB_PASSWORD = os.getenv("DB_PASSWORD", "MooBoard123!")


# ==== Sumber Nusapay: POS vs tabel nusapay_transactions ====
# Selama periode di NUSAPAY_DARI_TABEL, angka Nusapay diambil dari tabel
# nusapay_transactions (hasil ingest file merchant), bukan dari tender POS.
# Format: "YYYY-MM-DD:YYYY-MM-DD[,YYYY-MM-DD:YYYY-MM-DD]".
# Kosongkan untuk kembali sepenuhnya ke POS (rollback), lalu:
#   docker compose up -d backend
NUSAPAY_DARI_TABEL = os.getenv("NUSAPAY_DARI_TABEL", "")

# Segmen di nusapay_transactions untuk tiap outlet & blok laporan.
# walkin CPP = None: tidak ada merchant walk-in CPP di file merchant.
NUSAPAY_SEGMEN = {
    'OUTLET01-Park Nickelodeon': {'cafe': 'SNP Café', 'activity': 'SNP Activity', 'walkin': 'SNP Walk In'},
    'OUTLET02-Nickelodeon Theme Park Carstensz Mall': {'cafe': 'CPP Café', 'activity': 'CPP Activity', 'walkin': None},
}


def _periode_nusapay_tabel():
    """Parse NUSAPAY_DARI_TABEL jadi [(date_from, date_to), ...]."""
    periode = []
    for bagian in NUSAPAY_DARI_TABEL.split(','):
        bagian = bagian.strip()
        if not bagian:
            continue
        try:
            mulai, selesai = bagian.split(':')
            periode.append((pd.Timestamp(mulai.strip()).date(),
                            pd.Timestamp(selesai.strip()).date()))
        except ValueError:
            logger.warning("NUSAPAY_DARI_TABEL: bagian dilewati (format salah): %r", bagian)
    return periode


def _tanggal_override_nusapay(start_date, end_date):
    """Tanggal dalam [start_date, end_date] yang Nusapay-nya diambil dari tabel."""
    if not NUSAPAY_DARI_TABEL:
        return set()
    req_mulai = pd.Timestamp(start_date).date()
    req_selesai = pd.Timestamp(end_date).date()
    tanggal = set()
    for mulai, selesai in _periode_nusapay_tabel():
        irisan_mulai = max(mulai, req_mulai)
        irisan_selesai = min(selesai, req_selesai)
        if irisan_mulai > irisan_selesai:
            continue
        tanggal.update(pd.date_range(irisan_mulai, irisan_selesai).date)
    return tanggal


def _nusapay_tabel_per_tanggal(conn, segmen, tanggal):
    """Nusapay per tanggal dari nusapay_transactions untuk satu segmen.

    pay_amount dipakai karena itu nilai bruto yang dibayar customer - setara
    gross_sales_all_incl di POS. Kolom mra sudah dipotong MDR 0,7%.
    """
    if not segmen or not tanggal:
        return {}
    query = """
        SELECT trx_date, SUM(pay_amount) AS nusapay
        FROM nusapay_transactions
        WHERE segmen = %s AND trx_date >= %s AND trx_date <= %s
        GROUP BY trx_date
    """
    df = pd.read_sql(query, conn, params=[segmen, min(tanggal), max(tanggal)])
    hasil = {}
    for _, row in df.iterrows():
        tgl = pd.Timestamp(row['trx_date']).date()
        if tgl in tanggal:
            hasil[tgl] = float(row['nusapay'] or 0)
    return hasil


def ganti_nusapay(df, conn, pemetaan, start_date, end_date,
                  kolom_store=None, kolom_nilai='nusapay'):
    """Ambil Nusapay periode NUSAPAY_DARI_TABEL dari tabel, bukan dari POS.

    df          : DataFrame hasil query POS (kolom 'date' + kolom_nilai)
    pemetaan    : [(label_store, segmen), ...]. label_store None berarti seluruh
                  df milik satu outlet (dipakai di dalam loop per-outlet).
                  segmen None berarti tidak ada padanannya di tabel -> jadi 0.
    kolom_store : kolom penanda outlet di df (None kalau df per-outlet)

    Kalau NUSAPAY_DARI_TABEL kosong, atau tabelnya belum ada / query gagal, df
    dikembalikan apa adanya sehingga report tetap jalan dengan angka POS.
    """
    tanggal = _tanggal_override_nusapay(start_date, end_date)
    if not tanggal or 'date' not in df.columns:
        return df

    # Ambil dulu semua angka dari tabel. Kalau gagal, df belum tersentuh sama
    # sekali sehingga report tetap memakai angka POS.
    nilai_tabel = {}
    try:
        for label_store, segmen in pemetaan:
            nilai_tabel[label_store] = _nusapay_tabel_per_tanggal(conn, segmen, tanggal)
    except Exception as exc:
        logger.warning("Nusapay dari nusapay_transactions gagal, pakai POS: %s", exc)
        return df

    df = df.copy()
    df['date'] = pd.to_datetime(df['date'])

    baris_tabel = []
    for label_store, segmen in pemetaan:
        if kolom_store is None:
            buang = df['date'].dt.date.isin(tanggal)
        else:
            buang = df['date'].dt.date.isin(tanggal) & (df[kolom_store] == label_store)
        df = df[~buang]

        for tgl, nilai in nilai_tabel[label_store].items():
            baris = {'date': pd.Timestamp(tgl), kolom_nilai: nilai}
            if kolom_store is not None:
                baris[kolom_store] = label_store
            baris_tabel.append(baris)

    if baris_tabel:
        df = pd.concat([df, pd.DataFrame(baris_tabel)], ignore_index=True)
    return df


def fnb_bucket_clause(cats: tuple, legacy_cats: tuple = ()) -> tuple:
    """SQL filter + params untuk satu bucket F&B (Food / Beverage / Packaging).

    Sejak September 2026 export POS menaruh jenis produk di kolom category_2,
    sedangkan kolom category berubah jadi mode penjualan (DINE-IN, TAKEAWAY,
    PACKAGING, ...). Data sebelum September masih memakai nama category lama,
    dan baris lama itu category_2-nya NULL - jadi dipakai sebagai pembeda.
    """
    if legacy_cats:
        return (
            "(category_2 = ANY(%s) OR (category_2 IS NULL AND category = ANY(%s)))",
            [list(cats), list(legacy_cats)],
        )
    return ("category_2 = ANY(%s)", [list(cats)])


# Bucket F&B per outlet (sumber: List Item Category dari Finance, September 2026).
# food_cats/bev_cats/pkg_cats -> nama di kolom category_2 (format baru).
# legacy_*_cats               -> nama di kolom category (format lama, category_2 NULL).
FNB_BUCKETS = {
    'OUTLET01-Park Nickelodeon': {
        'name': 'Garfield Café',
        'food_cats': (
            '01-Appetizers & Snacks',
            '02-Main Course',
            '03-Pizza',
            '04-Sides',
            '05-Dessert',
            '06-Other',
            'GSNP001-Gelato',
            'FOOD-GARFIELD-FOOD GARFIELD',
            'FOOD-GARFIELD-FOOD-GARFIELD',
            'FOOD-PORTERS-FOOD-PORTERS',
            'PACKAGE-FOOD PACKAGE',
            'TKA-GRF-Take Away',
        ),
        'bev_cats': (
            '01-Hot',
            '02-Cold',
            'BEV-GARFIELD-BEVERAGES GARFIELD',
        ),
        'pkg_cats': (
            'TAKEAWAY-PACKAGING',
            'PACKAGING-Packaging',
        ),
        'legacy_food_cats': ('03-Food',),
        'legacy_bev_cats': ('04-Beverages',),
    },
    'OUTLET02-Nickelodeon Theme Park Carstensz Mall': {
        'name': 'Mr. Porter Café Carstensz',
        'food_cats': (
            'FC0102-Pizza selection (C)',
            'FC0103-Main',
            'FC0104-Kids Menu',
            'FC0105-PAWSOME SNACK BREAK',
            'FC0108-Takeaway',
            'FC0106-Dessert (C)',
            'FC0101-Starter (C)',
            'FC0109-Birthday Package (C)',
            "FOOD-PORTERS-FOOD PORTER'S",
            'TKA-GRF-Take Away',
        ),
        'bev_cats': (
            'BC0101-Coffee (C)',
            'BC0102-Tea (C)',
            'BC0103-Soothies (C)',
            'BC0104-Milkbased (C)',
            'BC0105-Frappe (C)',
            'BC0106-Refresher (C)',
            'BC0107-Add-On',
            'BEV-PORTERS-BEVERAGES PORTERS',
        ),
        'pkg_cats': (
            'TAKEAWAY-PACKAGING',
            'PACKAGING-Packaging',
        ),
        'legacy_food_cats': ('FC01-Food (C)',),
        'legacy_bev_cats': ('BC01-Beverages (C)',),
    },
}

# Semua kategori F&B satu outlet (Food + Beverage + Packaging) untuk format baru.
ALL_FNB_CATS = {
    key: tuple(b['food_cats']) + tuple(b['bev_cats']) + tuple(b['pkg_cats'])
    for key, b in FNB_BUCKETS.items()
}

# Format laporan F&B berganti mulai September 2026 (Category 2 + kolom Packaging).
# - Periode sebelum 2026-09-01  -> sheet 'Cafe Sales Report', 20 kolom (Food & Beverage).
# - Periode 2026-09-01 ke atas  -> sheet 'FNB New Report', 25 kolom (+ Packaging, + BNI).
# Batasnya dipakai pada end_date: periode yang melewati September memakai format baru.
FNB_NEW_FORMAT_START = '2026-09-01'

# Posisi kolom layout lama (21 kolom) di dalam layout baru (25 kolom).
# Layout baru: 0 Date, 1 Store, 2 Platform, 3-5 Gross Excl (F/B/P), 6-8 Discount (F/B/P),
# 9-11 Net Sales (F/B/P), 12-14 Service Charge (F/B/P), 15 Tax, 16 Gross Sales (All incl),
# 17 BRI, 18 BCA, 19 BNI, 20 Nusapay, 21 Deposit, 22 Voucher, 23 Total, 24 Diff.
CAFE_OLD_COLUMNS = (0, 1, 2, 3, 4, 6, 7, 9, 10, 12, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24)


def fnb_old_layout(rows: list) -> list:
    """Proyeksikan baris layout baru (25 kolom) ke layout lama (21 kolom).

    Kolom Packaging dibuang; kolom Total/Diff tetap memakai angka yang sama
    (sudah termasuk Packaging), persis seperti format lama Finance. BNI ikut
    ditampilkan supaya kolom pembayaran bisa dijumlahkan ke Total.
    """
    return [
        [row[i] if i < len(row) else None for i in CAFE_OLD_COLUMNS]
        for row in rows
    ]

COLUMN_MAP = {
    "business_date": "Business Date",
    "bill_no": "Bill No.",
    "outlet": "Outlet",
    "item": "Item",
    "category": "Category",
    "tender": "Tender",
    "remarks": "Remarks",
    "bill_closed_date": "Bill Closed Date",
    "bill_created_date": "Bill Created Date",
    "bill_duration_mins": "Bill Duration(Mins)",
    "gross_amount_excl": "Gross Amount Excl.",
    "gross_amount": "Gross Amount",
    "discount": "Discount",
    "net_sales": "Net Sales",
    "net_amount": "Net Amount",
    "tax": "Tax",
    "charge": "Charge",
    "gross_sales_all_incl": "Gross Sales (All Incl.)",
    "net_sales_with_charges": "Net Sales (With Charges)",
    "item_qty": "Item Qty",
}


def process_sales_dataframe(df: pd.DataFrame) -> dict:
    required_cols = ['Category', 'Item', 'Gross Sales (All Incl.)']
    missing_cols = [col for col in required_cols if col not in df.columns]
    if missing_cols:
        raise HTTPException(status_code=400, detail=f"Missing columns: {', '.join(missing_cols)}")

    has_date = 'Business Date' in df.columns
    if has_date:
        df['Business Date'] = pd.to_datetime(df['Business Date'], errors='coerce')

    valid_categories = ["01-Ticketing", "TC01-Ticket Cartenz", "SNP-TICKET-SPARK Ticket", "CPP-TICKET-Carstensz Ticket", "SNP-RETAIL-SPARK Retail", "CPP-RETAIL-Carstensz Retail", "SNP-BIRTHDAY-SPARK Birthday Package", "CPP-BIRTHDAY-Carstensz Birthday Package", "SNP-FIELDTRIP-SPARK Fieldtrip Package", "CPP-FIELDTRIP-Carstensz Fieldtrip Package"]
    df_filtered = df[df['Category'].isin(valid_categories)].copy()

    item_str = df_filtered['Item'].astype(str).str.strip()
    item_lower = item_str.str.lower()
    gross_amt = pd.to_numeric(df_filtered['Gross Sales (All Incl.)'], errors='coerce').fillna(0)

    # Exclude online items first
    is_blibli = item_lower.str.contains('blibli', regex=False)
    is_tiketcom = item_lower.str.contains(r'tiket\s*com|ticket\s*com|tiket\.com|ticket\.com', regex=True)
    is_website = item_lower.str.contains('website', regex=False)
    is_activity = item_lower.str.contains('activity', regex=False)
    online_mask = is_blibli | is_tiketcom | is_website | is_activity
    df_filtered = df_filtered[~online_mask].copy()

    # Recalculate after exclusion
    item_str = df_filtered['Item'].astype(str).str.strip()
    item_lower = item_str.str.lower()
    gross_amt = pd.to_numeric(df_filtered['Gross Sales (All Incl.)'], errors='coerce').fillna(0)

    is_kaos_kaki = item_str.str.contains(r'\b(XXS|XS|S|M|L)$', flags=re.IGNORECASE, regex=True) | item_lower.str.contains(r'kaos\s*kaki|rtl-soc', regex=True)
    is_2jam = item_lower.str.contains(r'2\s*jam', regex=True)
    is_3jam = item_lower.str.contains(r'3\s*jam', regex=True)
    is_1comp = item_lower.str.contains(r'1\s*comp|companion\s*1', regex=True)
    is_2comp = item_lower.str.contains(r'2\s*comp|companion\s*2', regex=True)
    is_extra = item_lower.str.contains(r'extra', regex=True)
    is_promo = item_lower.str.contains(r'promo', regex=True)

    new_cat = pd.Series('null', index=df_filtered.index)
    new_cat = new_cat.where(~is_2jam, 'Tiket Bermain - 2 Jam')
    new_cat = new_cat.where(~(~is_2jam & is_3jam), 'Tiket Bermain - 3 Jam')
    new_cat = new_cat.where(~(~is_2jam & ~is_3jam & is_1comp), 'Tiket Pendamping - 1 Orang')
    new_cat = new_cat.where(~(~is_2jam & ~is_3jam & ~is_1comp & is_2comp), 'Tiket Pendamping - 2 Orang')
    new_cat = new_cat.where(~(~is_2jam & ~is_3jam & ~is_1comp & ~is_2comp & is_extra), 'Extra Time')
    new_cat = new_cat.where(~(~is_2jam & ~is_3jam & ~is_1comp & ~is_2comp & ~is_extra & is_promo), 'Promo')

    has_new_cat = new_cat != 'null'
    is_skye = item_lower.str.contains(r'skye|marshall|sbsp', regex=True)

    source = pd.Series('null', index=df_filtered.index)
    source = source.where(~(has_new_cat & is_skye), 'KAOS KAKI')
    source = source.where(~(has_new_cat & ~is_skye), 'WALK IN')
    source = source.where(~is_kaos_kaki, 'KAOS KAKI')

    df_filtered['New Category'] = new_cat
    df_filtered['Source'] = source

    drop_mask = is_kaos_kaki & ((gross_amt == 0) | gross_amt.isna())
    df_result = df_filtered[~drop_mask].copy()
    df_result = df_result[~((df_result['New Category'] == 'null') & (df_result['Source'] == 'null'))]

    unnamed_cols = [col for col in df_result.columns if 'Unnamed:' in str(col)]
    if unnamed_cols:
        df_result = df_result.drop(columns=unnamed_cols)

    df_result['Gross Sales (All Incl.)'] = pd.to_numeric(df_result['Gross Sales (All Incl.)'], errors='coerce').fillna(0)

    has_qty = 'Item Qty' in df_result.columns
    if has_qty:
        df_result['Item Qty'] = pd.to_numeric(df_result['Item Qty'], errors='coerce').fillna(0)

    has_net_sales = 'Net Sales' in df_result.columns
    if has_net_sales:
        df_result['Net Sales'] = pd.to_numeric(df_result['Net Sales'], errors='coerce').fillna(0)

    has_discount = 'Discount' in df_result.columns
    if has_discount:
        df_result['Discount'] = pd.to_numeric(df_result['Discount'], errors='coerce').fillna(0)

    has_tax = 'Tax' in df_result.columns
    if has_tax:
        df_result['Tax'] = pd.to_numeric(df_result['Tax'], errors='coerce').fillna(0)

    total_gross = float(df_result['Gross Sales (All Incl.)'].sum())
    total_transactions = int(len(df_result))
    avg_per_transaction = float(total_gross / total_transactions) if total_transactions > 0 else 0
    total_qty = int(df_result['Item Qty'].sum()) if has_qty else None
    total_net_sales = float(df_result['Net Sales'].sum()) if has_net_sales else None
    total_discount = float(df_result['Discount'].sum()) if has_discount else None
    total_tax = float(df_result['Tax'].sum()) if has_tax else None

    metrics = {
        "total_gross": total_gross,
        "total_transactions": total_transactions,
        "avg_per_transaction": round(avg_per_transaction, 2),
        "total_qty": total_qty,
        "total_net_sales": total_net_sales,
        "total_discount": total_discount,
        "total_tax": total_tax,
    }

    available_months = []
    if has_date:
        df_result['_month'] = df_result['Business Date'].dt.to_period('M')
        months = df_result['_month'].dropna().unique()
        months_sorted = sorted(months)
        available_months = [str(m) for m in months_sorted]

    chart_daily = []
    if has_date:
        daily_df = df_result.copy()
        daily_df['_date_str'] = daily_df['Business Date'].dt.strftime('%Y-%m-%d')
        agg_dict = {'Gross Sales (All Incl.)': 'sum'}
        if has_qty:
            agg_dict['Item Qty'] = 'sum'
        daily_grouped = daily_df.groupby('_date_str', as_index=False).agg(agg_dict)
        daily_grouped = daily_grouped.sort_values('_date_str')
        daily_grouped = daily_grouped.rename(columns={'_date_str': 'date', 'Gross Sales (All Incl.)': 'Gross Amount'})
        chart_daily = daily_grouped.to_dict(orient='records')

    chart_monthly = []
    if has_date:
        monthly_df = df_result.copy()
        monthly_df['_month_str'] = monthly_df['Business Date'].dt.strftime('%Y-%m')
        agg_dict = {'Gross Sales (All Incl.)': 'sum'}
        if has_qty:
            agg_dict['Item Qty'] = 'sum'
        monthly_grouped = monthly_df.groupby('_month_str', as_index=False).agg(agg_dict)
        monthly_grouped = monthly_grouped.sort_values('_month_str')
        monthly_grouped = monthly_grouped.rename(columns={'_month_str': 'month', 'Gross Sales (All Incl.)': 'Gross Amount'})
        chart_monthly = monthly_grouped.to_dict(orient='records')

    chart1_df = df_result[df_result['New Category'] != 'null'].copy()
    chart1_grouped = chart1_df.groupby('New Category', as_index=False)['Gross Sales (All Incl.)'].sum()
    chart1_grouped = chart1_grouped.rename(columns={'Gross Sales (All Incl.)': 'Gross Amount'})
    chart1_data = chart1_grouped.to_dict(orient='records')

    chart2_df = df_result[df_result['Source'] != 'null'].copy()
    chart2_grouped = chart2_df.groupby('Source', as_index=False)['Gross Sales (All Incl.)'].sum()
    chart2_grouped = chart2_grouped.rename(columns={'Gross Sales (All Incl.)': 'Gross Amount'})
    chart2_data = chart2_grouped.to_dict(orient='records')

    chart_tender = []
    if 'Tender' in df_result.columns:
        tender_df = df_result.copy()
        tender_df['Tender'] = tender_df['Tender'].astype(str).str.strip()
        tender_df = tender_df[tender_df['Tender'] != '']
        tender_grouped = tender_df.groupby('Tender', as_index=False)['Gross Sales (All Incl.)'].sum()
        tender_grouped = tender_grouped.rename(columns={'Gross Sales (All Incl.)': 'Gross Amount'})
        chart_tender = tender_grouped.to_dict(orient='records')

    if has_date:
        df_result['Business Date'] = df_result['Business Date'].dt.strftime('%Y-%m-%d')
        if '_month' in df_result.columns:
            df_result = df_result.drop(columns=['_month'])

    df_result = df_result.fillna("")

    display_cols = ['Business Date', 'Category', 'Item', 'New Category', 'Source', 'Gross Sales (All Incl.)']
    if has_qty:
        display_cols.append('Item Qty')
    existing_display = [c for c in display_cols if c in df_result.columns]
    other_cols = [col for col in df_result.columns if col not in existing_display]
    df_preview = df_result[existing_display + other_cols].head(100)
    preview_data = df_preview.to_dict(orient='records')

    all_data = df_result.to_dict(orient='records')

    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df_result.to_excel(writer, index=False, sheet_name='Sales_Data_Processed')
    file_base64 = base64.b64encode(output.getvalue()).decode('utf-8')

    return {
        "success": True,
        "preview_data": preview_data,
        "all_data": all_data,
        "metrics": metrics,
        "available_months": available_months,
        "chart_category": chart1_data,
        "chart_source": chart2_data,
        "chart_daily": chart_daily,
        "chart_monthly": chart_monthly,
        "chart_tender": chart_tender,
        "file_base64": file_base64,
        "total_rows": len(df_result),
    }


@app.get("/api/outlets")
async def get_outlets():
    try:
        ck = cache_key("outlets")
        cached = get_cached(ck)
        if cached:
            return cached
        conn = psycopg2.connect(
            host=DB_HOST,
            port=DB_PORT,
            dbname=DB_NAME,
            user=DB_USER,
            password=DB_PASSWORD,
        )
        # Only return outlets that have ticket data with new category format
        query = """
            SELECT DISTINCT outlet FROM pos_sales
            WHERE outlet IS NOT NULL AND outlet != ''
            AND category IN ('SNP-TICKET-SPARK Ticket', 'CPP-TICKET-Carstensz Ticket',
                             'SNP-RETAIL-SPARK Retail', 'CPP-RETAIL-Carstensz Retail',
                             'SNP-BIRTHDAY-SPARK Birthday Package', 'CPP-BIRTHDAY-Carstensz Birthday Package',
                             'SNP-FIELDTRIP-SPARK Fieldtrip Package', 'CPP-FIELDTRIP-Carstensz Fieldtrip Package')
            ORDER BY outlet
        """
        df = pd.read_sql(query, conn)
        conn.close()

        # Outlet labels
        outlet_labels = {
            'OUTLET01-Park Nickelodeon': 'SNP - Senayan Park Nickelodeon',
            'OUTLET02-Nickelodeon Theme Park Carstensz Mall': 'CPP - Carstensz',
        }

        outlets_list = []
        for o in df['outlet'].tolist():
            if o:
                label = outlet_labels.get(o, o)
                outlets_list.append({"id": o, "label": label})

        result = {"outlets": outlets_list}
        set_cached(ck, result)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/sales")
async def get_sales(
    start_date: str = Query(..., description="Start date YYYY-MM-DD"),
    end_date: str = Query(..., description="End date YYYY-MM-DD"),
    outlet: Optional[List[str]] = Query(None, description="Optional outlet filter (multi)"),
    channel: str = Query("walk_in", description="Sales channel: walk_in, all, blibli, tiketcom, website"),
):
    try:
        ck = cache_key("sales", start_date, end_date, outlet, channel)
        cached = get_cached(ck)
        if cached:
            return cached
        conn = psycopg2.connect(
            host=DB_HOST,
            port=DB_PORT,
            dbname=DB_NAME,
            user=DB_USER,
            password=DB_PASSWORD,
        )
        # Ticket filter: match patterns (2jam/3jam/1comp/2comp/extra/birthday/field trip/promo) OR kaos kaki with gross > 0
        # CPP-ADD-Additional Ticket hanya untuk Companion — COIN, Pup Pup Boogie, DIY masuk Activity.
        item_filter = """
            AND category IN ('01-Ticketing', 'TC01-Ticket Cartenz', 'SNP-TICKET-SPARK Ticket', 'CPP-TICKET-Carstensz Ticket', 'SNP-RETAIL-SPARK Retail', 'CPP-RETAIL-Carstensz Retail', 'SNP-BIRTHDAY-SPARK Birthday Package', 'CPP-BIRTHDAY-Carstensz Birthday Package', 'SNP-FIELDTRIP-SPARK Fieldtrip Package', 'CPP-FIELDTRIP-Carstensz Fieldtrip Package')
            AND (
                LOWER(item) ~ '2\\s*jam'
                OR LOWER(item) ~ '3\\s*jam'
                OR LOWER(item) ~ '1\\s*comp|companion\\s*1'
                OR LOWER(item) ~ '2\\s*comp|companion\\s*2'
                OR LOWER(item) ~ 'extra'
                OR LOWER(item) ~ 'birthday'
                OR LOWER(item) ~ 'field\\s*trip'
                OR LOWER(item) ~ 'promo'
                OR LOWER(item) ~ 'super\\s*fun'
                OR ((item ~ '(XXS|XS|S|M|L)$' OR LOWER(item) ~ 'kaos\\s*kaki' OR LOWER(item) ~ 'rtl-soc') AND gross_sales_all_incl > 0)
                OR (category_2 = 'CPP-ADD-Additional Ticket' AND LOWER(item) ~ 'companion')
            )
        """
        # Channel filter
        if channel == "walk_in":
            item_filter += """
            AND LOWER(item) NOT LIKE '%%blibli%%'
            AND LOWER(item) NOT LIKE '%%tiketcom%%'
            AND LOWER(item) NOT LIKE '%%tiket.com%%'
            AND LOWER(item) NOT LIKE '%%tiket com%%'
            AND LOWER(item) NOT LIKE '%%website%%'
            AND LOWER(item) NOT LIKE '%%activity%%'
            """
        elif channel == "blibli":
            item_filter += " AND LOWER(item) LIKE '%%blibli%%'"
        elif channel == "tiketcom":
            item_filter += " AND (LOWER(item) LIKE '%%tiketcom%%' OR LOWER(item) LIKE '%%tiket.com%%' OR LOWER(item) LIKE '%%tiket com%%')"
        elif channel == "website":
            item_filter += " AND LOWER(item) LIKE '%%website%%'"
        # channel == "all" means no exclusion

        query = f"SELECT * FROM pos_sales WHERE business_date >= %s AND business_date <= %s {item_filter}"
        params = [start_date + " 00:00:00", end_date + " 23:59:59"]
        if outlet:
            query += " AND outlet IN %s"
            params.append(tuple(outlet))
        df = pd.read_sql(query, conn, params=params)
        conn.close()

        if df.empty:
            empty_result = {
                "success": True,
                "preview_data": [],
                "all_data": [],
                "metrics": {
                    "total_gross": 0,
                    "total_net": 0,
                    "total_tax": 0,
                    "total_discount": 0,
                    "total_charge": 0,
                    "total_transactions": 0,
                    "avg_per_transaction": 0,
                },
                "available_months": [],
                "chart_category": [],
                "chart_source": [],
                "chart_daily": [],
                "chart_monthly": [],
                "chart_tender": [],
                "file_base64": "",
                "total_rows": 0,
            }
            set_cached(ck, empty_result)
            return empty_result

        df = df.rename(columns=COLUMN_MAP)
        result = process_sales_dataframe(df)
        set_cached(ck, result)
        return result

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/reconciliation")
async def get_reconciliation(
    start_date: str = Query(..., description="Start date YYYY-MM-DD"),
    end_date: str = Query(..., description="End date YYYY-MM-DD"),
    outlet: Optional[List[str]] = Query(None, description="Optional outlet filter (multi)"),
    channel: str = Query("walk_in", description="Sales channel: walk_in, all, blibli, tiketcom, website"),
):
    try:
        ck = cache_key("reconciliation", start_date, end_date, outlet, channel)
        cached = get_cached(ck)
        if cached:
            return cached
        conn = psycopg2.connect(
            host=DB_HOST,
            port=DB_PORT,
            dbname=DB_NAME,
            user=DB_USER,
            password=DB_PASSWORD,
        )

        # Build item filter based on channel
        # CPP-ADD-Additional Ticket hanya untuk Companion — COIN, Pup Pup Boogie, DIY masuk Activity.
        item_filter = """
              AND category IN ('01-Ticketing', 'TC01-Ticket Cartenz', 'SNP-TICKET-SPARK Ticket', 'CPP-TICKET-Carstensz Ticket', 'SNP-RETAIL-SPARK Retail', 'CPP-RETAIL-Carstensz Retail', 'SNP-BIRTHDAY-SPARK Birthday Package', 'CPP-BIRTHDAY-Carstensz Birthday Package', 'SNP-FIELDTRIP-SPARK Fieldtrip Package', 'CPP-FIELDTRIP-Carstensz Fieldtrip Package')
              AND (
                  LOWER(item) ~ '2\\s*jam'
                  OR LOWER(item) ~ '3\\s*jam'
                  OR LOWER(item) ~ '1\\s*comp|companion\\s*1'
                  OR LOWER(item) ~ '2\\s*comp|companion\\s*2'
                  OR LOWER(item) ~ 'extra'
                  OR LOWER(item) ~ 'birthday'
                  OR LOWER(item) ~ 'field\\s*trip'
                  OR LOWER(item) ~ 'promo'
                  OR LOWER(item) ~ 'super\\s*fun'
                  OR ((item ~ '(XXS|XS|S|M|L)$' OR LOWER(item) ~ 'kaos\\s*kaki' OR LOWER(item) ~ 'rtl-soc') AND gross_sales_all_incl > 0)
                  OR (category_2 = 'CPP-ADD-Additional Ticket' AND LOWER(item) ~ 'companion')
              )
        """
        if channel == "walk_in":
            item_filter += """
              AND LOWER(item) NOT LIKE '%%blibli%%'
              AND LOWER(item) NOT LIKE '%%tiketcom%%'
              AND LOWER(item) NOT LIKE '%%tiket.com%%'
              AND LOWER(item) NOT LIKE '%%tiket com%%'
              AND LOWER(item) NOT LIKE '%%website%%'
              AND LOWER(item) NOT LIKE '%%activity%%'
            """
        elif channel == "blibli":
            item_filter += " AND LOWER(item) LIKE '%%blibli%%'"
        elif channel == "tiketcom":
            item_filter += " AND (LOWER(item) LIKE '%%tiketcom%%' OR LOWER(item) LIKE '%%tiket.com%%' OR LOWER(item) LIKE '%%tiket com%%')"
        elif channel == "website":
            item_filter += " AND LOWER(item) LIKE '%%website%%'"

        pos_query = f"""
            SELECT DATE(business_date) as date, SUM(gross_sales_all_incl) as pos
            FROM pos_sales
            WHERE business_date >= %s AND business_date <= %s
              {item_filter}
        """
        pos_params = [start_date + " 00:00:00", end_date + " 23:59:59"]
        if outlet:
            pos_query += " AND outlet IN %s"
            pos_params.append(tuple(outlet))
        pos_query += " GROUP BY DATE(business_date) ORDER BY date"
        pos_df = pd.read_sql(pos_query, conn, params=pos_params)

        # BCA: must match combined-report filters (card_type, merchant_payment_status, outlet)
        # Status yang dihitung: PAID + PEND (record source PC = transaksi sudah terjadi
        # tapi belum settled). UNSETL tetap dikecualikan. Baris rekap SD/AD/SC/AC aman
        # karena card_type-nya NULL, jadi tersaring card_type <> ''.
        bca_query = """
            SELECT
                process_effective_date as date,
                SUM(gross_amount) as bca
            FROM bca_transactions
            WHERE process_effective_date IS NOT NULL
              AND process_effective_date >= %s AND process_effective_date <= %s
              AND kategori = 'TICKET'
              AND card_type <> ''
              AND merchant_payment_status IN ('PAID', 'PEND')
        """
        bca_params = [start_date, end_date]
        if outlet:
            bca_query += " AND outlet IN %s"
            bca_params.append(tuple(outlet))
        bca_query += " GROUP BY process_effective_date ORDER BY date"
        bca_df = pd.read_sql(bca_query, conn, params=bca_params)

        # BRI: must match combined-report filters (outlet)
        bri_query = """
            SELECT
                tgl_trx as date,
                SUM(amt_trx) as bri
            FROM bri_transactions
            WHERE tgl_trx IS NOT NULL
              AND tgl_trx >= %s AND tgl_trx <= %s
              AND kategori = 'TICKET'
        """
        bri_params = [start_date, end_date]
        if outlet:
            bri_query += " AND outlet IN %s"
            bri_params.append(tuple(outlet))
        bri_query += " GROUP BY tgl_trx ORDER BY date"
        bri_df = pd.read_sql(bri_query, conn, params=bri_params)

        # BNI: from bni_transactions
        bni_query = """
            SELECT
                trx_date as date,
                SUM(amount) as bni
            FROM bni_transactions
            WHERE trx_date IS NOT NULL
              AND trx_date >= %s AND trx_date <= %s
              AND kategori = 'TICKET'
        """
        bni_params = [start_date, end_date]
        if outlet:
            bni_query += " AND outlet IN %s"
            bni_params.append(tuple(outlet))
        bni_query += " GROUP BY trx_date ORDER BY date"
        bni_df = pd.read_sql(bni_query, conn, params=bni_params)

        # Nusapay from POS tender with same ticket filter
        nusapay_query = f"""
            SELECT DATE(business_date) as date, SUM(gross_sales_all_incl) as nusapay
            FROM pos_sales
            WHERE business_date >= %s AND business_date <= %s
              {item_filter}
              AND tender LIKE '%%QRIS1-QRIS NUSA%%'
        """
        nusapay_params = [start_date + " 00:00:00", end_date + " 23:59:59"]
        if outlet:
            nusapay_query += " AND outlet IN %s"
            nusapay_params.append(tuple(outlet))
        nusapay_query += " GROUP BY DATE(business_date) ORDER BY date"
        nusapay_df = pd.read_sql(nusapay_query, conn, params=nusapay_params)

        # Deposit from POS tender
        deposit_query = f"""
            SELECT DATE(business_date) as date, SUM(gross_sales_all_incl) as deposit
            FROM pos_sales
            WHERE business_date >= %s AND business_date <= %s
              {item_filter}
              AND tender LIKE '%%DPS1-DEPOSIT%%'
        """
        deposit_params = [start_date + " 00:00:00", end_date + " 23:59:59"]
        if outlet:
            deposit_query += " AND outlet IN %s"
            deposit_params.append(tuple(outlet))
        deposit_query += " GROUP BY DATE(business_date) ORDER BY date"
        deposit_df = pd.read_sql(deposit_query, conn, params=deposit_params)

        # Voucher: Tender Details (nominal per tender per bill) dengan fallback POS
        voucher_query = f"""
            SELECT DATE(business_date) as date, SUM(gross_sales_all_incl) as voucher
            FROM pos_sales
            WHERE business_date >= %s AND business_date <= %s
              {item_filter}
              AND LOWER(tender) LIKE '%%voucher%%'
        """
        voucher_params = [start_date + " 00:00:00", end_date + " 23:59:59"]
        if outlet:
            voucher_query += " AND outlet IN %s"
            voucher_params.append(tuple(outlet))
        voucher_query += " GROUP BY DATE(business_date) ORDER BY date"
        voucher_df = pd.read_sql(voucher_query, conn, params=voucher_params)

        voucher_tender_query = f"""
            SELECT business_date as date, SUM(tender_amount) as voucher
            FROM pos_tender_details
            WHERE business_date >= %s AND business_date <= %s
              AND LOWER(tender) LIKE '%%voucher%%'
        """
        voucher_tender_params = [start_date, end_date]
        if outlet:
            voucher_tender_query += " AND outlet IN %s"
            voucher_tender_params.append(tuple(outlet))
        voucher_tender_query += " GROUP BY business_date ORDER BY date"
        try:
            voucher_tender_df = pd.read_sql(
                voucher_tender_query, conn, params=voucher_tender_params
            )
        except Exception as e:
            logger.warning("Tender Details voucher tidak tersedia, fallback ke POS: %s", e)
            voucher_tender_df = pd.DataFrame()

        if not voucher_tender_df.empty:
            voucher_df['date'] = pd.to_datetime(voucher_df['date'])
            voucher_tender_df['date'] = pd.to_datetime(voucher_tender_df['date'])
            voucher_df = pd.concat(
                [voucher_df, voucher_tender_df], ignore_index=True
            ).drop_duplicates(subset=['date'], keep='last')

        conn.close()

        pos_df['date'] = pd.to_datetime(pos_df['date'])
        bca_df['date'] = pd.to_datetime(bca_df['date'])
        bri_df['date'] = pd.to_datetime(bri_df['date'])
        bni_df['date'] = pd.to_datetime(bni_df['date'])
        nusapay_df['date'] = pd.to_datetime(nusapay_df['date'])
        deposit_df['date'] = pd.to_datetime(deposit_df['date'])
        voucher_df['date'] = pd.to_datetime(voucher_df['date'])

        date_range = pd.date_range(start=start_date, end=end_date)
        result_df = pd.DataFrame({'date': date_range})

        result_df = result_df.merge(pos_df, on='date', how='left')
        result_df = result_df.merge(bca_df, on='date', how='left')
        result_df = result_df.merge(bri_df, on='date', how='left')
        result_df = result_df.merge(bni_df, on='date', how='left')
        result_df = result_df.merge(nusapay_df, on='date', how='left')
        result_df = result_df.merge(deposit_df, on='date', how='left')
        result_df = result_df.merge(voucher_df, on='date', how='left')

        result_df = result_df.fillna(0)
        result_df['bank_total'] = result_df['bca'] + result_df['bri'] + result_df['bni'] + result_df['nusapay']
        # Difference = POS - Total Bank - Deposit - Voucher (what's unaccounted for, likely cash)
        result_df['difference'] = result_df['pos'] - result_df['bank_total'] - result_df['deposit'] - result_df['voucher']
        result_df['date'] = result_df['date'].dt.strftime('%Y-%m-%d')

        for col in ['pos', 'bca', 'bri', 'bni', 'nusapay', 'deposit', 'voucher', 'bank_total', 'difference']:
            result_df[col] = result_df[col].astype(float)

        result = {
            "success": True,
            "data": result_df.to_dict(orient='records'),
            "totals": {
                "pos": float(result_df['pos'].sum()),
                "bca": float(result_df['bca'].sum()),
                "bri": float(result_df['bri'].sum()),
                "bni": float(result_df['bni'].sum()),
                "nusapay": float(result_df['nusapay'].sum()),
                "deposit": float(result_df['deposit'].sum()),
                "voucher": float(result_df['voucher'].sum()),
                "bank_total": float(result_df['bank_total'].sum()),
                "difference": float(result_df['difference'].sum()),
            }
        }
        set_cached(ck, result)
        return result

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/fnb-reconciliation")
async def get_fnb_reconciliation(
    start_date: str = Query(..., description="Start date YYYY-MM-DD"),
    end_date: str = Query(..., description="End date YYYY-MM-DD"),
    outlet: Optional[List[str]] = Query(None, description="Optional outlet filter (multi)"),
):
    """F&B Reconciliation: POS vs Bank for Food & Beverages"""
    try:
        ck = cache_key("fnb-reconciliation", start_date, end_date, outlet)
        cached = get_cached(ck)
        if cached:
            return cached
        conn = psycopg2.connect(
            host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD
        )

        # Cafe config: outlet -> cafe name + bucket F&B
        cafe_config = FNB_BUCKETS

        # Filter outlets if specified
        if outlet:
            cafe_config = {k: v for k, v in cafe_config.items() if k in outlet}

        all_rows = []

        for outlet_key, cafe_info in cafe_config.items():
            cafe_name = cafe_info['name']
            legacy_cats = tuple(cafe_info['legacy_food_cats']) + tuple(cafe_info['legacy_bev_cats'])
            cats_clause, cats_params = fnb_bucket_clause(ALL_FNB_CATS[outlet_key], legacy_cats)

            # POS F&B
            pos_query = f"""
                SELECT DATE(business_date) as date, SUM(gross_sales_all_incl) as pos
                FROM pos_sales
                WHERE business_date >= %s AND business_date <= %s
                  AND outlet = %s AND {cats_clause}
                GROUP BY DATE(business_date)
            """
            pos_df = pd.read_sql(pos_query, conn, params=[
                start_date + " 00:00:00", end_date + " 23:59:59", outlet_key] + cats_params)

            # BRI FNB
            bri_query = """
                SELECT tgl_trx as date, SUM(amt_trx) as bri
                FROM bri_transactions
                WHERE tgl_trx IS NOT NULL AND tgl_trx >= %s AND tgl_trx <= %s
                  AND kategori = 'FNB' AND outlet = %s
                GROUP BY tgl_trx
            """
            bri_df = pd.read_sql(bri_query, conn, params=[start_date, end_date, outlet_key])

            # BCA FNB
            bca_query = """
                SELECT process_effective_date as date, SUM(gross_amount) as bca
                FROM bca_transactions
                WHERE process_effective_date IS NOT NULL AND process_effective_date >= %s AND process_effective_date <= %s
                  AND kategori = 'FNB' AND outlet = %s
                  AND card_type <> '' AND merchant_payment_status IN ('PAID', 'PEND')
                GROUP BY process_effective_date
            """
            bca_df = pd.read_sql(bca_query, conn, params=[start_date, end_date, outlet_key])

            # BNI FNB
            bni_query = """
                SELECT trx_date as date, SUM(amount) as bni
                FROM bni_transactions
                WHERE trx_date IS NOT NULL AND trx_date >= %s AND trx_date <= %s
                  AND kategori = 'FNB' AND outlet = %s
                GROUP BY trx_date
            """
            bni_df = pd.read_sql(bni_query, conn, params=[start_date, end_date, outlet_key])

            # Nusapay FNB (from POS tender)
            nusapay_query = f"""
                SELECT DATE(business_date) as date, SUM(gross_sales_all_incl) as nusapay
                FROM pos_sales
                WHERE business_date >= %s AND business_date <= %s
                  AND outlet = %s AND {cats_clause}
                  AND tender LIKE '%%QRIS1-QRIS NUSA%%'
                GROUP BY DATE(business_date)
            """
            nusapay_df = pd.read_sql(nusapay_query, conn, params=[
                start_date + " 00:00:00", end_date + " 23:59:59", outlet_key] + cats_params)

            # Deposit FNB
            deposit_query = f"""
                SELECT DATE(business_date) as date, SUM(gross_sales_all_incl) as deposit
                FROM pos_sales
                WHERE business_date >= %s AND business_date <= %s
                  AND outlet = %s AND {cats_clause}
                  AND tender LIKE '%%DPS1-DEPOSIT%%'
                GROUP BY DATE(business_date)
            """
            deposit_df = pd.read_sql(deposit_query, conn, params=[
                start_date + " 00:00:00", end_date + " 23:59:59", outlet_key] + cats_params)

            # Voucher FNB
            voucher_query = f"""
                SELECT DATE(business_date) as date, SUM(gross_sales_all_incl) as voucher
                FROM pos_sales
                WHERE business_date >= %s AND business_date <= %s
                  AND outlet = %s AND {cats_clause}
                  AND LOWER(tender) LIKE '%%voucher%%'
                GROUP BY DATE(business_date)
            """
            voucher_df = pd.read_sql(voucher_query, conn, params=[
                start_date + " 00:00:00", end_date + " 23:59:59", outlet_key] + cats_params)

            # Convert dates
            for df in [pos_df, bri_df, bca_df, bni_df, nusapay_df, deposit_df, voucher_df]:
                if not df.empty and 'date' in df.columns:
                    df['date'] = pd.to_datetime(df['date'])

            # Get all dates
            date_range = pd.date_range(start=start_date, end=end_date)

            for dt in date_range:
                pos_val = float(pos_df[pos_df['date'] == dt]['pos'].iloc[0]) if not pos_df.empty and len(pos_df[pos_df['date'] == dt]) > 0 else 0
                bri_val = float(bri_df[bri_df['date'] == dt]['bri'].iloc[0]) if not bri_df.empty and len(bri_df[bri_df['date'] == dt]) > 0 else 0
                bca_val = float(bca_df[bca_df['date'] == dt]['bca'].iloc[0]) if not bca_df.empty and len(bca_df[bca_df['date'] == dt]) > 0 else 0
                bni_val = float(bni_df[bni_df['date'] == dt]['bni'].iloc[0]) if not bni_df.empty and len(bni_df[bni_df['date'] == dt]) > 0 else 0
                nusapay_val = float(nusapay_df[nusapay_df['date'] == dt]['nusapay'].iloc[0]) if not nusapay_df.empty and len(nusapay_df[nusapay_df['date'] == dt]) > 0 else 0
                deposit_val = float(deposit_df[deposit_df['date'] == dt]['deposit'].iloc[0]) if not deposit_df.empty and len(deposit_df[deposit_df['date'] == dt]) > 0 else 0
                voucher_val = float(voucher_df[voucher_df['date'] == dt]['voucher'].iloc[0]) if not voucher_df.empty and len(voucher_df[voucher_df['date'] == dt]) > 0 else 0

                bank_total = bri_val + bca_val + bni_val + nusapay_val
                diff = pos_val - bank_total - deposit_val - voucher_val

                if pos_val > 0 or bank_total > 0 or deposit_val > 0 or voucher_val > 0:
                    all_rows.append({
                        'date': dt.strftime('%Y-%m-%d'),
                        'store': cafe_name,
                        'pos': pos_val,
                        'bri': bri_val,
                        'bca': bca_val,
                        'bni': bni_val,
                        'nusapay': nusapay_val,
                        'deposit': deposit_val,
                        'voucher': voucher_val,
                        'bank_total': bank_total,
                        'difference': diff,
                    })

        conn.close()

        # Sort by date, then store
        all_rows = sorted(all_rows, key=lambda x: (x['date'], x['store']))

        # Calculate totals
        totals = {
            'pos': sum(r['pos'] for r in all_rows),
            'bri': sum(r['bri'] for r in all_rows),
            'bca': sum(r['bca'] for r in all_rows),
            'bni': sum(r['bni'] for r in all_rows),
            'nusapay': sum(r['nusapay'] for r in all_rows),
            'deposit': sum(r['deposit'] for r in all_rows),
            'voucher': sum(r['voucher'] for r in all_rows),
            'bank_total': sum(r['bank_total'] for r in all_rows),
            'difference': sum(r['difference'] for r in all_rows),
        }

        result = {
            "success": True,
            "data": all_rows,
            "totals": totals
        }
        set_cached(ck, result)
        return result

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/fnb-sales")
async def get_fnb_sales(
    start_date: str = Query(..., description="Start date YYYY-MM-DD"),
    end_date: str = Query(..., description="End date YYYY-MM-DD"),
    outlet: Optional[List[str]] = Query(None, description="Optional outlet filter (multi)"),
):
    try:
        ck = cache_key("fnb-sales", start_date, end_date, outlet)
        cached = get_cached(ck)
        if cached:
            return cached
        conn = psycopg2.connect(
            host=DB_HOST,
            port=DB_PORT,
            dbname=DB_NAME,
            user=DB_USER,
            password=DB_PASSWORD,
        )

        # Semua kategori F&B kedua outlet (category_2 untuk September 2026+,
        # category lama untuk data sebelumnya). Nama lama yang benar untuk CPP
        # ada akhiran " (C)" - sebelumnya 'FC01-Food' tidak pernah match.
        fnb_cats = (ALL_FNB_CATS['OUTLET01-Park Nickelodeon']
                    + ALL_FNB_CATS['OUTLET02-Nickelodeon Theme Park Carstensz Mall'])
        fnb_clause, fnb_params = fnb_bucket_clause(
            fnb_cats, ('03-Food', '04-Beverages', 'FC01-Food (C)', 'BC01-Beverages (C)'))
        base_where = f"{fnb_clause} AND business_date >= %s AND business_date <= %s"
        params = fnb_params + [start_date + " 00:00:00", end_date + " 23:59:59"]
        if outlet:
            base_where += " AND outlet IN %s"
            params.append(tuple(outlet))

        query = f"SELECT * FROM pos_sales WHERE {base_where}"
        df = pd.read_sql(query, conn, params=params)

        if df.empty:
            conn.close()
            return {
                "success": True,
                "metrics": {"total_gross": 0, "total_qty": 0, "total_transactions": 0, "avg_per_transaction": 0},
                "peak_hours": [],
                "top_10_items": [],
                "bottom_10_items": [],
            }

        df['gross_amount'] = pd.to_numeric(df['gross_amount'], errors='coerce').fillna(0)
        df['item_qty'] = pd.to_numeric(df['item_qty'], errors='coerce').fillna(0)

        total_gross = float(df['gross_amount'].sum())
        total_qty = int(df['item_qty'].sum())
        total_transactions = len(df)
        avg_per_transaction = round(total_gross / total_transactions, 2) if total_transactions > 0 else 0

        metrics = {
            "total_gross": total_gross,
            "total_qty": total_qty,
            "total_transactions": total_transactions,
            "avg_per_transaction": avg_per_transaction,
        }

        df['bill_created_date'] = pd.to_datetime(df['bill_created_date'], errors='coerce')
        df['hour'] = df['bill_created_date'].dt.hour
        peak_df = df.groupby('hour', as_index=False).agg({
            'gross_amount': 'sum',
            'item_qty': 'sum',
        }).sort_values('hour')
        peak_hours = peak_df.rename(columns={'gross_amount': 'revenue', 'item_qty': 'qty'}).to_dict(orient='records')

        item_grouped = df.groupby('item', as_index=False).agg({
            'gross_amount': 'sum',
            'item_qty': 'sum',
        })
        item_grouped = item_grouped[(item_grouped['gross_amount'] > 0) & (item_grouped['item_qty'] > 0)]
        top_10 = item_grouped.sort_values('gross_amount', ascending=False).head(10)
        bottom_10 = item_grouped.sort_values('gross_amount', ascending=True).head(10)

        top_10_items = top_10.rename(columns={'gross_amount': 'revenue', 'item_qty': 'qty'}).to_dict(orient='records')
        bottom_10_items = bottom_10.rename(columns={'gross_amount': 'revenue', 'item_qty': 'qty'}).to_dict(orient='records')
        all_items_ranked = item_grouped.sort_values('gross_amount', ascending=False).rename(columns={'gross_amount': 'revenue', 'item_qty': 'qty'}).to_dict(orient='records')

        # Category split — percentage of total gross (all categories)
        total_query = "SELECT SUM(gross_amount) as total FROM pos_sales WHERE business_date >= %s AND business_date <= %s"
        total_params = [start_date + " 00:00:00", end_date + " 23:59:59"]
        if outlet:
            total_query += " AND outlet IN %s"
            total_params.append(tuple(outlet))
        total_all_df = pd.read_sql(total_query, conn, params=total_params)
        total_all_gross = float(total_all_df['total'].iloc[0] or 0)

        food_cats = (tuple(FNB_BUCKETS['OUTLET01-Park Nickelodeon']['food_cats'])
                     + tuple(FNB_BUCKETS['OUTLET02-Nickelodeon Theme Park Carstensz Mall']['food_cats']))
        bev_cats = (tuple(FNB_BUCKETS['OUTLET01-Park Nickelodeon']['bev_cats'])
                    + tuple(FNB_BUCKETS['OUTLET02-Nickelodeon Theme Park Carstensz Mall']['bev_cats']))
        legacy_food_cats = ('03-Food', 'FC01-Food (C)')
        legacy_bev_cats = ('04-Beverages', 'BC01-Beverages (C)')

        cat2 = df['category_2'].fillna('')
        cat_legacy = df['category'].fillna('')
        is_legacy = cat2 == ''
        food_mask = cat2.isin(food_cats) | (is_legacy & cat_legacy.isin(legacy_food_cats))
        bev_mask = cat2.isin(bev_cats) | (is_legacy & cat_legacy.isin(legacy_bev_cats))
        food_gross = float(df.loc[food_mask, 'gross_amount'].sum())
        bev_gross = float(df.loc[bev_mask, 'gross_amount'].sum())

        category_split = [
            {"category": "Food", "amount": food_gross, "pct": round(food_gross / total_all_gross * 100, 1) if total_all_gross > 0 else 0},
            {"category": "Beverages", "amount": bev_gross, "pct": round(bev_gross / total_all_gross * 100, 1) if total_all_gross > 0 else 0},
        ]

        conn.close()

        result = {
            "success": True,
            "metrics": metrics,
            "peak_hours": peak_hours,
            "top_10_items": top_10_items,
            "bottom_10_items": bottom_10_items,
            "all_items": all_items_ranked,
            "category_split": category_split,
            "total_all_gross": total_all_gross,
        }
        set_cached(ck, result)
        return result

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/transform/sales")
async def transform_sales(file: UploadFile = File(...)):
    if not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="Only .xlsx files are supported.")

    try:
        contents = await file.read()
        df = pd.read_excel(io.BytesIO(contents), skiprows=6)
        return process_sales_dataframe(df)

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/transform/machine-rate")
async def transform_machine_rate(file: UploadFile = File(...)):
    if not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="Only .xlsx files are supported.")

    try:
        contents = await file.read()
        df = pd.read_excel(io.BytesIO(contents))

        required_cols = ['Project', 'Port', 'Total ticket out', 'Total Coin Input', 'Billing Period']
        missing_cols = [col for col in required_cols if col not in df.columns]
        if missing_cols:
            raise HTTPException(status_code=400, detail=f"Missing columns: {', '.join(missing_cols)}")

        has_store_column = 'Store' in df.columns
        has_game_type = 'Game Type' in df.columns

        df = df.rename(columns={
            'Project': 'Machine Name',
            'Port': 'Player Side',
        })

        if has_store_column:
            df = df[df['Store'].astype(str).str.strip().str.lower() != 'total']
        df = df[df['Machine Name'].astype(str).str.strip() != '']
        df = df[df['Machine Name'].astype(str).str.strip().str.lower() != 'total']

        df['Total ticket out'] = pd.to_numeric(df['Total ticket out'], errors='coerce').fillna(0)
        df['Total Coin Input'] = pd.to_numeric(df['Total Coin Input'], errors='coerce').fillna(0)

        df['Billing Period'] = pd.to_datetime(df['Billing Period'], errors='coerce')
        df['_date_str'] = df['Billing Period'].dt.strftime('%Y-%m-%d')
        df['_month'] = df['Billing Period'].dt.to_period('M')

        months = df['_month'].dropna().unique()
        months_sorted = sorted(months)
        available_months = [str(m) for m in months_sorted]

        available_stores = sorted([str(s) for s in df['Store'].dropna().unique() if str(s).strip() != '']) if has_store_column else []
        available_game_types = sorted([str(g) for g in df['Game Type'].dropna().unique() if str(g).strip() != '']) if has_game_type else []

        df_export = df.copy()
        df_export['Billing Period'] = df_export['Billing Period'].dt.strftime('%Y-%m-%d')
        if '_month' in df_export.columns:
            df_export = df_export.drop(columns=['_month', '_date_str'], errors='ignore')
        df_export = df_export.fillna("")
        all_data = df_export.to_dict(orient='records')

        grouped = df.groupby(['Machine Name', 'Player Side'], as_index=False).agg({
            'Total ticket out': 'sum',
            'Total Coin Input': 'sum',
        })
        grouped = grouped.rename(columns={
            'Total ticket out': 'Ticket Out',
            'Total Coin Input': 'Coin In',
        })
        grouped['Rate'] = grouped.apply(
            lambda r: round(r['Ticket Out'] / r['Coin In'], 4) if r['Coin In'] > 0 else 0, axis=1
        )
        grouped_data = grouped.to_dict(orient='records')

        total_ticket_out = float(df['Total ticket out'].sum())
        total_coin_in = float(df['Total Coin Input'].sum())
        overall_rate = round(total_ticket_out / total_coin_in, 4) if total_coin_in > 0 else 0
        unique_machines = int(df['Machine Name'].nunique())
        total_records = int(len(df))

        metrics = {
            "total_ticket_out": total_ticket_out,
            "total_coin_in": total_coin_in,
            "overall_rate": overall_rate,
            "unique_machines": unique_machines,
            "total_records": total_records,
        }

        top_machines = df.groupby('Machine Name', as_index=False).agg({
            'Total ticket out': 'sum',
            'Total Coin Input': 'sum',
        }).sort_values('Total ticket out', ascending=False).head(15)
        top_machines['Rate'] = top_machines.apply(
            lambda r: round(r['Total ticket out'] / r['Total Coin Input'], 4) if r['Total Coin Input'] > 0 else 0, axis=1
        )
        chart_top_machines = top_machines.rename(columns={
            'Total ticket out': 'Ticket Out',
            'Total Coin Input': 'Coin In',
        }).to_dict(orient='records')

        daily = df.groupby('_date_str', as_index=False).agg({
            'Total ticket out': 'sum',
            'Total Coin Input': 'sum',
        }).sort_values('_date_str')
        daily['Rate'] = daily.apply(
            lambda r: round(r['Total ticket out'] / r['Total Coin Input'], 4) if r['Total Coin Input'] > 0 else 0, axis=1
        )
        daily = daily.rename(columns={
            '_date_str': 'date',
            'Total ticket out': 'Ticket Out',
            'Total Coin Input': 'Coin In',
        })
        chart_daily = daily.to_dict(orient='records')

        output = io.BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            grouped.to_excel(writer, index=False, sheet_name='Machine_Rate_Summary')
        file_base64 = base64.b64encode(output.getvalue()).decode('utf-8')

        return {
            "success": True,
            "all_data": all_data,
            "grouped_data": grouped_data,
            "metrics": metrics,
            "available_months": available_months,
            "available_stores": available_stores,
            "available_game_types": available_game_types,
            "has_store_column": has_store_column,
            "chart_top_machines": chart_top_machines,
            "chart_daily": chart_daily,
            "file_base64": file_base64,
            "total_rows": total_records,
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/data-availability")
async def get_data_availability():
    """Get the date range of available data in each table."""
    try:
        ck = cache_key("data-availability")
        cached = get_cached(ck)
        if cached:
            return cached

        conn = psycopg2.connect(
            host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD,
        )

        query = """
            SELECT
                'pos_sales' as tbl,
                MIN(business_date)::date as from_date,
                MAX(business_date)::date as to_date,
                COUNT(*) as rows
            FROM pos_sales WHERE business_date IS NOT NULL
            UNION ALL
            SELECT 'bri_transactions', MIN(tgl_trx), MAX(tgl_trx), COUNT(*)
            FROM bri_transactions WHERE tgl_trx IS NOT NULL
            UNION ALL
            SELECT 'bca_transactions', MIN(report_date), MAX(report_date), COUNT(*)
            FROM bca_transactions WHERE report_date IS NOT NULL
        """
        df = pd.read_sql(query, conn)
        conn.close()

        result = {}
        for _, row in df.iterrows():
            # Format dates as dd/mm/yyyy
            from_fmt = row['from_date'].strftime('%d/%m/%Y') if row['from_date'] else None
            to_fmt = row['to_date'].strftime('%d/%m/%Y') if row['to_date'] else None
            result[row['tbl']] = {
                "from": from_fmt,
                "to": to_fmt,
                "latest": to_fmt,  # alias for easier frontend access
                "rows": int(row['rows']),
            }

        set_cached(ck, result)
        return result

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/discount-report")
async def get_discount_report(
    start_date: str = Query(..., description="Start date YYYY-MM-DD"),
    end_date: str = Query(..., description="End date YYYY-MM-DD"),
    outlet: Optional[List[str]] = Query(None, description="Optional outlet filter (multi)"),
):
    """Discount Report - breakdown of discounts by date, outlet, category, and item."""
    try:
        ck = cache_key("discount-report", start_date, end_date, outlet)
        cached = get_cached(ck)
        if cached:
            return cached

        conn = psycopg2.connect(
            host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD,
        )

        base_where = "business_date IS NOT NULL AND business_date >= %s AND business_date <= %s AND discount > 0"
        params = [start_date + " 00:00:00", end_date + " 23:59:59"]
        if outlet:
            base_where += " AND outlet IN %s"
            params.append(tuple(outlet))

        # Main data - all transactions with discount
        query = f"""
            SELECT
                business_date::date as date,
                outlet,
                category,
                item,
                gross_amount_excl,
                discount,
                net_sales,
                gross_sales_all_incl
            FROM pos_sales
            WHERE {base_where}
            ORDER BY business_date DESC, outlet, category
        """
        df = pd.read_sql(query, conn, params=params)

        if df.empty:
            conn.close()
            return {
                "success": True,
                "metrics": {"total_discount": 0, "total_gross": 0, "discount_rate": 0, "total_transactions": 0, "avg_discount": 0},
                "chart_daily": [], "chart_category": [], "chart_outlet": [], "top_discounted_items": [],
                "all_data": [], "file_base64": "", "total_rows": 0,
            }

        for col in ['gross_amount_excl', 'discount', 'net_sales', 'gross_sales_all_incl']:
            df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)

        total_discount = float(df['discount'].sum())
        total_gross = float(df['gross_amount_excl'].sum())
        discount_rate = round(total_discount / total_gross * 100, 2) if total_gross > 0 else 0
        total_transactions = len(df)
        avg_discount = round(total_discount / total_transactions, 2) if total_transactions > 0 else 0

        metrics = {
            "total_discount": total_discount,
            "total_gross": total_gross,
            "discount_rate": discount_rate,
            "total_transactions": total_transactions,
            "avg_discount": avg_discount,
        }

        # Chart: Daily discount trend
        daily = df.groupby(df['date'].astype(str), as_index=False).agg({
            'discount': 'sum', 'gross_amount_excl': 'sum'
        }).sort_values('date')
        daily['discount_rate'] = (daily['discount'] / daily['gross_amount_excl'] * 100).round(2)
        chart_daily = daily.rename(columns={'date': 'date', 'discount': 'discount', 'gross_amount_excl': 'gross', 'discount_rate': 'rate'}).to_dict(orient='records')

        # Chart: Discount by category
        by_category = df.groupby('category', as_index=False).agg({'discount': 'sum', 'gross_amount_excl': 'sum'})
        by_category['rate'] = (by_category['discount'] / by_category['gross_amount_excl'] * 100).round(2)
        by_category = by_category.sort_values('discount', ascending=False).head(15)
        chart_category = by_category.to_dict(orient='records')

        # Chart: Discount by outlet
        by_outlet = df.groupby('outlet', as_index=False).agg({'discount': 'sum', 'gross_amount_excl': 'sum'})
        by_outlet['rate'] = (by_outlet['discount'] / by_outlet['gross_amount_excl'] * 100).round(2)
        by_outlet = by_outlet.sort_values('discount', ascending=False)
        chart_outlet = by_outlet.to_dict(orient='records')

        # Top discounted items
        by_item = df.groupby('item', as_index=False).agg({'discount': 'sum', 'gross_amount_excl': 'sum'})
        by_item['rate'] = (by_item['discount'] / by_item['gross_amount_excl'] * 100).round(2)
        by_item = by_item.sort_values('discount', ascending=False).head(20)
        top_discounted_items = by_item.to_dict(orient='records')

        conn.close()

        df['date'] = df['date'].astype(str)
        all_data = df.to_dict(orient='records')

        output = io.BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df.to_excel(writer, index=False, sheet_name='Discount Report')
        file_base64 = base64.b64encode(output.getvalue()).decode('utf-8')

        result = {
            "success": True,
            "metrics": metrics,
            "chart_daily": chart_daily,
            "chart_category": chart_category,
            "chart_outlet": chart_outlet,
            "top_discounted_items": top_discounted_items,
            "all_data": all_data,
            "file_base64": file_base64,
            "total_rows": len(df),
        }
        set_cached(ck, result)
        return result

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/merchant-bank-report")
async def get_merchant_bank_report(
    start_date: str = Query(..., description="Start date YYYY-MM-DD"),
    end_date: str = Query(..., description="End date YYYY-MM-DD"),
    bank: Optional[str] = Query(None, description="Filter by bank: bca, bri, or bni"),
):
    """Merchant Bank Report - BCA, BRI, and BNI transaction details with settlement info."""
    try:
        ck = cache_key("merchant-bank-report", start_date, end_date, bank)
        cached = get_cached(ck)
        if cached:
            return cached

        conn = psycopg2.connect(
            host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD,
        )

        # BCA transactions
        bca_df = pd.DataFrame()
        if not bank or bank == 'bca':
            bca_query = """
                SELECT
                    'BCA' as bank,
                    process_effective_date as trx_date,
                    merchant_payment_date as settle_date,
                    merchant_name,
                    terminal_id,
                    card_type,
                    gross_amount,
                    mdr_amount,
                    nett_amount,
                    transaction_code
                FROM bca_transactions
                WHERE process_effective_date >= %s AND process_effective_date <= %s
                ORDER BY process_effective_date DESC
            """
            bca_df = pd.read_sql(bca_query, conn, params=[start_date, end_date])

        # BRI transactions
        bri_df = pd.DataFrame()
        if not bank or bank == 'bri':
            bri_query = """
                SELECT
                    'BRI' as bank,
                    tgl_trx as trx_date,
                    tgl_setl as settle_date,
                    nama_merchant as merchant_name,
                    tid as terminal_id,
                    tipe as card_type,
                    amt_trx as gross_amount,
                    disc_amt as mdr_amount,
                    net_amt as nett_amount,
                    principle as transaction_code
                FROM bri_transactions
                WHERE tgl_trx >= %s AND tgl_trx <= %s
                ORDER BY tgl_trx DESC
            """
            bri_df = pd.read_sql(bri_query, conn, params=[start_date, end_date])

        # BNI transactions
        bni_df = pd.DataFrame()
        if not bank or bank == 'bni':
            bni_query = """
                SELECT
                    'BNI' as bank,
                    trx_date as trx_date,
                    proc_date as settle_date,
                    merchant_name,
                    tid as terminal_id,
                    type as card_type,
                    amount as gross_amount,
                    disc_amount as mdr_amount,
                    nett_amount,
                    jenis_trx as transaction_code
                FROM bni_transactions
                WHERE trx_date >= %s AND trx_date <= %s
                ORDER BY trx_date DESC
            """
            bni_df = pd.read_sql(bni_query, conn, params=[start_date, end_date])

        conn.close()

        # Combine
        df = pd.concat([bca_df, bri_df, bni_df], ignore_index=True)

        if df.empty:
            return {
                "success": True,
                "metrics": {"total_gross": 0, "total_mdr": 0, "total_nett": 0, "mdr_rate": 0, "total_transactions": 0, "bca_total": 0, "bri_total": 0, "bni_total": 0},
                "chart_daily": [], "chart_by_bank": [], "chart_by_card_type": [], "chart_settlement": [],
                "all_data": [], "file_base64": "", "total_rows": 0,
            }

        for col in ['gross_amount', 'mdr_amount', 'nett_amount']:
            df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)

        total_gross = float(df['gross_amount'].sum())
        total_mdr = float(df['mdr_amount'].sum())
        total_nett = float(df['nett_amount'].sum())
        mdr_rate = round(total_mdr / total_gross * 100, 2) if total_gross > 0 else 0
        bca_total = float(df[df['bank'] == 'BCA']['gross_amount'].sum())
        bri_total = float(df[df['bank'] == 'BRI']['gross_amount'].sum())
        bni_total = float(df[df['bank'] == 'BNI']['gross_amount'].sum())

        metrics = {
            "total_gross": total_gross,
            "total_mdr": total_mdr,
            "total_nett": total_nett,
            "mdr_rate": mdr_rate,
            "total_transactions": len(df),
            "bca_total": bca_total,
            "bri_total": bri_total,
            "bni_total": bni_total,
        }

        # Chart: Daily trend
        df['trx_date'] = pd.to_datetime(df['trx_date'], errors='coerce')
        daily = df.groupby(df['trx_date'].dt.strftime('%Y-%m-%d'), as_index=False).agg({
            'gross_amount': 'sum', 'mdr_amount': 'sum', 'nett_amount': 'sum'
        }).sort_values('trx_date')
        daily.columns = ['date', 'gross', 'mdr', 'nett']
        chart_daily = daily.to_dict(orient='records')

        # Chart: By bank
        by_bank = df.groupby('bank', as_index=False).agg({
            'gross_amount': 'sum', 'mdr_amount': 'sum', 'nett_amount': 'sum'
        })
        by_bank['mdr_rate'] = (by_bank['mdr_amount'] / by_bank['gross_amount'] * 100).round(2)
        chart_by_bank = by_bank.to_dict(orient='records')

        # Chart: By card type
        df['card_type'] = df['card_type'].fillna('Unknown').astype(str)
        by_card = df.groupby('card_type', as_index=False).agg({'gross_amount': 'sum', 'mdr_amount': 'sum'})
        by_card['mdr_rate'] = (by_card['mdr_amount'] / by_card['gross_amount'] * 100).round(2)
        by_card = by_card.sort_values('gross_amount', ascending=False).head(10)
        chart_by_card_type = by_card.to_dict(orient='records')

        # Chart: Settlement timeline (days between trx and settle)
        df['settle_date'] = pd.to_datetime(df['settle_date'], errors='coerce')
        df['settle_days'] = (df['settle_date'] - df['trx_date']).dt.days
        settle_dist = df[df['settle_days'].notna()].groupby('settle_days', as_index=False).agg({'gross_amount': 'sum'})
        settle_dist = settle_dist[settle_dist['settle_days'] >= 0].sort_values('settle_days').head(15)
        chart_settlement = settle_dist.rename(columns={'settle_days': 'days', 'gross_amount': 'amount'}).to_dict(orient='records')

        # Format for output
        df['trx_date'] = df['trx_date'].dt.strftime('%Y-%m-%d')
        df['settle_date'] = df['settle_date'].dt.strftime('%Y-%m-%d')
        df = df.drop(columns=['settle_days'], errors='ignore')
        all_data = df.fillna('').to_dict(orient='records')

        output = io.BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df.to_excel(writer, index=False, sheet_name='Merchant Bank Report')
        file_base64 = base64.b64encode(output.getvalue()).decode('utf-8')

        result = {
            "success": True,
            "metrics": metrics,
            "chart_daily": chart_daily,
            "chart_by_bank": chart_by_bank,
            "chart_by_card_type": chart_by_card_type,
            "chart_settlement": chart_settlement,
            "all_data": all_data,
            "file_base64": file_base64,
            "total_rows": len(df),
        }
        set_cached(ck, result)
        return result

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/transform/machine-rate-card")
async def transform_machine_rate_card(file: UploadFile = File(...)):
    if not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="Only .xlsx files are supported.")

    try:
        contents = await file.read()
        df = pd.read_excel(io.BytesIO(contents), header=None)

        if len(df.columns) < 3:
            raise HTTPException(status_code=400, detail=f"Expected at least 3 columns, got {len(df.columns)}")

        df = df.iloc[:, :3]
        df.columns = ['Machine Name', 'Player Side', 'Ticket Leak']

        df['Machine Name'] = df['Machine Name'].astype(str).str.strip()
        df['Player Side'] = df['Player Side'].astype(str).str.strip()
        df['Ticket Leak'] = pd.to_numeric(df['Ticket Leak'], errors='coerce').fillna(0)

        df = df[df['Machine Name'] != '']
        df = df[df['Machine Name'].str.lower() != 'nan']

        import numpy as np
        df = df.replace([np.inf, -np.inf], 0)
        df = df.fillna(0)

        card_data = df.to_dict(orient='records')

        return {
            "success": True,
            "card_data": card_data,
            "total_rows": len(df),
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/retail-sales")
async def get_retail_sales(
    start_date: str = Query(..., description="Start date YYYY-MM-DD"),
    end_date: str = Query(..., description="End date YYYY-MM-DD"),
):
    """Retail (JMH) Sales Report - BCA and BRI transactions for retail outlets."""
    try:
        ck = cache_key("retail-sales", start_date, end_date)
        cached = get_cached(ck)
        if cached:
            return cached

        conn = psycopg2.connect(
            host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD
        )

        # Outlet mapping for readable names
        outlet_map = {
            '2605': 'Mei 2026',
            '2606 CPP': 'Juni 2026 - Carstensz',
            '2606 SNP': 'Juni 2026 - Senayan',
            '2607 CPP': 'Juli 2026 - Carstensz',
            '2607 SNP': 'Juli 2026 - Senayan',
        }

        # BCA JMH transactions - only transactions with transaction_date filled
        bca_query = """
            SELECT
                process_effective_date as date,
                outlet,
                SUM(gross_amount) as bca
            FROM bca_jmh_transactions
            WHERE process_effective_date IS NOT NULL
              AND process_effective_date >= %s AND process_effective_date <= %s
              AND transaction_date IS NOT NULL AND transaction_date != ''
            GROUP BY process_effective_date, outlet
            ORDER BY process_effective_date, outlet
        """
        bca_df = pd.read_sql(bca_query, conn, params=[start_date, end_date])

        # BRI JMH transactions
        bri_query = """
            SELECT
                tgl_trx as date,
                outlet,
                SUM(amt_trx) as bri
            FROM bri_jmh_transactions
            WHERE tgl_trx IS NOT NULL
              AND tgl_trx >= %s AND tgl_trx <= %s
            GROUP BY tgl_trx, outlet
            ORDER BY tgl_trx, outlet
        """
        bri_df = pd.read_sql(bri_query, conn, params=[start_date, end_date])

        conn.close()

        # Calculate totals
        bca_total = float(bca_df['bca'].sum()) if not bca_df.empty else 0
        bri_total = float(bri_df['bri'].sum()) if not bri_df.empty else 0
        total_revenue = bca_total + bri_total

        # Daily trend (combined BCA + BRI)
        bca_df['date'] = pd.to_datetime(bca_df['date']) if not bca_df.empty else bca_df['date']
        bri_df['date'] = pd.to_datetime(bri_df['date']) if not bri_df.empty else bri_df['date']

        date_range = pd.date_range(start=start_date, end=end_date)
        daily_data = []
        for dt in date_range:
            bca_day = float(bca_df[bca_df['date'] == dt]['bca'].sum()) if not bca_df.empty else 0
            bri_day = float(bri_df[bri_df['date'] == dt]['bri'].sum()) if not bri_df.empty else 0
            if bca_day > 0 or bri_day > 0:
                daily_data.append({
                    'date': dt.strftime('%Y-%m-%d'),
                    'bca': bca_day,
                    'bri': bri_day,
                    'total': bca_day + bri_day,
                })

        # By outlet breakdown
        outlet_data = []
        all_outlets = set()
        if not bca_df.empty:
            all_outlets.update(bca_df['outlet'].unique())
        if not bri_df.empty:
            all_outlets.update(bri_df['outlet'].unique())

        for outlet in sorted(all_outlets):
            bca_outlet = float(bca_df[bca_df['outlet'] == outlet]['bca'].sum()) if not bca_df.empty else 0
            bri_outlet = float(bri_df[bri_df['outlet'] == outlet]['bri'].sum()) if not bri_df.empty else 0
            outlet_data.append({
                'outlet': outlet,
                'outlet_label': outlet_map.get(outlet, outlet),
                'bca': bca_outlet,
                'bri': bri_outlet,
                'total': bca_outlet + bri_outlet,
            })

        # Reconciliation table (date + outlet breakdown)
        recon_data = []
        for dt in date_range:
            for outlet in sorted(all_outlets):
                bca_val = float(bca_df[(bca_df['date'] == dt) & (bca_df['outlet'] == outlet)]['bca'].sum()) if not bca_df.empty else 0
                bri_val = float(bri_df[(bri_df['date'] == dt) & (bri_df['outlet'] == outlet)]['bri'].sum()) if not bri_df.empty else 0
                if bca_val > 0 or bri_val > 0:
                    recon_data.append({
                        'date': dt.strftime('%Y-%m-%d'),
                        'outlet': outlet,
                        'outlet_label': outlet_map.get(outlet, outlet),
                        'bca': bca_val,
                        'bri': bri_val,
                        'total': bca_val + bri_val,
                    })

        result = {
            "success": True,
            "metrics": {
                "total_revenue": total_revenue,
                "bca_total": bca_total,
                "bri_total": bri_total,
                "outlet_count": len(all_outlets),
            },
            "daily_data": daily_data,
            "outlet_data": outlet_data,
            "recon_data": recon_data,
            "totals": {
                "bca": bca_total,
                "bri": bri_total,
                "total": total_revenue,
            }
        }
        set_cached(ck, result)
        return result

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/retail-reconciliation")
async def get_retail_reconciliation(
    start_date: str = Query(..., description="Start date YYYY-MM-DD"),
    end_date: str = Query(..., description="End date YYYY-MM-DD"),
):
    """Retail Reconciliation: POS vs Bank (BCA JMH + BRI JMH) per store."""
    try:
        ck = cache_key("retail-reconciliation", start_date, end_date)
        cached = get_cached(ck)
        if cached:
            return cached

        conn = psycopg2.connect(
            host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD
        )

        # Store config: POS outlet -> store_name
        # OUTLET01 = Senayan (SNP), OUTLET02 = Carstensz (CPP)
        store_config = {
            'OUTLET01-Park Nickelodeon': 'Senayan Park (SNP)',
            'OUTLET02-Nickelodeon Theme Park Carstensz Mall': 'Carstensz Mall (CPP)',
        }

        # Retail categories in POS
        retail_cats = ('02-Retail', 'CPP-RETAIL-Carstensz Retail', 'SNP-RETAIL-SPARK Retail')

        all_rows = []

        for outlet_key, store_name in store_config.items():
            is_snp = 'OUTLET01' in outlet_key

            # POS Retail for this outlet
            pos_query = """
                SELECT DATE(business_date) as date, SUM(gross_sales_all_incl) as pos
                FROM pos_sales
                WHERE business_date >= %s AND business_date <= %s
                  AND outlet = %s AND category IN %s
                GROUP BY DATE(business_date)
            """
            pos_df = pd.read_sql(pos_query, conn, params=[
                start_date + " 00:00:00", end_date + " 23:59:59", outlet_key, retail_cats
            ])

            # BCA JMH: SNP pattern or CPP pattern
            if is_snp:
                bca_pattern = '%SNP%'
            else:
                bca_pattern = '%CPP%'

            bca_query = """
                SELECT process_effective_date as date, SUM(gross_amount) as bca
                FROM bca_jmh_transactions
                WHERE process_effective_date IS NOT NULL
                  AND process_effective_date >= %s AND process_effective_date <= %s
                  AND outlet LIKE %s
                  AND transaction_date IS NOT NULL AND transaction_date != ''
                GROUP BY process_effective_date
            """
            bca_df = pd.read_sql(bca_query, conn, params=[start_date, end_date, bca_pattern])

            # BRI JMH: map by merchant name, filter only MERCH (retail)
            # SPARK = SNP, CTZ/CARSTENSZ = CPP, unknown = SNP (default)
            if is_snp:
                bri_query = """
                    SELECT tgl_trx as date, SUM(amt_trx) as bri
                    FROM bri_jmh_transactions
                    WHERE tgl_trx IS NOT NULL
                      AND tgl_trx >= %s AND tgl_trx <= %s
                      AND UPPER(nama_merchant) LIKE '%%MERCH%%'
                      AND (UPPER(nama_merchant) LIKE '%%SPARK%%'
                           OR (UPPER(nama_merchant) NOT LIKE '%%CTZ%%'
                               AND UPPER(nama_merchant) NOT LIKE '%%CARSTENSZ%%'))
                    GROUP BY tgl_trx
                """
            else:
                bri_query = """
                    SELECT tgl_trx as date, SUM(amt_trx) as bri
                    FROM bri_jmh_transactions
                    WHERE tgl_trx IS NOT NULL
                      AND tgl_trx >= %s AND tgl_trx <= %s
                      AND UPPER(nama_merchant) LIKE '%%MERCH%%'
                      AND (UPPER(nama_merchant) LIKE '%%CTZ%%'
                           OR UPPER(nama_merchant) LIKE '%%CARSTENSZ%%')
                    GROUP BY tgl_trx
                """
            bri_df = pd.read_sql(bri_query, conn, params=[start_date, end_date])

            # Convert dates
            for df in [pos_df, bca_df, bri_df]:
                if not df.empty and 'date' in df.columns:
                    df['date'] = pd.to_datetime(df['date'])

            # Get all dates
            date_range = pd.date_range(start=start_date, end=end_date)

            for dt in date_range:
                pos_val = float(pos_df[pos_df['date'] == dt]['pos'].iloc[0]) if not pos_df.empty and len(pos_df[pos_df['date'] == dt]) > 0 else 0
                bca_val = float(bca_df[bca_df['date'] == dt]['bca'].iloc[0]) if not bca_df.empty and len(bca_df[bca_df['date'] == dt]) > 0 else 0
                bri_val = float(bri_df[bri_df['date'] == dt]['bri'].iloc[0]) if not bri_df.empty and len(bri_df[bri_df['date'] == dt]) > 0 else 0

                bank_total = bca_val + bri_val
                diff = pos_val - bank_total

                if pos_val > 0 or bank_total > 0:
                    all_rows.append({
                        'date': dt.strftime('%Y-%m-%d'),
                        'store': store_name,
                        'pos': pos_val,
                        'bca': bca_val,
                        'bri': bri_val,
                        'bank_total': bank_total,
                        'difference': diff,
                    })

        conn.close()

        # Sort by date, then store
        all_rows = sorted(all_rows, key=lambda x: (x['date'], x['store']))

        # Calculate totals
        totals = {
            'pos': sum(r['pos'] for r in all_rows),
            'bca': sum(r['bca'] for r in all_rows),
            'bri': sum(r['bri'] for r in all_rows),
            'bank_total': sum(r['bank_total'] for r in all_rows),
            'difference': sum(r['difference'] for r in all_rows),
        }

        result = {
            "success": True,
            "data": all_rows,
            "totals": totals,
        }
        set_cached(ck, result)
        return result

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


def build_item_summary_sheet(item_rows, title, period_label):
    """Susun sheet Item Summary: Item Name | [Store] | Quantity | Sales.

    item_rows: iterable dict berisi item, qty, sales, dan opsional store.
    Kolom Store hanya ditambahkan kalau datanya mencakup lebih dari satu
    store, supaya laporan satu outlet tetap berbentuk sama dengan contoh
    finance (Item Name | Quantity | Sales).
    """
    rows = [r for r in item_rows if r.get('item')]
    has_store = len({str(r.get('store') or '') for r in rows}) > 1
    headers = ['Item Name'] + (['Store'] if has_store else []) + ['Quantity', 'Sales']
    sheet_rows = [
        [title] + [None] * (len(headers) - 1),
        ['Periode :', period_label] + [None] * (len(headers) - 2),
        [None] * len(headers),
        headers,
    ]

    def to_int(value):
        try:
            return int(round(float(value)))
        except (TypeError, ValueError):
            return 0

    rows.sort(key=lambda r: (-to_int(r.get('sales')), str(r.get('item'))))
    # Total dihitung dari nilai mentah (bukan dari baris yang sudah dibulatkan)
    # supaya angkanya sama persis dengan total di sheet utamanya.
    total_qty = 0.0
    total_sales = 0.0
    for row in rows:
        qty = to_int(row.get('qty'))
        sales = to_int(row.get('sales'))
        total_qty += float(row.get('qty') or 0)
        total_sales += float(row.get('sales') or 0)
        line = [row.get('item')]
        if has_store:
            line.append(row.get('store'))
        line.extend([qty, sales])
        sheet_rows.append(line)

    sheet_rows.append([None] * len(headers))
    sheet_rows.append(
        ['TOTAL'] + ([None] if has_store else [])
        + [int(round(total_qty)), int(round(total_sales))]
    )
    return pd.DataFrame(sheet_rows)


@app.get("/api/combined-report")
async def get_combined_report(
    start_date: str = Query(..., description="Start date YYYY-MM-DD"),
    end_date: str = Query(..., description="End date YYYY-MM-DD"),
    reports: str = Query("sales,discount,merchant", description="Comma-separated: sales,discount,merchant"),
    outlets: str = Query(None, description="Comma-separated outlet names (empty = all outlets)"),
    channel: str = Query("walk_in", description="Sales channel: walk_in, all, blibli, tiketcom, website"),
):
    """Generate combined Excel report with multiple sheets matching finance format.

    Every sheet is broken down per store (outlet); results are never collapsed
    into a single "All Outlets" row. Bank figures (BRI/BCA/Nusapay) are matched
    to a store via the derived `outlet` column and restricted to ticketing
    revenue via `kategori = 'TICKET'`.
    """
    try:
        conn = psycopg2.connect(
            host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD
        )

        report_list = [r.strip().lower() for r in reports.split(",")]
        period_str = f"{start_date.replace('-', '/')} - {end_date.replace('-', '/')}"
        # Sheet yang diminta tapi dilewati karena formatnya tidak cocok dengan periode.
        skipped_reports: list = []

        # Optional outlet filter. When omitted, include every outlet, but always
        # group per outlet so stores are never merged together.
        if outlets:
            outlet_list = [o.strip() for o in outlets.split(",") if o.strip()]
        else:
            outlet_list = []

        if outlet_list:
            placeholders = ",".join(["%s"] * len(outlet_list))
            outlet_filter_sql = f"AND outlet IN ({placeholders})"
            outlet_params = outlet_list
        else:
            outlet_filter_sql = ""
            outlet_params = []

        # POS item filter: match ticket patterns (2jam/3jam/1comp/2comp/extra/birthday/field trip/promo/super fun) OR kaos kaki with gross > 0
        # CPP-ADD-Additional Ticket hanya untuk Companion — COIN, Pup Pup Boogie, DIY masuk Activity.
        item_filter = """
                          AND (
                              LOWER(item) ~ '2\\s*jam'
                              OR LOWER(item) ~ '3\\s*jam'
                              OR LOWER(item) ~ '1\\s*comp|companion\\s*1'
                              OR LOWER(item) ~ '2\\s*comp|companion\\s*2'
                              OR LOWER(item) ~ 'extra'
                              OR LOWER(item) ~ 'birthday'
                              OR LOWER(item) ~ 'field\\s*trip'
                              OR LOWER(item) ~ 'promo'
                              OR LOWER(item) ~ 'super\\s*fun'
                              OR ((item ~ '(XXS|XS|S|M|L)$' OR LOWER(item) ~ 'kaos\\s*kaki' OR LOWER(item) ~ 'rtl-soc') AND gross_sales_all_incl > 0)
                              OR (category_2 = 'CPP-ADD-Additional Ticket' AND LOWER(item) ~ 'companion')
                          )
        """
        # Channel filter
        if channel == "walk_in":
            item_filter += """
                          AND LOWER(item) NOT LIKE '%%blibli%%'
                          AND LOWER(item) NOT LIKE '%%tiketcom%%'
                          AND LOWER(item) NOT LIKE '%%tiket.com%%'
                          AND LOWER(item) NOT LIKE '%%tiket com%%'
                          AND LOWER(item) NOT LIKE '%%website%%'
                          AND LOWER(item) NOT LIKE '%%activity%%'
            """
        elif channel == "blibli":
            item_filter += " AND LOWER(item) LIKE '%%blibli%%'"
        elif channel == "tiketcom":
            item_filter += " AND (LOWER(item) LIKE '%%tiketcom%%' OR LOWER(item) LIKE '%%tiket.com%%' OR LOWER(item) LIKE '%%tiket com%%')"
        elif channel == "website":
            item_filter += " AND LOWER(item) LIKE '%%website%%'"
        elif channel == "retail_jmh":
            # For Retail JMH, override item_filter completely - no ticket patterns needed
            item_filter = ""
        # channel == "all" means no exclusion

        # Category filter - different for retail_jmh
        if channel == "retail_jmh":
            category_filter = "AND category = '02-Retail'"
        else:
            category_filter = "AND category IN ('01-Ticketing', 'TC01-Ticket Cartenz', 'SNP-TICKET-SPARK Ticket', 'CPP-TICKET-Carstensz Ticket', 'SNP-RETAIL-SPARK Retail', 'CPP-RETAIL-Carstensz Retail', 'SNP-BIRTHDAY-SPARK Birthday Package', 'CPP-BIRTHDAY-Carstensz Birthday Package', 'SNP-FIELDTRIP-SPARK Fieldtrip Package', 'CPP-FIELDTRIP-Carstensz Fieldtrip Package')"

        ts_params = [start_date + " 00:00:00", end_date + " 23:59:59"]

        output = io.BytesIO()
        sheets_written = False

        with pd.ExcelWriter(output, engine='openpyxl') as writer:

            # ===== SALES REPORT SHEET =====
            if 'sales' in report_list:
                # Platform label based on channel
                platform_label = 'Retail (JMH)' if channel == 'retail_jmh' else 'Walk In Ticket'

                pos_query = f"""
                    SELECT
                        DATE(business_date) as date,
                        CASE WHEN outlet ILIKE '%%Park Nickelodeon%%' THEN 'SNP'
                             WHEN outlet ILIKE '%%Carstensz%%' THEN 'CPP'
                             ELSE outlet END as store,
                        '{platform_label}' as platform,
                        SUM(gross_amount_excl) as gross_amount_excl,
                        SUM(discount) as discount,
                        SUM(net_sales) as net_sales,
                        SUM(tax) as tax,
                        SUM(charge) as charge,
                        SUM(gross_sales_all_incl) as gross_sales_all_incl
                    FROM pos_sales
                    WHERE business_date >= %s AND business_date <= %s
                      {outlet_filter_sql}
                      {category_filter}
                      {item_filter}
                    GROUP BY DATE(business_date), CASE WHEN outlet ILIKE '%%Park Nickelodeon%%' THEN 'SNP'
                             WHEN outlet ILIKE '%%Carstensz%%' THEN 'CPP'
                             ELSE outlet END
                    ORDER BY DATE(business_date), store
                """
                pos_df = pd.read_sql(pos_query, conn, params=ts_params + outlet_params)

                # Bank queries - different for retail_jmh channel
                if channel == 'retail_jmh':
                    # BRI JMH for retail
                    bri_query = """
                        SELECT tgl_trx as date,
                               CASE WHEN nama_merchant ILIKE '%%SPARK%%' THEN 'SNP'
                                    WHEN nama_merchant ILIKE '%%CTZ%%' THEN 'CPP'
                                    ELSE nama_merchant END as outlet,
                               SUM(amt_trx) as bri
                        FROM bri_jmh_transactions
                        WHERE tgl_trx IS NOT NULL AND tgl_trx >= %s AND tgl_trx <= %s
                          AND (nama_merchant ILIKE '%%MERCH%%' OR nama_merchant ILIKE '%%MERCHANDISE%%')
                        GROUP BY tgl_trx,
                                 CASE WHEN nama_merchant ILIKE '%%SPARK%%' THEN 'SNP'
                                      WHEN nama_merchant ILIKE '%%CTZ%%' THEN 'CPP'
                                      ELSE nama_merchant END
                    """
                    bri_df = pd.read_sql(bri_query, conn, params=[start_date, end_date])

                    # BCA JMH for retail
                    bca_query = """
                        SELECT process_effective_date as date,
                               CASE WHEN merchant_name ILIKE '%%SPARK%%' THEN 'SNP'
                                    WHEN merchant_name ILIKE '%%CTZ%%' THEN 'CPP'
                                    ELSE merchant_name END as outlet,
                               SUM(gross_amount) as bca
                        FROM bca_jmh_transactions
                        WHERE process_effective_date IS NOT NULL
                          AND process_effective_date >= %s AND process_effective_date <= %s
                          AND merchant_name ILIKE '%%MERCH%%'
                          AND transaction_date IS NOT NULL AND transaction_date != '' AND transaction_date != '00000000'
                          AND merchant_payment_status = 'PAID'
                        GROUP BY process_effective_date,
                                 CASE WHEN merchant_name ILIKE '%%SPARK%%' THEN 'SNP'
                                      WHEN merchant_name ILIKE '%%CTZ%%' THEN 'CPP'
                                      ELSE merchant_name END
                    """
                    bca_df = pd.read_sql(bca_query, conn, params=[start_date, end_date])

                    # BNI JMH for retail (tabel baru: bni_jmh_transactions)
                    bni_query = """
                        SELECT trx_date as date,
                               CASE WHEN merchant_name ILIKE '%%SPARK%%' THEN 'SNP'
                                    WHEN merchant_name ILIKE '%%CTZ%%' THEN 'CPP'
                                    ELSE merchant_name END as outlet,
                               SUM(amount) as bni
                        FROM bni_jmh_transactions
                        WHERE trx_date IS NOT NULL AND trx_date >= %s AND trx_date <= %s
                          AND merchant_name ILIKE '%%MERCH%%'
                        GROUP BY trx_date,
                                 CASE WHEN merchant_name ILIKE '%%SPARK%%' THEN 'SNP'
                                      WHEN merchant_name ILIKE '%%CTZ%%' THEN 'CPP'
                                      ELSE merchant_name END
                    """
                    bni_df = pd.read_sql(bni_query, conn, params=[start_date, end_date])

                    # No Nusapay, Deposit, Voucher for retail_jmh
                    nusapay_df = pd.DataFrame()
                    deposit_df = pd.DataFrame()
                    voucher_df = pd.DataFrame()
                else:
                    # Original bank queries for other channels
                    # BRI ticketing, per date + outlet
                    bri_query = f"""
                        SELECT tgl_trx as date,
                               CASE WHEN outlet ILIKE '%%Park Nickelodeon%%' THEN 'SNP'
                                    WHEN outlet ILIKE '%%Carstensz%%' THEN 'CPP'
                                    ELSE outlet END as outlet,
                               SUM(amt_trx) as bri
                        FROM bri_transactions
                        WHERE tgl_trx IS NOT NULL AND tgl_trx >= %s AND tgl_trx <= %s
                          AND kategori = 'TICKET'
                          {outlet_filter_sql}
                        GROUP BY tgl_trx, CASE WHEN outlet ILIKE '%%Park Nickelodeon%%' THEN 'SNP'
                                    WHEN outlet ILIKE '%%Carstensz%%' THEN 'CPP'
                                    ELSE outlet END
                    """
                    bri_df = pd.read_sql(bri_query, conn, params=[start_date, end_date] + outlet_params)

                    # BCA ticketing, real card payments settled/PAID, per date + outlet
                    bca_query = f"""
                        SELECT process_effective_date as date,
                               CASE WHEN outlet ILIKE '%%Park Nickelodeon%%' THEN 'SNP'
                                    WHEN outlet ILIKE '%%Carstensz%%' THEN 'CPP'
                                    ELSE outlet END as outlet,
                               SUM(gross_amount) as bca
                        FROM bca_transactions
                        WHERE process_effective_date IS NOT NULL AND process_effective_date >= %s AND process_effective_date <= %s
                          AND kategori = 'TICKET'
                          AND card_type <> ''
                          AND merchant_payment_status IN ('PAID', 'PEND')
                          {outlet_filter_sql}
                        GROUP BY process_effective_date, CASE WHEN outlet ILIKE '%%Park Nickelodeon%%' THEN 'SNP'
                                    WHEN outlet ILIKE '%%Carstensz%%' THEN 'CPP'
                                    ELSE outlet END
                    """
                    bca_df = pd.read_sql(bca_query, conn, params=[start_date, end_date] + outlet_params)

                    # BNI ticketing, per date + outlet
                    bni_query = f"""
                        SELECT trx_date as date,
                               CASE WHEN outlet ILIKE '%%Park Nickelodeon%%' THEN 'SNP'
                                    WHEN outlet ILIKE '%%Carstensz%%' THEN 'CPP'
                                    ELSE outlet END as outlet,
                               SUM(amount) as bni
                        FROM bni_transactions
                        WHERE trx_date IS NOT NULL AND trx_date >= %s AND trx_date <= %s
                          AND kategori = 'TICKET'
                          {outlet_filter_sql}
                        GROUP BY trx_date, CASE WHEN outlet ILIKE '%%Park Nickelodeon%%' THEN 'SNP'
                                    WHEN outlet ILIKE '%%Carstensz%%' THEN 'CPP'
                                    ELSE outlet END
                    """
                    bni_df = pd.read_sql(bni_query, conn, params=[start_date, end_date] + outlet_params)

                    # Nusapay: Walk In tickets with QRIS1-QRIS NUSA tender, per date + outlet
                    nusapay_query = f"""
                        SELECT DATE(business_date) as date,
                               CASE WHEN outlet ILIKE '%%Park Nickelodeon%%' THEN 'SNP'
                                    WHEN outlet ILIKE '%%Carstensz%%' THEN 'CPP'
                                    ELSE outlet END as outlet,
                               SUM(gross_sales_all_incl) as nusapay
                        FROM pos_sales
                        WHERE business_date >= %s AND business_date <= %s
                          {outlet_filter_sql}
                          {category_filter}
                          AND tender LIKE '%%QRIS1-QRIS NUSA%%'
                          {item_filter}
                        GROUP BY DATE(business_date), CASE WHEN outlet ILIKE '%%Park Nickelodeon%%' THEN 'SNP'
                                    WHEN outlet ILIKE '%%Carstensz%%' THEN 'CPP'
                                    ELSE outlet END
                    """
                    nusapay_df = pd.read_sql(nusapay_query, conn, params=ts_params + outlet_params)
                    # Periode NUSAPAY_DARI_TABEL: Nusapay dari tabel merchant, bukan POS.
                    nusapay_df = ganti_nusapay(
                        nusapay_df, conn,
                        [(k, v['walkin']) for k, v in NUSAPAY_SEGMEN.items()],
                        start_date, end_date, kolom_store='outlet')

                    # Deposit: tickets with DPS1-DEPOSIT tender, per date + outlet
                    deposit_query = f"""
                        SELECT DATE(business_date) as date,
                               CASE WHEN outlet ILIKE '%%Park Nickelodeon%%' THEN 'SNP'
                                    WHEN outlet ILIKE '%%Carstensz%%' THEN 'CPP'
                                    ELSE outlet END as outlet,
                               SUM(gross_sales_all_incl) as deposit
                        FROM pos_sales
                        WHERE business_date >= %s AND business_date <= %s
                          {outlet_filter_sql}
                          {category_filter}
                          AND tender LIKE '%%DPS1-DEPOSIT%%'
                          {item_filter}
                        GROUP BY DATE(business_date), CASE WHEN outlet ILIKE '%%Park Nickelodeon%%' THEN 'SNP'
                                    WHEN outlet ILIKE '%%Carstensz%%' THEN 'CPP'
                                    ELSE outlet END
                    """
                    deposit_df = pd.read_sql(deposit_query, conn, params=ts_params + outlet_params)

                    # Voucher: Tender Details menyimpan nominal per tender per bill,
                    # jadi bill yang dibayar campuran (mis. QRIS + VOUCHER) tidak
                    # dihitung penuh sebagai voucher seperti di pos_sales. Fallback
                    # ke pos_sales untuk tanggal/outlet yang belum ada datanya.
                    voucher_pos_query = f"""
                        SELECT DATE(business_date) as date,
                               CASE WHEN outlet ILIKE '%%Park Nickelodeon%%' THEN 'SNP'
                                    WHEN outlet ILIKE '%%Carstensz%%' THEN 'CPP'
                                    ELSE outlet END as outlet,
                               SUM(gross_sales_all_incl) as voucher
                        FROM pos_sales
                        WHERE business_date >= %s AND business_date <= %s
                          {outlet_filter_sql}
                          {category_filter}
                          AND LOWER(tender) LIKE '%%voucher%%'
                          {item_filter}
                        GROUP BY DATE(business_date), CASE WHEN outlet ILIKE '%%Park Nickelodeon%%' THEN 'SNP'
                                    WHEN outlet ILIKE '%%Carstensz%%' THEN 'CPP'
                                    ELSE outlet END
                    """
                    voucher_df = pd.read_sql(voucher_pos_query, conn, params=ts_params + outlet_params)

                    voucher_tender_query = f"""
                        SELECT business_date as date,
                               CASE WHEN outlet ILIKE '%%Park Nickelodeon%%' THEN 'SNP'
                                    WHEN outlet ILIKE '%%Carstensz%%' THEN 'CPP'
                                    ELSE outlet END as outlet,
                               SUM(tender_amount) as voucher
                        FROM pos_tender_details
                        WHERE business_date >= %s AND business_date <= %s
                          {outlet_filter_sql}
                          AND LOWER(tender) LIKE '%%voucher%%'
                        GROUP BY business_date, CASE WHEN outlet ILIKE '%%Park Nickelodeon%%' THEN 'SNP'
                                    WHEN outlet ILIKE '%%Carstensz%%' THEN 'CPP'
                                    ELSE outlet END
                    """
                    try:
                        voucher_tender_df = pd.read_sql(
                            voucher_tender_query,
                            conn,
                            params=[start_date, end_date] + outlet_params,
                        )
                    except Exception as e:
                        logger.warning(
                            "Tender Details voucher tidak tersedia, fallback ke POS: %s", e
                        )
                        voucher_tender_df = pd.DataFrame()

                    if not voucher_tender_df.empty:
                        voucher_df['date'] = pd.to_datetime(voucher_df['date'])
                        voucher_tender_df['date'] = pd.to_datetime(voucher_tender_df['date'])
                        # Tender Details menang untuk (date, outlet) yang ada;
                        # sisanya tetap memakai angka POS.
                        voucher_df = pd.concat(
                            [voucher_df, voucher_tender_df[['date', 'outlet', 'voucher']]],
                            ignore_index=True,
                        ).drop_duplicates(subset=['date', 'outlet'], keep='last')

                if not pos_df.empty:
                    pos_df['date'] = pd.to_datetime(pos_df['date'])
                    if not bri_df.empty:
                        bri_df['date'] = pd.to_datetime(bri_df['date'])
                        pos_df = pos_df.merge(
                            bri_df.rename(columns={'outlet': 'store'}), on=['date', 'store'], how='left')
                    else:
                        pos_df['bri'] = 0
                    if not bca_df.empty:
                        bca_df['date'] = pd.to_datetime(bca_df['date'])
                        pos_df = pos_df.merge(
                            bca_df.rename(columns={'outlet': 'store'}), on=['date', 'store'], how='left')
                    else:
                        pos_df['bca'] = 0
                    if not bni_df.empty:
                        bni_df['date'] = pd.to_datetime(bni_df['date'])
                        pos_df = pos_df.merge(
                            bni_df.rename(columns={'outlet': 'store'}), on=['date', 'store'], how='left')
                    else:
                        pos_df['bni'] = 0
                    if not nusapay_df.empty:
                        nusapay_df['date'] = pd.to_datetime(nusapay_df['date'])
                        pos_df = pos_df.merge(
                            nusapay_df.rename(columns={'outlet': 'store'}), on=['date', 'store'], how='left')
                    else:
                        pos_df['nusapay'] = 0
                    if not deposit_df.empty:
                        deposit_df['date'] = pd.to_datetime(deposit_df['date'])
                        pos_df = pos_df.merge(
                            deposit_df.rename(columns={'outlet': 'store'}), on=['date', 'store'], how='left')
                    else:
                        pos_df['deposit'] = 0
                    if not voucher_df.empty:
                        voucher_df['date'] = pd.to_datetime(voucher_df['date'])
                        pos_df = pos_df.merge(
                            voucher_df.rename(columns={'outlet': 'store'}), on=['date', 'store'], how='left')
                    else:
                        pos_df['voucher'] = 0

                    for col in ('bri', 'bca', 'bni', 'nusapay', 'deposit', 'voucher'):
                        if col not in pos_df.columns:
                            pos_df[col] = 0
                    pos_df = pos_df.fillna(0)
                    pos_df['total_bank'] = pos_df['bri'] + pos_df['bca'] + pos_df['bni'] + pos_df['nusapay'] + pos_df['deposit'] + pos_df['voucher']
                    pos_df['diff'] = pos_df['gross_sales_all_incl'] - pos_df['total_bank']
                    pos_df = pos_df.sort_values(['date', 'store']).reset_index(drop=True)

                    sales_rows = []
                    if channel == 'retail_jmh':
                        # Simplified header for Retail JMH - BCA JMH, BRI JMH, BNI JMH
                        sales_rows.append(['DAILY SALES REPORT - RETAIL (JMH)'] + [None] * 13)
                        sales_rows.append(['Periode :', period_str] + [None] * 12)
                        sales_rows.append([None] * 14)
                        sales_rows.append([None, None, None, 'POS', None, None, None, None, None, 'Bank JMH'] + [None] * 4)
                        sales_rows.append(['Date', 'Store', 'Platform', 'Gross Amount Excl.', 'Discount', 'Net Sales', 'Tax', 'Charge', 'Gross Sales (All incl)', 'BCA JMH', 'BRI JMH', 'BNI JMH', 'Total', 'Diff'])

                        for _, row in pos_df.iterrows():
                            sales_rows.append([
                                row['date'].strftime('%Y-%m-%d'),
                                row['store'],
                                row['platform'],
                                row['gross_amount_excl'],
                                row['discount'],
                                row['net_sales'],
                                row['tax'],
                                row['charge'],
                                row['gross_sales_all_incl'],
                                row['bca'],
                                row['bri'],
                                row['bni'],
                                row['bca'] + row['bri'] + row['bni'],
                                row['gross_sales_all_incl'] - (row['bca'] + row['bri'] + row['bni']),
                            ])

                        sales_rows.append([None] * 14)
                        sales_rows.append([None] * 14)
                        sales_rows.append([
                            None, 'TOTAL', None,
                            pos_df['gross_amount_excl'].sum(),
                            pos_df['discount'].sum(),
                            pos_df['net_sales'].sum(),
                            pos_df['tax'].sum(),
                            pos_df['charge'].sum(),
                            pos_df['gross_sales_all_incl'].sum(),
                            pos_df['bca'].sum(),
                            pos_df['bri'].sum(),
                            pos_df['bni'].sum(),
                            pos_df['bca'].sum() + pos_df['bri'].sum() + pos_df['bni'].sum(),
                            pos_df['gross_sales_all_incl'].sum() - (pos_df['bca'].sum() + pos_df['bri'].sum() + pos_df['bni'].sum()),
                        ])
                    else:
                        # Original header for other channels
                        sales_rows.append(['DAILY SALES REPORT'] + [None] * 15)
                        sales_rows.append(['Periode :', period_str] + [None] * 14)
                        sales_rows.append([None] * 16)
                        sales_rows.append([None, None, None, 'POS', None, None, None, None, None, 'Payment Method / Merchant Report'] + [None] * 7)
                        sales_rows.append(['Date', 'Store', 'Platform', 'Gross Amount Excl.', 'Discount', 'Net Sales', 'Tax', 'Charge', 'Gross Sales (All incl)', 'BRI', 'BCA', 'BNI', 'Nusapay', 'Deposit', 'Voucher', 'Total', 'Diff'])

                        for _, row in pos_df.iterrows():
                            sales_rows.append([
                                row['date'].strftime('%Y-%m-%d'),
                                row['store'],
                                row['platform'],
                                row['gross_amount_excl'],
                                row['discount'],
                                row['net_sales'],
                                row['tax'],
                                row['charge'],
                                row['gross_sales_all_incl'],
                                row['bri'],
                                row['bca'],
                                row['bni'],
                                row['nusapay'],
                                row['deposit'],
                                row['voucher'],
                                row['total_bank'],
                                row['diff'],
                            ])

                        sales_rows.append([None] * 17)
                        sales_rows.append([None] * 17)
                        sales_rows.append([
                            None, 'TOTAL', None,
                            pos_df['gross_amount_excl'].sum(),
                            pos_df['discount'].sum(),
                            pos_df['net_sales'].sum(),
                            pos_df['tax'].sum(),
                            pos_df['charge'].sum(),
                            pos_df['gross_sales_all_incl'].sum(),
                            pos_df['bri'].sum(),
                            pos_df['bca'].sum(),
                            pos_df['bni'].sum(),
                            pos_df['nusapay'].sum(),
                            pos_df['deposit'].sum(),
                            pos_df['voucher'].sum(),
                            pos_df['total_bank'].sum(),
                            pos_df['diff'].sum(),
                        ])

                    sales_sheet = pd.DataFrame(sales_rows)
                    sales_sheet.to_excel(writer, sheet_name='Sales Report', index=False, header=False)
                    sheets_written = True

                    # ===== SALES ITEM SUMMARY (sheet tambahan) =====
                    # Agregasi item-level dengan filter yang sama persis dengan
                    # sheet Sales Report, jadi total Sales = total Gross Sales
                    # (All incl) di sheet utamanya.
                    sales_item_query = f"""
                        SELECT
                            CASE WHEN outlet ILIKE '%%Park Nickelodeon%%' THEN 'SNP'
                                 WHEN outlet ILIKE '%%Carstensz%%' THEN 'CPP'
                                 ELSE outlet END as store,
                            item,
                            SUM(item_qty) as qty,
                            SUM(gross_sales_all_incl) as sales
                        FROM pos_sales
                        WHERE business_date >= %s AND business_date <= %s
                          {outlet_filter_sql}
                          {category_filter}
                          {item_filter}
                        GROUP BY 1, item
                    """
                    sales_item_df = pd.read_sql(
                        sales_item_query, conn, params=ts_params + outlet_params)
                    item_summary_sheet = build_item_summary_sheet(
                        sales_item_df.to_dict('records'),
                        f'Item Summary {platform_label}',
                        period_str,
                    )
                    item_summary_sheet.to_excel(
                        writer, sheet_name='Item Summary Sales',
                        index=False, header=False)

            # ===== DISCOUNT REPORT SHEET =====
            if 'discount' in report_list:
                # Platform label based on channel
                discount_platform_label = 'Retail (JMH)' if channel == 'retail_jmh' else 'Walk In Ticket'

                discount_query = f"""
                    SELECT
                        business_date as date,
                        CASE WHEN outlet ILIKE '%%Park Nickelodeon%%' THEN 'SNP'
                             WHEN outlet ILIKE '%%Carstensz%%' THEN 'CPP'
                             ELSE outlet END as store,
                        '{discount_platform_label}' as platform,
                        bill_no,
                        ROUND(SUM(discount * 1.1)) as total_discount,
                        MAX(remarks) as remark
                    FROM pos_sales
                    WHERE business_date >= %s AND business_date <= %s
                      {outlet_filter_sql}
                      {category_filter}
                      {item_filter}
                      AND discount > 0
                    GROUP BY business_date, CASE WHEN outlet ILIKE '%%Park Nickelodeon%%' THEN 'SNP'
                             WHEN outlet ILIKE '%%Carstensz%%' THEN 'CPP'
                             ELSE outlet END, bill_no
                    ORDER BY business_date, store, bill_no
                """
                discount_df = pd.read_sql(discount_query, conn, params=ts_params + outlet_params)

                discount_rows = []
                discount_rows.append(['DISCOUNT REPORT'] + [None] * 5)
                discount_rows.append(['Periode :', period_str] + [None] * 4)
                discount_rows.append([None] * 6)
                discount_rows.append(['Date', 'Store', 'Platform', 'No. Bill', 'Total Discount', 'Remark'])

                for _, row in discount_df.iterrows():
                    date_val = row['date']
                    if isinstance(date_val, pd.Timestamp):
                        date_val = date_val.strftime('%Y-%m-%d')
                    discount_rows.append([
                        date_val,
                        row['store'],
                        row['platform'],
                        row['bill_no'],
                        row['total_discount'],
                        row['remark'] if pd.notna(row['remark']) else None,
                    ])

                discount_sheet = pd.DataFrame(discount_rows)
                discount_sheet.to_excel(writer, sheet_name='Discount Report', index=False, header=False)
                sheets_written = True

            # ===== MERCHANT REPORT SHEET =====
            if 'merchant' in report_list:
                if channel == 'retail_jmh':
                    # Merchant Report for Retail JMH - BCA JMH, BRI JMH, BNI JMH
                    bri_merchant_query = """
                        SELECT
                            tgl_trx as date,
                            CASE WHEN nama_merchant ILIKE '%%SPARK%%' THEN 'SNP'
                                 WHEN nama_merchant ILIKE '%%CTZ%%' THEN 'CPP'
                                 ELSE nama_merchant END as store,
                            SUM(amt_trx) as amount,
                            SUM(disc_amt) as mdr,
                            SUM(net_amt) as net
                        FROM bri_jmh_transactions
                        WHERE tgl_trx IS NOT NULL AND tgl_trx >= %s AND tgl_trx <= %s
                          AND (nama_merchant ILIKE '%%MERCH%%' OR nama_merchant ILIKE '%%MERCHANDISE%%')
                        GROUP BY tgl_trx,
                                 CASE WHEN nama_merchant ILIKE '%%SPARK%%' THEN 'SNP'
                                      WHEN nama_merchant ILIKE '%%CTZ%%' THEN 'CPP'
                                      ELSE nama_merchant END
                    """
                    bri_merchant = pd.read_sql(bri_merchant_query, conn, params=[start_date, end_date])
                    if not bri_merchant.empty:
                        bri_merchant['date'] = pd.to_datetime(bri_merchant['date'])

                    bca_merchant_query = """
                        SELECT
                            process_effective_date as date,
                            CASE WHEN merchant_name ILIKE '%%SPARK%%' THEN 'SNP'
                                 WHEN merchant_name ILIKE '%%CTZ%%' THEN 'CPP'
                                 ELSE merchant_name END as store,
                            SUM(gross_amount) as amount,
                            SUM(mdr_amount) as mdr,
                            SUM(nett_amount) as net
                        FROM bca_jmh_transactions
                        WHERE process_effective_date IS NOT NULL
                          AND process_effective_date >= %s AND process_effective_date <= %s
                          AND merchant_name ILIKE '%%MERCH%%'
                          AND transaction_date IS NOT NULL AND transaction_date != '' AND transaction_date != '00000000'
                          AND merchant_payment_status = 'PAID'
                        GROUP BY process_effective_date,
                                 CASE WHEN merchant_name ILIKE '%%SPARK%%' THEN 'SNP'
                                      WHEN merchant_name ILIKE '%%CTZ%%' THEN 'CPP'
                                      ELSE merchant_name END
                    """
                    bca_merchant = pd.read_sql(bca_merchant_query, conn, params=[start_date, end_date])
                    if not bca_merchant.empty:
                        bca_merchant['date'] = pd.to_datetime(bca_merchant['date'])

                    # BNI JMH (tabel baru bni_jmh_transactions)
                    bni_merchant_query = """
                        SELECT
                            trx_date as date,
                            CASE WHEN merchant_name ILIKE '%%SPARK%%' THEN 'SNP'
                                 WHEN merchant_name ILIKE '%%CTZ%%' THEN 'CPP'
                                 ELSE merchant_name END as store,
                            SUM(amount) as amount,
                            SUM(disc_amount) as mdr,
                            SUM(nett_amount) as net
                        FROM bni_jmh_transactions
                        WHERE trx_date IS NOT NULL AND trx_date >= %s AND trx_date <= %s
                          AND merchant_name ILIKE '%%MERCH%%'
                        GROUP BY trx_date,
                                 CASE WHEN merchant_name ILIKE '%%SPARK%%' THEN 'SNP'
                                      WHEN merchant_name ILIKE '%%CTZ%%' THEN 'CPP'
                                      ELSE merchant_name END
                    """
                    bni_merchant = pd.read_sql(bni_merchant_query, conn, params=[start_date, end_date])
                    if not bni_merchant.empty:
                        bni_merchant['date'] = pd.to_datetime(bni_merchant['date'])

                    # Union keys
                    keys = set()
                    for dfm in (bri_merchant, bca_merchant, bni_merchant):
                        if not dfm.empty:
                            keys.update(zip(dfm['date'].tolist(), dfm['store'].tolist()))
                    keys = sorted(keys, key=lambda k: (k[0], k[1]))

                    def _lookup_jmh(dfm, date, store):
                        if dfm.empty:
                            return None
                        sub = dfm[(dfm['date'] == date) & (dfm['store'] == store)]
                        return sub.iloc[0] if len(sub) > 0 else None

                    merchant_rows = []
                    merchant_rows.append(['MERCHANT REPORT - RETAIL (JMH)'] + [None] * 14)
                    merchant_rows.append(['Periode :', period_str] + [None] * 13)
                    merchant_rows.append([None] * 15)
                    merchant_rows.append(['Date', 'Store', 'Platform', 'BCA JMH', None, None, 'BRI JMH', None, None, 'BNI JMH', None, None, 'TOTAL', None, None])
                    merchant_rows.append([None, None, None, 'Amount', 'MDR', 'Net Amount', 'Amount', 'MDR', 'Net Amount', 'Amount', 'MDR', 'Net Amount', 'Amount', 'MDR', 'Net Amount'])

                    totals = {
                        'bca_amt': 0, 'bca_mdr': 0, 'bca_net': 0,
                        'bri_amt': 0, 'bri_mdr': 0, 'bri_net': 0,
                        'bni_amt': 0, 'bni_mdr': 0, 'bni_net': 0,
                    }

                    for date, store in keys:
                        bri_row = _lookup_jmh(bri_merchant, date, store)
                        bca_row = _lookup_jmh(bca_merchant, date, store)
                        bni_row = _lookup_jmh(bni_merchant, date, store)

                        bri_amt = float(bri_row['amount']) if bri_row is not None else 0
                        bri_mdr = float(bri_row['mdr']) if bri_row is not None else 0
                        bri_net = float(bri_row['net']) if bri_row is not None else 0
                        bca_amt = float(bca_row['amount']) if bca_row is not None else 0
                        bca_mdr = float(bca_row['mdr']) if bca_row is not None else 0
                        bca_net = float(bca_row['net']) if bca_row is not None else 0
                        bni_amt = float(bni_row['amount']) if bni_row is not None else 0
                        bni_mdr = float(bni_row['mdr']) if bni_row is not None else 0
                        bni_net = float(bni_row['net']) if bni_row is not None else 0

                        totals['bri_amt'] += bri_amt
                        totals['bri_mdr'] += bri_mdr
                        totals['bri_net'] += bri_net
                        totals['bca_amt'] += bca_amt
                        totals['bca_mdr'] += bca_mdr
                        totals['bca_net'] += bca_net
                        totals['bni_amt'] += bni_amt
                        totals['bni_mdr'] += bni_mdr
                        totals['bni_net'] += bni_net

                        total_amt = bca_amt + bri_amt + bni_amt
                        total_mdr = bca_mdr + bri_mdr + bni_mdr
                        total_net = bca_net + bri_net + bni_net

                        merchant_rows.append([
                            date.strftime('%Y-%m-%d'),
                            store,
                            'Retail (JMH)',
                            bca_amt, bca_mdr, bca_net,
                            bri_amt, bri_mdr, bri_net,
                            bni_amt, bni_mdr, bni_net,
                            total_amt, total_mdr, total_net,
                        ])

                    merchant_rows.append([None] * 15)
                    merchant_rows.append([None] * 15)
                    total_all_amt = totals['bca_amt'] + totals['bri_amt'] + totals['bni_amt']
                    total_all_mdr = totals['bca_mdr'] + totals['bri_mdr'] + totals['bni_mdr']
                    total_all_net = totals['bca_net'] + totals['bri_net'] + totals['bni_net']
                    merchant_rows.append([
                        None, 'TOTAL', None,
                        totals['bca_amt'], totals['bca_mdr'], totals['bca_net'],
                        totals['bri_amt'], totals['bri_mdr'], totals['bri_net'],
                        totals['bni_amt'], totals['bni_mdr'], totals['bni_net'],
                        total_all_amt, total_all_mdr, total_all_net,
                    ])

                    merchant_sheet = pd.DataFrame(merchant_rows)
                    merchant_sheet.to_excel(writer, sheet_name='Merchant Report', index=False, header=False)
                    sheets_written = True
                else:
                    # Original Merchant Report for other channels
                    # BRI ticketing per date + outlet
                    bri_merchant_query = f"""
                        SELECT
                            tgl_trx as date,
                            CASE WHEN outlet = 'SNP-Senayan Park Nickelodeon Playtime'
                                 THEN 'OUTLET01-Park Nickelodeon'
                                 ELSE outlet END as store,
                            SUM(amt_trx) as amount,
                            SUM(disc_amt) as mdr
                        FROM bri_transactions
                        WHERE tgl_trx IS NOT NULL AND tgl_trx >= %s AND tgl_trx <= %s
                          AND kategori = 'TICKET'
                          {outlet_filter_sql}
                        GROUP BY tgl_trx, CASE WHEN outlet = 'SNP-Senayan Park Nickelodeon Playtime'
                                 THEN 'OUTLET01-Park Nickelodeon'
                                 ELSE outlet END
                    """
                    bri_merchant = pd.read_sql(bri_merchant_query, conn, params=[start_date, end_date] + outlet_params)
                    if not bri_merchant.empty:
                        bri_merchant['date'] = pd.to_datetime(bri_merchant['date'])
                        bri_merchant['net'] = bri_merchant['amount'] - bri_merchant['mdr']

                    # BCA ticketing, real card payments settled/PAID, per date + outlet
                    bca_merchant_query = f"""
                        SELECT
                            process_effective_date as date,
                            CASE WHEN outlet = 'SNP-Senayan Park Nickelodeon Playtime'
                                 THEN 'OUTLET01-Park Nickelodeon'
                                 ELSE outlet END as store,
                            SUM(gross_amount) as amount,
                            SUM(mdr_amount) as mdr,
                            SUM(nett_amount) as net
                        FROM bca_transactions
                        WHERE process_effective_date IS NOT NULL AND process_effective_date >= %s AND process_effective_date <= %s
                          AND kategori = 'TICKET'
                          AND card_type <> ''
                          AND merchant_payment_status IN ('PAID', 'PEND')
                          {outlet_filter_sql}
                        GROUP BY process_effective_date, CASE WHEN outlet = 'SNP-Senayan Park Nickelodeon Playtime'
                                 THEN 'OUTLET01-Park Nickelodeon'
                                 ELSE outlet END
                    """
                    bca_merchant = pd.read_sql(bca_merchant_query, conn, params=[start_date, end_date] + outlet_params)
                    if not bca_merchant.empty:
                        bca_merchant['date'] = pd.to_datetime(bca_merchant['date'])

                    # BNI ticketing per date + outlet
                    bni_merchant_query = f"""
                        SELECT
                            trx_date as date,
                            CASE WHEN outlet = 'SNP-Senayan Park Nickelodeon Playtime'
                                 THEN 'OUTLET01-Park Nickelodeon'
                                 ELSE outlet END as store,
                            SUM(amount) as amount,
                            SUM(disc_amount) as mdr,
                            SUM(nett_amount) as net
                        FROM bni_transactions
                        WHERE trx_date IS NOT NULL AND trx_date >= %s AND trx_date <= %s
                          AND kategori = 'TICKET'
                          {outlet_filter_sql}
                        GROUP BY trx_date, CASE WHEN outlet = 'SNP-Senayan Park Nickelodeon Playtime'
                                 THEN 'OUTLET01-Park Nickelodeon'
                                 ELSE outlet END
                    """
                    bni_merchant = pd.read_sql(bni_merchant_query, conn, params=[start_date, end_date] + outlet_params)
                    if not bni_merchant.empty:
                        bni_merchant['date'] = pd.to_datetime(bni_merchant['date'])

                    # Nusapay: Walk In tickets with QRIS1-QRIS NUSA tender - MDR rate 0.7%, per date + outlet
                    nusapay_merchant_query = f"""
                        SELECT
                            DATE(business_date) as date,
                            CASE WHEN outlet = 'SNP-Senayan Park Nickelodeon Playtime'
                                 THEN 'OUTLET01-Park Nickelodeon'
                                 ELSE outlet END as store,
                            SUM(gross_sales_all_incl) as amount
                        FROM pos_sales
                        WHERE business_date >= %s AND business_date <= %s
                          {outlet_filter_sql}
                          {category_filter}
                          AND tender LIKE '%%QRIS1-QRIS NUSA%%'
                          {item_filter}
                        GROUP BY DATE(business_date), CASE WHEN outlet = 'SNP-Senayan Park Nickelodeon Playtime'
                                 THEN 'OUTLET01-Park Nickelodeon'
                                 ELSE outlet END
                    """
                    nusapay_merchant = pd.read_sql(nusapay_merchant_query, conn, params=ts_params + outlet_params)
                    # Periode NUSAPAY_DARI_TABEL: Nusapay dari tabel merchant, bukan POS.
                    nusapay_merchant = ganti_nusapay(
                        nusapay_merchant, conn,
                        [(k, v['walkin']) for k, v in NUSAPAY_SEGMEN.items()],
                        start_date, end_date, kolom_store='store', kolom_nilai='amount')
                    if not nusapay_merchant.empty:
                        nusapay_merchant['date'] = pd.to_datetime(nusapay_merchant['date'])
                        nusapay_merchant['mdr'] = nusapay_merchant['amount'] * 0.007  # 0.7% MDR
                        nusapay_merchant['net'] = nusapay_merchant['amount'] - nusapay_merchant['mdr']

                    # Union of (date, store) keys across all four sources.
                    keys = set()
                    for dfm in (bri_merchant, bca_merchant, bni_merchant, nusapay_merchant):
                        if not dfm.empty:
                            keys.update(zip(dfm['date'].tolist(), dfm['store'].tolist()))
                    keys = sorted(keys, key=lambda k: (k[0], k[1]))

                    def _lookup(dfm, date, store):
                        if dfm.empty:
                            return None
                        sub = dfm[(dfm['date'] == date) & (dfm['store'] == store)]
                        return sub.iloc[0] if len(sub) > 0 else None

                    merchant_rows = []
                    merchant_rows.append(['MERCHANT REPORT'] + [None] * 20)
                    merchant_rows.append(['Periode :', period_str] + [None] * 19)
                    merchant_rows.append([None] * 21)
                    merchant_rows.append(['Date', 'Store', 'Platform', 'BRI', None, None, 'BCA', None, None, 'BNI', None, None, 'NUSAPAY', None, None, 'DEPOSIT', None, None, 'TOTAL', None, None])
                    merchant_rows.append([None, None, None, 'Amont Transaction', 'MDR', 'Net Amount', 'Amont Transaction', 'MDR', 'Net Amount', 'Amont Transaction', 'MDR', 'Net Amount', 'Amont Transaction', 'MDR', 'Net Amount', 'Amont Transaction', 'MDR', 'Net Amount', 'Amont Transaction', 'MDR', 'Net Amount'])

                    totals = {'bri_amt': 0, 'bri_mdr': 0, 'bri_net': 0, 'bca_amt': 0, 'bca_mdr': 0, 'bca_net': 0, 'bni_amt': 0, 'bni_mdr': 0, 'bni_net': 0, 'nusapay_amt': 0, 'nusapay_mdr': 0, 'nusapay_net': 0}

                    for date, store in keys:
                        bri_row = _lookup(bri_merchant, date, store)
                        bca_row = _lookup(bca_merchant, date, store)
                        bni_row = _lookup(bni_merchant, date, store)
                        nusapay_row = _lookup(nusapay_merchant, date, store)

                        bri_amt = float(bri_row['amount']) if bri_row is not None else 0
                        bri_mdr = float(bri_row['mdr']) if bri_row is not None else 0
                        bri_net = float(bri_row['net']) if bri_row is not None else 0
                        bca_amt = float(bca_row['amount']) if bca_row is not None else 0
                        bca_mdr = float(bca_row['mdr']) if bca_row is not None else 0
                        bca_net = float(bca_row['net']) if bca_row is not None else 0
                        bni_amt = float(bni_row['amount']) if bni_row is not None else 0
                        bni_mdr = float(bni_row['mdr']) if bni_row is not None else 0
                        bni_net = float(bni_row['net']) if bni_row is not None else 0
                        nusapay_amt = float(nusapay_row['amount']) if nusapay_row is not None else 0
                        nusapay_mdr = float(nusapay_row['mdr']) if nusapay_row is not None else 0
                        nusapay_net = float(nusapay_row['net']) if nusapay_row is not None else 0

                        totals['bri_amt'] += bri_amt
                        totals['bri_mdr'] += bri_mdr
                        totals['bri_net'] += bri_net
                        totals['bca_amt'] += bca_amt
                        totals['bca_mdr'] += bca_mdr
                        totals['bca_net'] += bca_net
                        totals['bni_amt'] += bni_amt
                        totals['bni_mdr'] += bni_mdr
                        totals['bni_net'] += bni_net
                        totals['nusapay_amt'] += nusapay_amt
                        totals['nusapay_mdr'] += nusapay_mdr
                        totals['nusapay_net'] += nusapay_net

                        total_amt = bri_amt + bca_amt + bni_amt + nusapay_amt
                        total_mdr = bri_mdr + bca_mdr + bni_mdr + nusapay_mdr
                        total_net = bri_net + bca_net + bni_net + nusapay_net

                        merchant_rows.append([
                            date.strftime('%Y-%m-%d'),
                            store,
                            'Walk In Ticket',
                            bri_amt, bri_mdr, bri_net,
                            bca_amt, bca_mdr, bca_net,
                            bni_amt, bni_mdr, bni_net,
                            nusapay_amt, nusapay_mdr, nusapay_net,
                            0, 0, 0,
                            total_amt, total_mdr, total_net,
                        ])

                    merchant_rows.append([None] * 21)
                    merchant_rows.append([None] * 21)
                    total_all_amt = totals['bri_amt'] + totals['bca_amt'] + totals['bni_amt'] + totals['nusapay_amt']
                    total_all_mdr = totals['bri_mdr'] + totals['bca_mdr'] + totals['bni_mdr'] + totals['nusapay_mdr']
                    total_all_net = totals['bri_net'] + totals['bca_net'] + totals['bni_net'] + totals['nusapay_net']
                    merchant_rows.append([
                        None, 'TOTAL', None,
                        totals['bri_amt'], totals['bri_mdr'], totals['bri_net'],
                        totals['bca_amt'], totals['bca_mdr'], totals['bca_net'],
                        totals['bni_amt'], totals['bni_mdr'], totals['bni_net'],
                        totals['nusapay_amt'], totals['nusapay_mdr'], totals['nusapay_net'],
                        0, 0, 0,
                        total_all_amt, total_all_mdr, total_all_net,
                    ])

                    merchant_sheet = pd.DataFrame(merchant_rows)
                    merchant_sheet.to_excel(writer, sheet_name='Merchant Report', index=False, header=False)
                    sheets_written = True

            # ===== CAFE / F&B SALES REPORT SHEET =====
            # Sheet F&B punya dua format yang terikat periode (lihat FNB_NEW_FORMAT_START):
            #   'cafe'     -> 'Cafe Sales Report', 20 kolom, periode sebelum Sep 2026
            #   'newsales' -> 'FNB New Report', 25 kolom, periode Sep 2026 ke atas
            # Sheet yang periodenya tidak cocok dilewati, dan alasannya ditulis di sheet 'Info'.
            fnb_wants = [r for r in ('newsales', 'cafe') if r in report_list]
            want_fnb_merchant = 'fnbmerchant' in report_list
            if fnb_wants or want_fnb_merchant:
                fnb_period_is_new = end_date >= FNB_NEW_FORMAT_START
                # Cafe mapping (lihat FNB_BUCKETS di atas): outlet -> nama cafe + bucket F&B
                cafe_config = FNB_BUCKETS

                # ===== FNB MERCHANT REPORT (sheet terpisah) =====
                # BRI/BCA/BNI memakai MDR asli dari file merchant (net = amount - mdr,
                # sudah diverifikasi). Nusapay dari POS tidak menyimpan MDR -> 0,7%.
                # Tidak terikat format F&B lama/baru; hanya periode yang menentukan data.
                fnb_merchant_rows = []
                fnb_merchant_rows.append(['MERCHANT REPORT'] + [None] * 20)
                fnb_merchant_rows.append(['Periode :', period_str] + [None] * 19)
                fnb_merchant_rows.append([None] * 21)
                fnb_merchant_rows.append(['Date', 'Store', 'Platform', 'BRI', None, None, 'BCA', None, None, 'BNI', None, None, 'NUSAPAY', None, None, 'DEPOSIT', None, None, 'TOTAL', None, None])
                fnb_merchant_rows.append([None, None, None, 'Amount Transaction', 'MDR', 'Net Amount', 'Amount Transaction', 'MDR', 'Net Amount', 'Amount Transaction', 'MDR', 'Net Amount', 'Amount Transaction', 'MDR', 'Net Amount', 'Amount Transaction', 'MDR', 'Net Amount', 'Amount Transaction', 'MDR', 'Net Amount'])

                totals_fnb_merchant = {
                    'bri_amt': 0, 'bri_mdr': 0, 'bri_net': 0,
                    'bca_amt': 0, 'bca_mdr': 0, 'bca_net': 0,
                    'bni_amt': 0, 'bni_mdr': 0, 'bni_net': 0,
                    'nusapay_amt': 0, 'nusapay_mdr': 0, 'nusapay_net': 0,
                    'deposit_amt': 0,
                }

                # Baris item-level untuk sheet Item Summary FNB (dikumpulkan
                # dari semua outlet di dalam loop di bawah).
                fnb_item_rows = []
                cafe_rows = []
                cafe_rows.append(['DAILY SALES REPORT'] + [None] * 24)
                cafe_rows.append(['Periode :', period_str] + [None] * 23)
                cafe_rows.append([None] * 25)
                cafe_rows.append([None, None, None, 'POS'] + [None] * 13 + ['Payment Method / Merchant Report'] + [None] * 7)
                cafe_rows.append([
                    'Date', 'Store', 'Platform',
                    'Gross Amount Excl (Food)', 'Gross Amount Excl (Beverage)', 'Gross Amount Excl (Packaging)',
                    'Discount (Food)', 'Discount (Beverage)', 'Discount (Packaging)',
                    'Net Sales (Food)', 'Net Sales (Beverage)', 'Net Sales (Packaging)',
                    'Service Charge (Food)', 'Service Charge (Beverage)', 'Service Charge (Packaging)',
                    'Tax', 'Gross Sales (All incl)',
                    'BRI', 'BCA', 'BNI', 'Nusapay', 'Deposit', 'Voucher', 'Total', 'Diff'
                ])

                totals_cafe = {
                    'gross_food': 0, 'gross_bev': 0, 'gross_pkg': 0,
                    'disc_food': 0, 'disc_bev': 0, 'disc_pkg': 0,
                    'net_food': 0, 'net_bev': 0, 'net_pkg': 0,
                    'charge_food': 0, 'charge_bev': 0, 'charge_pkg': 0,
                    'tax': 0, 'gross_all': 0,
                    'bri': 0, 'bca': 0, 'bni': 0, 'nusapay': 0, 'deposit': 0, 'voucher': 0
                }

                for outlet_key, cafe_info in cafe_config.items():
                    cafe_name = cafe_info['name']

                    food_clause, food_params = fnb_bucket_clause(
                        cafe_info['food_cats'], cafe_info.get('legacy_food_cats', ()))
                    bev_clause, bev_params = fnb_bucket_clause(
                        cafe_info['bev_cats'], cafe_info.get('legacy_bev_cats', ()))
                    pkg_clause, pkg_params = fnb_bucket_clause(cafe_info['pkg_cats'])
                    all_cats = (list(cafe_info['food_cats']) + list(cafe_info['bev_cats'])
                                + list(cafe_info['pkg_cats']))
                    all_legacy = (list(cafe_info.get('legacy_food_cats', ()))
                                  + list(cafe_info.get('legacy_bev_cats', ())))
                    all_clause, all_params = fnb_bucket_clause(tuple(all_cats), tuple(all_legacy))

                    def bucket_df(clause, clause_params):
                        """POS per hari untuk satu bucket (Food / Beverage / Packaging)."""
                        q = f"""
                            SELECT DATE(business_date) as date,
                                   SUM(gross_amount_excl) as gross_excl,
                                   SUM(discount) as discount,
                                   SUM(net_sales) as net_sales,
                                   SUM(charge) as charge,
                                   SUM(tax) as tax,
                                   SUM(gross_sales_all_incl) as gross_all
                            FROM pos_sales
                            WHERE business_date >= %s AND business_date <= %s
                              AND outlet = %s
                              AND {clause}
                            GROUP BY DATE(business_date)
                            ORDER BY date
                        """
                        return pd.read_sql(q, conn, params=[
                            start_date + " 00:00:00", end_date + " 23:59:59",
                            outlet_key] + clause_params)

                    # POS per bucket
                    food_df = bucket_df(food_clause, food_params)
                    bev_df = bucket_df(bev_clause, bev_params)
                    pkg_df = bucket_df(pkg_clause, pkg_params)

                    # Item-level untuk sheet Item Summary FNB: kategori sama
                    # dengan sheet FNB (Food + Beverage + Packaging).
                    fnb_item_query = f"""
                        SELECT item,
                               SUM(item_qty) as qty,
                               SUM(gross_sales_all_incl) as sales
                        FROM pos_sales
                        WHERE business_date >= %s AND business_date <= %s
                          AND outlet = %s
                          AND {all_clause}
                        GROUP BY item
                    """
                    fnb_item_df = pd.read_sql(
                        fnb_item_query, conn,
                        params=[start_date + " 00:00:00", end_date + " 23:59:59",
                                outlet_key] + all_params,
                    )
                    for _, item_row in fnb_item_df.iterrows():
                        fnb_item_rows.append({
                            'item': item_row['item'],
                            'store': cafe_name,
                            'qty': item_row['qty'],
                            'sales': item_row['sales'],
                        })

                    # BRI FNB for this outlet
                    bri_cafe_query = """
                        SELECT tgl_trx as date,
                               SUM(amt_trx) as bri,
                               COALESCE(SUM(disc_amt), 0) as bri_mdr,
                               COALESCE(SUM(net_amt), 0) as bri_net
                        FROM bri_transactions
                        WHERE tgl_trx IS NOT NULL AND tgl_trx >= %s AND tgl_trx <= %s
                          AND kategori = 'FNB' AND outlet = %s
                        GROUP BY tgl_trx
                    """
                    bri_cafe_df = pd.read_sql(bri_cafe_query, conn, params=[start_date, end_date, outlet_key])

                    # BCA FNB for this outlet
                    bca_cafe_query = """
                        SELECT process_effective_date as date,
                               SUM(gross_amount) as bca,
                               COALESCE(SUM(mdr_amount), 0) as bca_mdr,
                               COALESCE(SUM(nett_amount), 0) as bca_net
                        FROM bca_transactions
                        WHERE process_effective_date IS NOT NULL AND process_effective_date >= %s AND process_effective_date <= %s
                          AND kategori = 'FNB' AND outlet = %s
                          AND card_type <> '' AND merchant_payment_status IN ('PAID', 'PEND')
                        GROUP BY process_effective_date
                    """
                    bca_cafe_df = pd.read_sql(bca_cafe_query, conn, params=[start_date, end_date, outlet_key])

                    # BNI FNB for this outlet
                    bni_cafe_query = """
                        SELECT trx_date as date,
                               SUM(amount) as bni,
                               COALESCE(SUM(disc_amount), 0) as bni_mdr,
                               COALESCE(SUM(nett_amount), 0) as bni_net
                        FROM bni_transactions
                        WHERE trx_date IS NOT NULL AND trx_date >= %s AND trx_date <= %s
                          AND kategori = 'FNB' AND outlet = %s
                        GROUP BY trx_date
                    """
                    bni_cafe_df = pd.read_sql(bni_cafe_query, conn, params=[start_date, end_date, outlet_key])

                    # Nusapay FNB (from POS tender QRIS1-QRIS NUSA)
                    nusapay_cafe_query = f"""
                        SELECT DATE(business_date) as date, SUM(gross_sales_all_incl) as nusapay
                        FROM pos_sales
                        WHERE business_date >= %s AND business_date <= %s
                          AND outlet = %s AND {all_clause}
                          AND tender LIKE '%%QRIS1-QRIS NUSA%%'
                        GROUP BY DATE(business_date)
                    """
                    nusapay_cafe_df = pd.read_sql(nusapay_cafe_query, conn, params=[
                        start_date + " 00:00:00", end_date + " 23:59:59",
                        outlet_key] + all_params)
                    # Periode NUSAPAY_DARI_TABEL: Nusapay dari tabel merchant, bukan POS.
                    segmen_cafe = NUSAPAY_SEGMEN.get(outlet_key, {}).get('cafe')
                    if segmen_cafe:
                        nusapay_cafe_df = ganti_nusapay(
                            nusapay_cafe_df, conn, [(None, segmen_cafe)],
                            start_date, end_date)

                    # Deposit FNB
                    deposit_cafe_query = f"""
                        SELECT DATE(business_date) as date, SUM(gross_sales_all_incl) as deposit
                        FROM pos_sales
                        WHERE business_date >= %s AND business_date <= %s
                          AND outlet = %s AND {all_clause}
                          AND tender LIKE '%%DPS1-DEPOSIT%%'
                        GROUP BY DATE(business_date)
                    """
                    deposit_cafe_df = pd.read_sql(deposit_cafe_query, conn, params=[
                        start_date + " 00:00:00", end_date + " 23:59:59",
                        outlet_key] + all_params)

                    # Voucher FNB
                    voucher_cafe_query = f"""
                        SELECT DATE(business_date) as date, SUM(gross_sales_all_incl) as voucher
                        FROM pos_sales
                        WHERE business_date >= %s AND business_date <= %s
                          AND outlet = %s AND {all_clause}
                          AND LOWER(tender) LIKE '%%voucher%%'
                        GROUP BY DATE(business_date)
                    """
                    voucher_cafe_df = pd.read_sql(voucher_cafe_query, conn, params=[
                        start_date + " 00:00:00", end_date + " 23:59:59",
                        outlet_key] + all_params)

                    # Convert dates
                    for df in [food_df, bev_df, pkg_df, bri_cafe_df, bca_cafe_df, bni_cafe_df, nusapay_cafe_df, deposit_cafe_df, voucher_cafe_df]:
                        if not df.empty and 'date' in df.columns:
                            df['date'] = pd.to_datetime(df['date'])

                    # MDR/Net merchant bisa NULL kalau seluruh nilai di grup NULL
                    for dfm, mdr_cols in (
                        (bri_cafe_df, ('bri', 'bri_mdr', 'bri_net')),
                        (bca_cafe_df, ('bca', 'bca_mdr', 'bca_net')),
                        (bni_cafe_df, ('bni', 'bni_mdr', 'bni_net')),
                    ):
                        for col in mdr_cols:
                            if col in dfm.columns:
                                dfm[col] = dfm[col].fillna(0).astype(float)

                    # Get all dates from food, bev or packaging
                    all_dates = set()
                    if not food_df.empty:
                        all_dates.update(food_df['date'].tolist())
                    if not bev_df.empty:
                        all_dates.update(bev_df['date'].tolist())
                    if not pkg_df.empty:
                        all_dates.update(pkg_df['date'].tolist())
                    # Tanggal merchant bisa tidak punya baris POS (mis. settlement beda hari)
                    if want_fnb_merchant:
                        for dfm in (bri_cafe_df, bca_cafe_df, bni_cafe_df, nusapay_cafe_df, deposit_cafe_df):
                            if not dfm.empty:
                                all_dates.update(dfm['date'].tolist())
                    all_dates = sorted(all_dates)

                    for dt in all_dates:
                        food_row = food_df[food_df['date'] == dt].iloc[0] if not food_df.empty and len(food_df[food_df['date'] == dt]) > 0 else None
                        bev_row = bev_df[bev_df['date'] == dt].iloc[0] if not bev_df.empty and len(bev_df[bev_df['date'] == dt]) > 0 else None
                        pkg_row = pkg_df[pkg_df['date'] == dt].iloc[0] if not pkg_df.empty and len(pkg_df[pkg_df['date'] == dt]) > 0 else None

                        gross_food = float(food_row['gross_excl']) if food_row is not None else 0
                        gross_bev = float(bev_row['gross_excl']) if bev_row is not None else 0
                        gross_pkg = float(pkg_row['gross_excl']) if pkg_row is not None else 0
                        disc_food = float(food_row['discount']) if food_row is not None and pd.notna(food_row['discount']) else 0
                        disc_bev = float(bev_row['discount']) if bev_row is not None and pd.notna(bev_row['discount']) else 0
                        disc_pkg = float(pkg_row['discount']) if pkg_row is not None and pd.notna(pkg_row['discount']) else 0
                        net_food = float(food_row['net_sales']) if food_row is not None else 0
                        net_bev = float(bev_row['net_sales']) if bev_row is not None else 0
                        net_pkg = float(pkg_row['net_sales']) if pkg_row is not None else 0
                        charge_food = float(food_row['charge']) if food_row is not None and pd.notna(food_row['charge']) else 0
                        charge_bev = float(bev_row['charge']) if bev_row is not None and pd.notna(bev_row['charge']) else 0
                        charge_pkg = float(pkg_row['charge']) if pkg_row is not None and pd.notna(pkg_row['charge']) else 0
                        tax_food = float(food_row['tax']) if food_row is not None else 0
                        tax_bev = float(bev_row['tax']) if bev_row is not None else 0
                        tax_pkg = float(pkg_row['tax']) if pkg_row is not None else 0
                        tax_total = tax_food + tax_bev + tax_pkg
                        gross_all_food = float(food_row['gross_all']) if food_row is not None else 0
                        gross_all_bev = float(bev_row['gross_all']) if bev_row is not None else 0
                        gross_all_pkg = float(pkg_row['gross_all']) if pkg_row is not None else 0
                        gross_all = gross_all_food + gross_all_bev + gross_all_pkg

                        # Bank data
                        bri_row = bri_cafe_df[bri_cafe_df['date'] == dt] if not bri_cafe_df.empty else pd.DataFrame()
                        bca_row = bca_cafe_df[bca_cafe_df['date'] == dt] if not bca_cafe_df.empty else pd.DataFrame()
                        bni_row = bni_cafe_df[bni_cafe_df['date'] == dt] if not bni_cafe_df.empty else pd.DataFrame()
                        nusapay_row = nusapay_cafe_df[nusapay_cafe_df['date'] == dt] if not nusapay_cafe_df.empty else pd.DataFrame()
                        deposit_row = deposit_cafe_df[deposit_cafe_df['date'] == dt] if not deposit_cafe_df.empty else pd.DataFrame()
                        voucher_row = voucher_cafe_df[voucher_cafe_df['date'] == dt] if not voucher_cafe_df.empty else pd.DataFrame()

                        bri_val = float(bri_row['bri'].iloc[0]) if len(bri_row) > 0 else 0
                        bca_val = float(bca_row['bca'].iloc[0]) if len(bca_row) > 0 else 0
                        bni_val = float(bni_row['bni'].iloc[0]) if len(bni_row) > 0 else 0
                        nusapay_val = float(nusapay_row['nusapay'].iloc[0]) if len(nusapay_row) > 0 else 0
                        deposit_val = float(deposit_row['deposit'].iloc[0]) if len(deposit_row) > 0 else 0
                        voucher_val = float(voucher_row['voucher'].iloc[0]) if len(voucher_row) > 0 else 0

                        # ===== FNB MERCHANT REPORT (sheet terpisah) =====
                        if want_fnb_merchant:
                            bri_mdr = float(bri_row['bri_mdr'].iloc[0]) if len(bri_row) > 0 else 0
                            bri_net = float(bri_row['bri_net'].iloc[0]) if len(bri_row) > 0 else 0
                            bca_mdr = float(bca_row['bca_mdr'].iloc[0]) if len(bca_row) > 0 else 0
                            bca_net = float(bca_row['bca_net'].iloc[0]) if len(bca_row) > 0 else 0
                            bni_mdr = float(bni_row['bni_mdr'].iloc[0]) if len(bni_row) > 0 else 0
                            bni_net = float(bni_row['bni_net'].iloc[0]) if len(bni_row) > 0 else 0
                            nusapay_mdr = nusapay_val * 0.007  # POS tidak menyimpan MDR Nusapay
                            nusapay_net = nusapay_val - nusapay_mdr

                            merchant_amt = bri_val + bca_val + bni_val + nusapay_val + deposit_val
                            if merchant_amt > 0:
                                merchant_mdr = bri_mdr + bca_mdr + bni_mdr + nusapay_mdr
                                merchant_net = bri_net + bca_net + bni_net + nusapay_net + deposit_val
                                for key, val in (
                                    ('bri_amt', bri_val), ('bri_mdr', bri_mdr), ('bri_net', bri_net),
                                    ('bca_amt', bca_val), ('bca_mdr', bca_mdr), ('bca_net', bca_net),
                                    ('bni_amt', bni_val), ('bni_mdr', bni_mdr), ('bni_net', bni_net),
                                    ('nusapay_amt', nusapay_val), ('nusapay_mdr', nusapay_mdr),
                                    ('nusapay_net', nusapay_net), ('deposit_amt', deposit_val),
                                ):
                                    totals_fnb_merchant[key] += val
                                fnb_merchant_rows.append([
                                    dt.strftime('%Y-%m-%d'),
                                    cafe_name,
                                    'Food and Beverage',
                                    bri_val if bri_val else None,
                                    bri_mdr if bri_mdr else None,
                                    bri_net if bri_net else None,
                                    bca_val if bca_val else None,
                                    bca_mdr if bca_mdr else None,
                                    bca_net if bca_net else None,
                                    bni_val if bni_val else None,
                                    bni_mdr if bni_mdr else None,
                                    bni_net if bni_net else None,
                                    nusapay_val if nusapay_val else None,
                                    nusapay_mdr if nusapay_mdr else None,
                                    nusapay_net if nusapay_net else None,
                                    deposit_val if deposit_val else None,
                                    None,
                                    deposit_val if deposit_val else None,
                                    merchant_amt, merchant_mdr, merchant_net,
                                ])

                        bank_total = bri_val + bca_val + bni_val + nusapay_val
                        diff = gross_all - bank_total - deposit_val - voucher_val

                        # Update totals
                        totals_cafe['gross_food'] += gross_food
                        totals_cafe['gross_bev'] += gross_bev
                        totals_cafe['gross_pkg'] += gross_pkg
                        totals_cafe['disc_food'] += disc_food
                        totals_cafe['disc_bev'] += disc_bev
                        totals_cafe['disc_pkg'] += disc_pkg
                        totals_cafe['net_food'] += net_food
                        totals_cafe['net_bev'] += net_bev
                        totals_cafe['net_pkg'] += net_pkg
                        totals_cafe['charge_food'] += charge_food
                        totals_cafe['charge_bev'] += charge_bev
                        totals_cafe['charge_pkg'] += charge_pkg
                        totals_cafe['tax'] += tax_total
                        totals_cafe['gross_all'] += gross_all
                        totals_cafe['bri'] += bri_val
                        totals_cafe['bca'] += bca_val
                        totals_cafe['bni'] += bni_val
                        totals_cafe['nusapay'] += nusapay_val
                        totals_cafe['deposit'] += deposit_val
                        totals_cafe['voucher'] += voucher_val

                        cafe_rows.append([
                            dt.strftime('%Y-%m-%d'),
                            cafe_name,
                            'Food and Beverage',
                            gross_food, gross_bev, gross_pkg,
                            disc_food if disc_food else None, disc_bev if disc_bev else None,
                            disc_pkg if disc_pkg else None,
                            net_food, net_bev, net_pkg,
                            charge_food, charge_bev, charge_pkg,
                            tax_total, gross_all,
                            bri_val if bri_val else None, bca_val if bca_val else None,
                            bni_val if bni_val else None,
                            nusapay_val if nusapay_val else None,
                            deposit_val if deposit_val else None, voucher_val if voucher_val else None,
                            bank_total + deposit_val + voucher_val, diff
                        ])

                # Add totals row
                cafe_rows.append([None] * 25)
                total_bank = totals_cafe['bri'] + totals_cafe['bca'] + totals_cafe['bni'] + totals_cafe['nusapay']
                total_all_payment = total_bank + totals_cafe['deposit'] + totals_cafe['voucher']
                total_diff = totals_cafe['gross_all'] - total_all_payment
                cafe_rows.append([
                    None, 'TOTAL', None,
                    totals_cafe['gross_food'], totals_cafe['gross_bev'], totals_cafe['gross_pkg'],
                    totals_cafe['disc_food'] if totals_cafe['disc_food'] else None,
                    totals_cafe['disc_bev'] if totals_cafe['disc_bev'] else None,
                    totals_cafe['disc_pkg'] if totals_cafe['disc_pkg'] else None,
                    totals_cafe['net_food'], totals_cafe['net_bev'], totals_cafe['net_pkg'],
                    totals_cafe['charge_food'], totals_cafe['charge_bev'], totals_cafe['charge_pkg'],
                    totals_cafe['tax'], totals_cafe['gross_all'],
                    totals_cafe['bri'], totals_cafe['bca'], totals_cafe['bni'], totals_cafe['nusapay'],
                    totals_cafe['deposit'], totals_cafe['voucher'],
                    total_all_payment, total_diff
                ])

                # Format baru (Sep 2026 ke atas)
                if 'newsales' in fnb_wants and fnb_period_is_new:
                    cafe_sheet = pd.DataFrame(cafe_rows)
                    cafe_sheet.to_excel(writer, sheet_name='FNB New Report', index=False, header=False)
                    sheets_written = True
                elif 'newsales' in fnb_wants:
                    skipped_reports.append((
                        'FNB New Report',
                        'Periode berakhir sebelum 01 Sep 2026, format baru belum berlaku. '
                        'Pakai sheet Cafe Sales Report.',
                    ))

                # Format lama (sebelum Sep 2026)
                if 'cafe' in fnb_wants and not fnb_period_is_new:
                    cafe_old_sheet = pd.DataFrame(fnb_old_layout(cafe_rows))
                    cafe_old_sheet.to_excel(writer, sheet_name='Cafe Sales Report', index=False, header=False)
                    sheets_written = True
                elif 'cafe' in fnb_wants:
                    skipped_reports.append((
                        'Cafe Sales Report',
                        'Periode 01 Sep 2026 ke atas sudah memakai Category 2 dan kolom Packaging, '
                        'format lama tidak bisa dibuat. Pakai sheet FNB New Report.',
                    ))

                # ===== FNB ITEM SUMMARY (sheet tambahan) =====
                fnb_sales_sheet_written = (
                    ('newsales' in fnb_wants and fnb_period_is_new)
                    or ('cafe' in fnb_wants and not fnb_period_is_new)
                )
                if fnb_item_rows and fnb_sales_sheet_written:
                    fnb_item_sheet = build_item_summary_sheet(
                        fnb_item_rows, 'Item Summary FNB', period_str)
                    fnb_item_sheet.to_excel(
                        writer, sheet_name='Item Summary FNB',
                        index=False, header=False)
                    sheets_written = True

                # ===== FNB MERCHANT REPORT (sheet terpisah) =====
                if want_fnb_merchant:
                    total_m_amt = (totals_fnb_merchant['bri_amt'] + totals_fnb_merchant['bca_amt']
                                   + totals_fnb_merchant['bni_amt'] + totals_fnb_merchant['nusapay_amt']
                                   + totals_fnb_merchant['deposit_amt'])
                    total_m_mdr = (totals_fnb_merchant['bri_mdr'] + totals_fnb_merchant['bca_mdr']
                                   + totals_fnb_merchant['bni_mdr'] + totals_fnb_merchant['nusapay_mdr'])
                    total_m_net = (totals_fnb_merchant['bri_net'] + totals_fnb_merchant['bca_net']
                                   + totals_fnb_merchant['bni_net'] + totals_fnb_merchant['nusapay_net']
                                   + totals_fnb_merchant['deposit_amt'])
                    fnb_merchant_rows.append([None] * 21)
                    fnb_merchant_rows.append([
                        None, 'TOTAL', None,
                        totals_fnb_merchant['bri_amt'], totals_fnb_merchant['bri_mdr'], totals_fnb_merchant['bri_net'],
                        totals_fnb_merchant['bca_amt'], totals_fnb_merchant['bca_mdr'], totals_fnb_merchant['bca_net'],
                        totals_fnb_merchant['bni_amt'], totals_fnb_merchant['bni_mdr'], totals_fnb_merchant['bni_net'],
                        totals_fnb_merchant['nusapay_amt'], totals_fnb_merchant['nusapay_mdr'], totals_fnb_merchant['nusapay_net'],
                        totals_fnb_merchant['deposit_amt'], 0, totals_fnb_merchant['deposit_amt'],
                        total_m_amt, total_m_mdr, total_m_net,
                    ])
                    fnb_merchant_sheet = pd.DataFrame(fnb_merchant_rows)
                    fnb_merchant_sheet.to_excel(writer, sheet_name='FNB Merchant Report', index=False, header=False)
                    sheets_written = True

            # ===== ACTIVITY SALES REPORT SHEET =====
            if 'activity' in report_list or 'activitymerchant' in report_list:
                # Activity item patterns
                activity_patterns = {
                    'mrs_puff': r'0101112004|puf-sim',
                    'pup_pup_boogie': r'pup\s*pup\s*boogie|pupb',
                    'diy_activity': r'diy|0101112001|0101112002',
                    'photo_printing': r'pho-pri',
                    'coin_changer': r'rtl-coin|snp-coin',
                }

                # Activity categories in database
                activity_categories = (
                    'SNP-ACTIVITY-SNP Activity DIY',
                    'CPP-TICKET-Carstensz Ticket',
                    '01-Ticketing',
                    'TC01-Ticket Cartenz',
                    'SNP-TICKET-SPARK Ticket',
                )

                activity_rows = []
                activity_rows.append(['DAILY SALES REPORT'] + [None] * 21)
                activity_rows.append(['Periode :', period_str] + [None] * 20)
                activity_rows.append([None] * 22)
                activity_rows.append([None, None, None, 'POS'] + [None] * 9 + ['Payment Method / Merchant Report'] + [None] * 8)
                activity_rows.append([
                    'Date', 'Store', 'Platform',
                    'Gross Amount Excl (Mrs. Puff)', 'Gross Amount Excl (Pup Pup Boogie)',
                    'Gross Amount Excl (DIY Activity)', 'Gross Amount Excl (Photo Printing)',
                    'Gross Amount Excl (Coin Changer)',
                    'Discount', 'Net Sales', 'Service Charge', 'Tax', 'Gross Sales (All incl)',
                    'BRI', 'BCA', 'BNI', 'Nusapay', 'Starthing', 'Deposit', 'Voucher', 'Total', 'Diff'
                ])

                totals_activity = {
                    'mrs_puff': 0, 'pup_pup_boogie': 0, 'diy_activity': 0,
                    'photo_printing': 0, 'coin_changer': 0,
                    'discount': 0, 'net_sales': 0, 'charge': 0, 'tax': 0, 'gross_all': 0,
                    'bri': 0, 'bca': 0, 'bni': 0, 'nusapay': 0, 'starthing': 0,
                    'deposit': 0, 'voucher': 0
                }

                # Baris item-level untuk sheet Item Summary Activity.
                activity_item_rows = []

                outlets_list_activity = ['OUTLET01-Park Nickelodeon', 'OUTLET02-Nickelodeon Theme Park Carstensz Mall']
                if outlet_list:
                    outlets_list_activity = [o for o in outlets_list_activity if o in outlet_list]

                for outlet_key in outlets_list_activity:
                    # Query for each activity type
                    activity_data = {}
                    for act_key, pattern in activity_patterns.items():
                        act_query = """
                            SELECT DATE(business_date) as date,
                                   SUM(gross_amount_excl) as gross_excl,
                                   SUM(discount) as discount,
                                   SUM(net_sales) as net_sales,
                                   SUM(charge) as charge,
                                   SUM(tax) as tax,
                                   SUM(gross_sales_all_incl) as gross_all
                            FROM pos_sales
                            WHERE business_date >= %s AND business_date <= %s
                              AND outlet = %s
                              AND LOWER(item) ~ %s
                            GROUP BY DATE(business_date)
                        """
                        act_df = pd.read_sql(act_query, conn, params=[
                            start_date + " 00:00:00", end_date + " 23:59:59",
                            outlet_key, pattern
                        ])
                        if not act_df.empty:
                            act_df['date'] = pd.to_datetime(act_df['date'])
                        activity_data[act_key] = act_df

                    # Item-level untuk sheet Item Summary Activity: pola item
                    # sama dengan kolom activity di sheet utamanya.
                    activity_item_query = """
                        SELECT item,
                               SUM(item_qty) as qty,
                               SUM(gross_sales_all_incl) as sales
                        FROM pos_sales
                        WHERE business_date >= %s AND business_date <= %s
                          AND outlet = %s
                          AND (LOWER(item) ~ %s OR LOWER(item) ~ %s OR LOWER(item) ~ %s
                               OR LOWER(item) ~ %s OR LOWER(item) ~ %s)
                        GROUP BY item
                    """
                    activity_item_df = pd.read_sql(activity_item_query, conn, params=[
                        start_date + " 00:00:00", end_date + " 23:59:59", outlet_key,
                        activity_patterns['mrs_puff'], activity_patterns['pup_pup_boogie'],
                        activity_patterns['diy_activity'], activity_patterns['photo_printing'],
                        activity_patterns['coin_changer']
                    ])
                    for _, item_row in activity_item_df.iterrows():
                        activity_item_rows.append({
                            'item': item_row['item'],
                            'store': outlet_key,
                            'qty': item_row['qty'],
                            'sales': item_row['sales'],
                        })

                    # Nusapay for activity items
                    nusapay_act_query = """
                        SELECT DATE(business_date) as date, SUM(gross_sales_all_incl) as nusapay
                        FROM pos_sales
                        WHERE business_date >= %s AND business_date <= %s
                          AND outlet = %s
                          AND (LOWER(item) ~ %s OR LOWER(item) ~ %s OR LOWER(item) ~ %s OR LOWER(item) ~ %s OR LOWER(item) ~ %s)
                          AND tender LIKE '%%QRIS1-QRIS NUSA%%'
                        GROUP BY DATE(business_date)
                    """
                    nusapay_act_df = pd.read_sql(nusapay_act_query, conn, params=[
                        start_date + " 00:00:00", end_date + " 23:59:59", outlet_key,
                        activity_patterns['mrs_puff'], activity_patterns['pup_pup_boogie'],
                        activity_patterns['diy_activity'], activity_patterns['photo_printing'],
                        activity_patterns['coin_changer']
                    ])
                    # Periode NUSAPAY_DARI_TABEL: Nusapay dari tabel merchant, bukan POS.
                    segmen_aktivitas = NUSAPAY_SEGMEN.get(outlet_key, {}).get('activity')
                    if segmen_aktivitas:
                        nusapay_act_df = ganti_nusapay(
                            nusapay_act_df, conn, [(None, segmen_aktivitas)],
                            start_date, end_date)
                    if not nusapay_act_df.empty:
                        nusapay_act_df['date'] = pd.to_datetime(nusapay_act_df['date'])

                    # BNI for activity items (from POS tender EDC_BNI or QRIS3-QRIS BNI)
                    bni_act_query = """
                        SELECT DATE(business_date) as date, SUM(gross_sales_all_incl) as bni
                        FROM pos_sales
                        WHERE business_date >= %s AND business_date <= %s
                          AND outlet = %s
                          AND (LOWER(item) ~ %s OR LOWER(item) ~ %s OR LOWER(item) ~ %s OR LOWER(item) ~ %s OR LOWER(item) ~ %s)
                          AND (tender LIKE '%%EDC_BNI%%' OR tender LIKE '%%QRIS3-QRIS BNI%%')
                        GROUP BY DATE(business_date)
                    """
                    bni_act_df = pd.read_sql(bni_act_query, conn, params=[
                        start_date + " 00:00:00", end_date + " 23:59:59", outlet_key,
                        activity_patterns['mrs_puff'], activity_patterns['pup_pup_boogie'],
                        activity_patterns['diy_activity'], activity_patterns['photo_printing'],
                        activity_patterns['coin_changer']
                    ])
                    if not bni_act_df.empty:
                        bni_act_df['date'] = pd.to_datetime(bni_act_df['date'])

                    # BRI for activity items. Taken from POS tenders, not from
                    # bri_transactions: kategori there is only FNB/TICKET.
                    bri_act_query = """
                        SELECT DATE(business_date) as date, SUM(gross_sales_all_incl) as bri
                        FROM pos_sales
                        WHERE business_date >= %s AND business_date <= %s
                          AND outlet = %s
                          AND (LOWER(item) ~ %s OR LOWER(item) ~ %s OR LOWER(item) ~ %s OR LOWER(item) ~ %s OR LOWER(item) ~ %s)
                          AND (tender LIKE '%%EDC_BRI%%' OR tender LIKE '%%QRIS-QRIS BRI%%'
                               OR tender LIKE '%%CC01-BRI%%' OR tender LIKE '%%CCARD2-BRI%%'
                               OR tender LIKE '%%DEBIT2-DEBIT BRI%%')
                        GROUP BY DATE(business_date)
                    """
                    bri_act_df = pd.read_sql(bri_act_query, conn, params=[
                        start_date + " 00:00:00", end_date + " 23:59:59", outlet_key,
                        activity_patterns['mrs_puff'], activity_patterns['pup_pup_boogie'],
                        activity_patterns['diy_activity'], activity_patterns['photo_printing'],
                        activity_patterns['coin_changer']
                    ])
                    if not bri_act_df.empty:
                        bri_act_df['date'] = pd.to_datetime(bri_act_df['date'])

                    # BCA for activity items
                    bca_act_query = """
                        SELECT DATE(business_date) as date, SUM(gross_sales_all_incl) as bca
                        FROM pos_sales
                        WHERE business_date >= %s AND business_date <= %s
                          AND outlet = %s
                          AND (LOWER(item) ~ %s OR LOWER(item) ~ %s OR LOWER(item) ~ %s OR LOWER(item) ~ %s OR LOWER(item) ~ %s)
                          AND (tender LIKE '%%EDC_BCA%%' OR tender LIKE '%%QRIS2-QRIS BCA%%'
                               OR tender LIKE '%%CC02-BCA%%' OR tender LIKE '%%CCARD1-Credit Card BCA%%'
                               OR tender LIKE '%%DEBIT1-DEBIT BCA%%')
                        GROUP BY DATE(business_date)
                    """
                    bca_act_df = pd.read_sql(bca_act_query, conn, params=[
                        start_date + " 00:00:00", end_date + " 23:59:59", outlet_key,
                        activity_patterns['mrs_puff'], activity_patterns['pup_pup_boogie'],
                        activity_patterns['diy_activity'], activity_patterns['photo_printing'],
                        activity_patterns['coin_changer']
                    ])
                    if not bca_act_df.empty:
                        bca_act_df['date'] = pd.to_datetime(bca_act_df['date'])

                    # Deposit for activity items
                    deposit_act_query = """
                        SELECT DATE(business_date) as date, SUM(gross_sales_all_incl) as deposit
                        FROM pos_sales
                        WHERE business_date >= %s AND business_date <= %s
                          AND outlet = %s
                          AND (LOWER(item) ~ %s OR LOWER(item) ~ %s OR LOWER(item) ~ %s OR LOWER(item) ~ %s OR LOWER(item) ~ %s)
                          AND tender LIKE '%%DPS1-DEPOSIT%%'
                        GROUP BY DATE(business_date)
                    """
                    deposit_act_df = pd.read_sql(deposit_act_query, conn, params=[
                        start_date + " 00:00:00", end_date + " 23:59:59", outlet_key,
                        activity_patterns['mrs_puff'], activity_patterns['pup_pup_boogie'],
                        activity_patterns['diy_activity'], activity_patterns['photo_printing'],
                        activity_patterns['coin_changer']
                    ])
                    if not deposit_act_df.empty:
                        deposit_act_df['date'] = pd.to_datetime(deposit_act_df['date'])

                    # Voucher for activity items
                    voucher_act_query = """
                        SELECT DATE(business_date) as date, SUM(gross_sales_all_incl) as voucher
                        FROM pos_sales
                        WHERE business_date >= %s AND business_date <= %s
                          AND outlet = %s
                          AND (LOWER(item) ~ %s OR LOWER(item) ~ %s OR LOWER(item) ~ %s OR LOWER(item) ~ %s OR LOWER(item) ~ %s)
                          AND LOWER(tender) LIKE '%%voucher%%'
                        GROUP BY DATE(business_date)
                    """
                    voucher_act_df = pd.read_sql(voucher_act_query, conn, params=[
                        start_date + " 00:00:00", end_date + " 23:59:59", outlet_key,
                        activity_patterns['mrs_puff'], activity_patterns['pup_pup_boogie'],
                        activity_patterns['diy_activity'], activity_patterns['photo_printing'],
                        activity_patterns['coin_changer']
                    ])
                    if not voucher_act_df.empty:
                        voucher_act_df['date'] = pd.to_datetime(voucher_act_df['date'])

                    # Starthing for activity items
                    starthing_act_query = """
                        SELECT DATE(business_date) as date, SUM(gross_sales_all_incl) as starthing
                        FROM pos_sales
                        WHERE business_date >= %s AND business_date <= %s
                          AND outlet = %s
                          AND (LOWER(item) ~ %s OR LOWER(item) ~ %s OR LOWER(item) ~ %s OR LOWER(item) ~ %s OR LOWER(item) ~ %s)
                          AND tender LIKE '%%STARTHING%%'
                        GROUP BY DATE(business_date)
                    """
                    starthing_act_df = pd.read_sql(starthing_act_query, conn, params=[
                        start_date + " 00:00:00", end_date + " 23:59:59", outlet_key,
                        activity_patterns['mrs_puff'], activity_patterns['pup_pup_boogie'],
                        activity_patterns['diy_activity'], activity_patterns['photo_printing'],
                        activity_patterns['coin_changer']
                    ])
                    if not starthing_act_df.empty:
                        starthing_act_df['date'] = pd.to_datetime(starthing_act_df['date'])

                    # Get all dates with activity data
                    all_dates = set()
                    for df in activity_data.values():
                        if not df.empty:
                            all_dates.update(df['date'].tolist())
                    all_dates = sorted(all_dates)

                    for dt in all_dates:
                        mrs_puff_row = activity_data['mrs_puff']
                        mrs_puff_val = float(mrs_puff_row[mrs_puff_row['date'] == dt]['gross_excl'].iloc[0]) if not mrs_puff_row.empty and len(mrs_puff_row[mrs_puff_row['date'] == dt]) > 0 else 0

                        pup_row = activity_data['pup_pup_boogie']
                        pup_val = float(pup_row[pup_row['date'] == dt]['gross_excl'].iloc[0]) if not pup_row.empty and len(pup_row[pup_row['date'] == dt]) > 0 else 0

                        diy_row = activity_data['diy_activity']
                        diy_val = float(diy_row[diy_row['date'] == dt]['gross_excl'].iloc[0]) if not diy_row.empty and len(diy_row[diy_row['date'] == dt]) > 0 else 0

                        photo_row = activity_data['photo_printing']
                        photo_val = float(photo_row[photo_row['date'] == dt]['gross_excl'].iloc[0]) if not photo_row.empty and len(photo_row[photo_row['date'] == dt]) > 0 else 0

                        coin_row = activity_data['coin_changer']
                        coin_val = float(coin_row[coin_row['date'] == dt]['gross_excl'].iloc[0]) if not coin_row.empty and len(coin_row[coin_row['date'] == dt]) > 0 else 0

                        # Sum totals from all activity types for this date
                        discount_total = 0
                        net_sales_total = 0
                        charge_total = 0
                        tax_total = 0
                        gross_all_total = 0
                        for df in activity_data.values():
                            if not df.empty and len(df[df['date'] == dt]) > 0:
                                row = df[df['date'] == dt].iloc[0]
                                discount_total += float(row['discount']) if pd.notna(row['discount']) else 0
                                net_sales_total += float(row['net_sales']) if pd.notna(row['net_sales']) else 0
                                charge_total += float(row['charge']) if pd.notna(row['charge']) else 0
                                tax_total += float(row['tax']) if pd.notna(row['tax']) else 0
                                gross_all_total += float(row['gross_all']) if pd.notna(row['gross_all']) else 0

                        # Bank data for activity, all taken from POS tenders
                        bri_val = float(bri_act_df[bri_act_df['date'] == dt]['bri'].iloc[0]) if not bri_act_df.empty and len(bri_act_df[bri_act_df['date'] == dt]) > 0 else 0
                        bca_val = float(bca_act_df[bca_act_df['date'] == dt]['bca'].iloc[0]) if not bca_act_df.empty and len(bca_act_df[bca_act_df['date'] == dt]) > 0 else 0
                        bni_val = float(bni_act_df[bni_act_df['date'] == dt]['bni'].iloc[0]) if not bni_act_df.empty and len(bni_act_df[bni_act_df['date'] == dt]) > 0 else 0
                        nusapay_val = float(nusapay_act_df[nusapay_act_df['date'] == dt]['nusapay'].iloc[0]) if not nusapay_act_df.empty and len(nusapay_act_df[nusapay_act_df['date'] == dt]) > 0 else 0
                        starthing_val = float(starthing_act_df[starthing_act_df['date'] == dt]['starthing'].iloc[0]) if not starthing_act_df.empty and len(starthing_act_df[starthing_act_df['date'] == dt]) > 0 else 0
                        deposit_val = float(deposit_act_df[deposit_act_df['date'] == dt]['deposit'].iloc[0]) if not deposit_act_df.empty and len(deposit_act_df[deposit_act_df['date'] == dt]) > 0 else 0
                        voucher_val = float(voucher_act_df[voucher_act_df['date'] == dt]['voucher'].iloc[0]) if not voucher_act_df.empty and len(voucher_act_df[voucher_act_df['date'] == dt]) > 0 else 0

                        bank_total = bri_val + bca_val + bni_val + nusapay_val
                        payment_total = bank_total + starthing_val + deposit_val + voucher_val
                        diff = gross_all_total - payment_total

                        # Update totals
                        totals_activity['mrs_puff'] += mrs_puff_val
                        totals_activity['pup_pup_boogie'] += pup_val
                        totals_activity['diy_activity'] += diy_val
                        totals_activity['photo_printing'] += photo_val
                        totals_activity['coin_changer'] += coin_val
                        totals_activity['discount'] += discount_total
                        totals_activity['net_sales'] += net_sales_total
                        totals_activity['charge'] += charge_total
                        totals_activity['tax'] += tax_total
                        totals_activity['gross_all'] += gross_all_total
                        totals_activity['bri'] += bri_val
                        totals_activity['bca'] += bca_val
                        totals_activity['bni'] += bni_val
                        totals_activity['nusapay'] += nusapay_val
                        totals_activity['starthing'] += starthing_val
                        totals_activity['deposit'] += deposit_val
                        totals_activity['voucher'] += voucher_val

                        activity_rows.append([
                            dt.strftime('%Y-%m-%d'),
                            outlet_key,
                            'Activity',
                            mrs_puff_val if mrs_puff_val else None,
                            pup_val if pup_val else None,
                            diy_val if diy_val else None,
                            photo_val if photo_val else None,
                            coin_val if coin_val else None,
                            discount_total if discount_total else None,
                            net_sales_total,
                            charge_total if charge_total else None,
                            tax_total if tax_total else None,
                            gross_all_total,
                            bri_val if bri_val else None,
                            bca_val if bca_val else None,
                            bni_val if bni_val else None,
                            nusapay_val if nusapay_val else None,
                            starthing_val if starthing_val else None,
                            deposit_val if deposit_val else 0,
                            voucher_val if voucher_val else 0,
                            payment_total,
                            diff
                        ])

                # Add totals row
                activity_rows.append([None] * 22)
                total_payment = totals_activity['bri'] + totals_activity['bca'] + totals_activity['bni'] + totals_activity['nusapay'] + totals_activity['starthing'] + totals_activity['deposit'] + totals_activity['voucher']
                total_diff = totals_activity['gross_all'] - total_payment
                activity_rows.append([
                    None, 'TOTAL', None,
                    totals_activity['mrs_puff'] if totals_activity['mrs_puff'] else 0,
                    totals_activity['pup_pup_boogie'] if totals_activity['pup_pup_boogie'] else 0,
                    totals_activity['diy_activity'] if totals_activity['diy_activity'] else None,
                    totals_activity['photo_printing'] if totals_activity['photo_printing'] else None,
                    totals_activity['coin_changer'] if totals_activity['coin_changer'] else None,
                    totals_activity['discount'] if totals_activity['discount'] else 0,
                    totals_activity['net_sales'],
                    totals_activity['charge'] if totals_activity['charge'] else 0,
                    totals_activity['tax'],
                    totals_activity['gross_all'],
                    totals_activity['bri'] if totals_activity['bri'] else 0,
                    totals_activity['bca'] if totals_activity['bca'] else 0,
                    totals_activity['bni'] if totals_activity['bni'] else 0,
                    totals_activity['nusapay'] if totals_activity['nusapay'] else 0,
                    totals_activity['starthing'] if totals_activity['starthing'] else 0,
                    totals_activity['deposit'] if totals_activity['deposit'] else 0,
                    totals_activity['voucher'] if totals_activity['voucher'] else 0,
                    total_payment,
                    total_diff
                ])

                # Activity Sales Report dan Activity Merchant Report dipisah:
                # masing-masing opsi Quick Export hanya menulis sheet-nya sendiri.
                if 'activity' in report_list:
                    activity_sheet = pd.DataFrame(activity_rows)
                    activity_sheet.to_excel(writer, sheet_name='Activity Sales Report', index=False, header=False)
                    sheets_written = True

                    # ===== ACTIVITY ITEM SUMMARY (sheet tambahan) =====
                    if activity_item_rows:
                        activity_item_sheet = build_item_summary_sheet(
                            activity_item_rows, 'Item Summary Activity', period_str)
                        activity_item_sheet.to_excel(
                            writer, sheet_name='Item Summary Activity',
                            index=False, header=False)

                # ===== ACTIVITY MERCHANT REPORT SHEET =====
                activity_merchant_rows = []
                activity_merchant_rows.append(['MERCHANT REPORT'] + [None] * 17)
                activity_merchant_rows.append(['Periode :', period_str] + [None] * 16)
                activity_merchant_rows.append([None] * 18)
                activity_merchant_rows.append(['Date', 'Store', 'Platform', 'BRI', None, None, 'BCA', None, None, 'NUSAPAY', None, None, 'DEPOSIT', None, None, 'TOTAL', None, None])
                activity_merchant_rows.append([None, None, None, 'Amount Transaction', 'MDR', 'Net Amount', 'Amount Transaction', 'MDR', 'Net Amount', 'Amount Transaction', 'MDR', 'Net Amount', 'Amount Transaction', 'MDR', 'Net Amount', 'Amount Transaction', 'MDR', 'Net Amount'])

                merchant_totals = {
                    'bri_amt': 0, 'bri_mdr': 0, 'bri_net': 0,
                    'bca_amt': 0, 'bca_mdr': 0, 'bca_net': 0,
                    'nusapay_amt': 0, 'nusapay_mdr': 0, 'nusapay_net': 0,
                    'deposit_amt': 0, 'deposit_mdr': 0, 'deposit_net': 0
                }

                activity_item_pattern = '0101112004|puf-sim|pup\s*pup\s*boogie|pupb|diy|0101112001|0101112002|pho-pri|rtl-coin|snp-coin'

                activity_date_range = pd.date_range(start=start_date, end=end_date)

                for outlet_key in outlets_list_activity:
                    # BRI for activity
                    bri_merch_query = """
                        SELECT DATE(business_date) as date, SUM(gross_sales_all_incl) as amount
                        FROM pos_sales
                        WHERE business_date >= %s AND business_date <= %s
                          AND outlet = %s
                          AND LOWER(item) ~ %s
                          AND tender LIKE '%%CC01-BRI%%'
                        GROUP BY DATE(business_date)
                    """
                    bri_merch_df = pd.read_sql(bri_merch_query, conn, params=[
                        start_date + " 00:00:00", end_date + " 23:59:59", outlet_key, activity_item_pattern
                    ])
                    if not bri_merch_df.empty:
                        bri_merch_df['date'] = pd.to_datetime(bri_merch_df['date'])

                    # BCA for activity
                    bca_merch_query = """
                        SELECT DATE(business_date) as date, SUM(gross_sales_all_incl) as amount
                        FROM pos_sales
                        WHERE business_date >= %s AND business_date <= %s
                          AND outlet = %s
                          AND LOWER(item) ~ %s
                          AND tender LIKE '%%CC02-BCA%%'
                        GROUP BY DATE(business_date)
                    """
                    bca_merch_df = pd.read_sql(bca_merch_query, conn, params=[
                        start_date + " 00:00:00", end_date + " 23:59:59", outlet_key, activity_item_pattern
                    ])
                    if not bca_merch_df.empty:
                        bca_merch_df['date'] = pd.to_datetime(bca_merch_df['date'])

                    # Nusapay for activity
                    nusapay_merch_query = """
                        SELECT DATE(business_date) as date, SUM(gross_sales_all_incl) as amount
                        FROM pos_sales
                        WHERE business_date >= %s AND business_date <= %s
                          AND outlet = %s
                          AND LOWER(item) ~ %s
                          AND tender LIKE '%%QRIS1-QRIS NUSA%%'
                        GROUP BY DATE(business_date)
                    """
                    nusapay_merch_df = pd.read_sql(nusapay_merch_query, conn, params=[
                        start_date + " 00:00:00", end_date + " 23:59:59", outlet_key, activity_item_pattern
                    ])
                    # Periode NUSAPAY_DARI_TABEL: Nusapay dari tabel merchant, bukan POS.
                    segmen_aktivitas_merch = NUSAPAY_SEGMEN.get(outlet_key, {}).get('activity')
                    if segmen_aktivitas_merch:
                        nusapay_merch_df = ganti_nusapay(
                            nusapay_merch_df, conn, [(None, segmen_aktivitas_merch)],
                            start_date, end_date, kolom_nilai='amount')
                    if not nusapay_merch_df.empty:
                        nusapay_merch_df['date'] = pd.to_datetime(nusapay_merch_df['date'])

                    # Deposit for activity
                    deposit_merch_query = """
                        SELECT DATE(business_date) as date, SUM(gross_sales_all_incl) as amount
                        FROM pos_sales
                        WHERE business_date >= %s AND business_date <= %s
                          AND outlet = %s
                          AND LOWER(item) ~ %s
                          AND tender LIKE '%%DPS1-DEPOSIT%%'
                        GROUP BY DATE(business_date)
                    """
                    deposit_merch_df = pd.read_sql(deposit_merch_query, conn, params=[
                        start_date + " 00:00:00", end_date + " 23:59:59", outlet_key, activity_item_pattern
                    ])
                    if not deposit_merch_df.empty:
                        deposit_merch_df['date'] = pd.to_datetime(deposit_merch_df['date'])

                    for dt in activity_date_range:
                        bri_amt = float(bri_merch_df[bri_merch_df['date'] == dt]['amount'].iloc[0]) if not bri_merch_df.empty and len(bri_merch_df[bri_merch_df['date'] == dt]) > 0 else 0
                        bri_mdr = bri_amt * 0.015  # 1.5% MDR for BRI
                        bri_net = bri_amt - bri_mdr

                        bca_amt = float(bca_merch_df[bca_merch_df['date'] == dt]['amount'].iloc[0]) if not bca_merch_df.empty and len(bca_merch_df[bca_merch_df['date'] == dt]) > 0 else 0
                        bca_mdr = bca_amt * 0.015  # 1.5% MDR for BCA
                        bca_net = bca_amt - bca_mdr

                        nusapay_amt = float(nusapay_merch_df[nusapay_merch_df['date'] == dt]['amount'].iloc[0]) if not nusapay_merch_df.empty and len(nusapay_merch_df[nusapay_merch_df['date'] == dt]) > 0 else 0
                        nusapay_mdr = nusapay_amt * 0.007  # 0.7% MDR
                        nusapay_net = nusapay_amt - nusapay_mdr

                        deposit_amt = float(deposit_merch_df[deposit_merch_df['date'] == dt]['amount'].iloc[0]) if not deposit_merch_df.empty and len(deposit_merch_df[deposit_merch_df['date'] == dt]) > 0 else 0
                        deposit_mdr = 0  # No MDR for deposit
                        deposit_net = deposit_amt - deposit_mdr

                        total_amt = bri_amt + bca_amt + nusapay_amt + deposit_amt
                        total_mdr = bri_mdr + bca_mdr + nusapay_mdr + deposit_mdr
                        total_net = bri_net + bca_net + nusapay_net + deposit_net

                        if total_amt > 0:
                            merchant_totals['bri_amt'] += bri_amt
                            merchant_totals['bri_mdr'] += bri_mdr
                            merchant_totals['bri_net'] += bri_net
                            merchant_totals['bca_amt'] += bca_amt
                            merchant_totals['bca_mdr'] += bca_mdr
                            merchant_totals['bca_net'] += bca_net
                            merchant_totals['nusapay_amt'] += nusapay_amt
                            merchant_totals['nusapay_mdr'] += nusapay_mdr
                            merchant_totals['nusapay_net'] += nusapay_net
                            merchant_totals['deposit_amt'] += deposit_amt
                            merchant_totals['deposit_mdr'] += deposit_mdr
                            merchant_totals['deposit_net'] += deposit_net

                            activity_merchant_rows.append([
                                dt.strftime('%Y-%m-%d'),
                                outlet_key,
                                'Activity',
                                bri_amt if bri_amt else None,
                                bri_mdr if bri_mdr else None,
                                bri_net if bri_net else None,
                                bca_amt if bca_amt else None,
                                bca_mdr if bca_mdr else None,
                                bca_net if bca_net else None,
                                nusapay_amt if nusapay_amt else None,
                                nusapay_mdr if nusapay_mdr else None,
                                nusapay_net if nusapay_net else None,
                                deposit_amt if deposit_amt else None,
                                deposit_mdr if deposit_mdr else None,
                                deposit_net if deposit_net else None,
                                total_amt,
                                total_mdr,
                                total_net
                            ])

                # Add totals row
                total_all_amt = merchant_totals['bri_amt'] + merchant_totals['bca_amt'] + merchant_totals['nusapay_amt'] + merchant_totals['deposit_amt']
                total_all_mdr = merchant_totals['bri_mdr'] + merchant_totals['bca_mdr'] + merchant_totals['nusapay_mdr'] + merchant_totals['deposit_mdr']
                total_all_net = merchant_totals['bri_net'] + merchant_totals['bca_net'] + merchant_totals['nusapay_net'] + merchant_totals['deposit_net']
                activity_merchant_rows.append([None] * 18)
                activity_merchant_rows.append([
                    None, 'TOTAL', None,
                    merchant_totals['bri_amt'] if merchant_totals['bri_amt'] else 0,
                    merchant_totals['bri_mdr'] if merchant_totals['bri_mdr'] else 0,
                    merchant_totals['bri_net'] if merchant_totals['bri_net'] else 0,
                    merchant_totals['bca_amt'] if merchant_totals['bca_amt'] else 0,
                    merchant_totals['bca_mdr'] if merchant_totals['bca_mdr'] else 0,
                    merchant_totals['bca_net'] if merchant_totals['bca_net'] else 0,
                    merchant_totals['nusapay_amt'] if merchant_totals['nusapay_amt'] else 0,
                    merchant_totals['nusapay_mdr'] if merchant_totals['nusapay_mdr'] else 0,
                    merchant_totals['nusapay_net'] if merchant_totals['nusapay_net'] else 0,
                    merchant_totals['deposit_amt'] if merchant_totals['deposit_amt'] else 0,
                    merchant_totals['deposit_mdr'] if merchant_totals['deposit_mdr'] else 0,
                    merchant_totals['deposit_net'] if merchant_totals['deposit_net'] else 0,
                    total_all_amt,
                    total_all_mdr,
                    total_all_net
                ])

                if 'activitymerchant' in report_list:
                    activity_merchant_sheet = pd.DataFrame(activity_merchant_rows)
                    activity_merchant_sheet.to_excel(writer, sheet_name='Activity Merchant Report', index=False, header=False)
                    sheets_written = True

            # ===== TIKET.COM REPORT SHEET =====
            if 'tiketcom' in report_list:
                # Get price list
                price_df = pd.read_sql("SELECT * FROM tiketcom_price_list", conn)
                price_lookup = {}
                for _, row in price_df.iterrows():
                    pattern = row['item_pattern'].replace('%', '')
                    price_lookup[pattern] = {
                        'gross_excl': float(row['gross_amount_excl']),
                        'net_sales': float(row['net_sales']),
                        'tax': float(row['tax']),
                        'gross_all_incl': float(row['gross_sales_all_incl']),
                    }

                # Filter item mengikuti isi tiketcom_price_list, bukan prefix 'TIK-'.
                # Sejak Okt 2026 ada item tiket.com yang tidak berawalan TIK-
                # (Pup-tastic Dessert Treat, Yum-Yum Bonus). Dengan cara ini item
                # baru cukup ditambah ke price list, tanpa perlu ubah query.
                if price_lookup:
                    tiketcom_item_filter = " OR ".join(["item LIKE %s"] * len(price_lookup))
                    tiketcom_item_params = [p + "%" for p in price_lookup.keys()]
                else:
                    tiketcom_item_filter = "FALSE"
                    tiketcom_item_params = []

                # Query POS for tiket.com items
                tiketcom_query = f"""
                    SELECT
                        business_date::date as date,
                        CASE WHEN outlet = 'SNP-Senayan Park Nickelodeon Playtime'
                             THEN 'OUTLET01-Park Nickelodeon'
                             ELSE outlet END as store,
                        item,
                        item_qty,
                        remarks
                    FROM pos_sales
                    WHERE ({tiketcom_item_filter})
                      AND business_date >= %s AND business_date <= %s
                      {outlet_filter_sql}
                    ORDER BY business_date, outlet, item
                """
                tiketcom_df = pd.read_sql(
                    tiketcom_query,
                    conn,
                    params=tiketcom_item_params + ts_params + outlet_params,
                )

                def get_discount_pct(remarks):
                    """Extract discount percentage from remarks. Returns 0 if no discount found."""
                    if not remarks:
                        return 0
                    r = str(remarks).lower()
                    # Pattern: "x%", "x %", "x persen", "disc x", "promo x"
                    match = re.search(r'(\d+)\s*%|(\d+)\s*persen|disc\s*(\d+)|promo\s*(\d+)', r)
                    if match:
                        for g in match.groups():
                            if g:
                                return int(g)
                    return 0

                def extract_order_id(remarks):
                    if not remarks:
                        return ''
                    match = re.search(r'(\d{10})', str(remarks))
                    return match.group(1) if match else str(remarks)

                def get_price_for_item(item):
                    for pattern, prices in price_lookup.items():
                        if item.startswith(pattern):
                            return prices
                    return None

                tiketcom_detail_rows = []
                for _, row in tiketcom_df.iterrows():
                    item = row['item']
                    qty = int(row['item_qty'])
                    remarks = row['remarks']

                    prices = get_price_for_item(item)
                    if not prices:
                        continue

                    discount_pct = get_discount_pct(remarks)
                    order_id = extract_order_id(remarks)

                    gross_excl = prices['gross_excl'] * qty
                    discount = gross_excl * (discount_pct / 100) if discount_pct > 0 else 0
                    net_sales = gross_excl - discount
                    tax = net_sales * 0.1
                    gross_all_incl = net_sales + tax

                    tiketcom_detail_rows.append({
                        'date': row['date'],
                        'store': row['store'],
                        'platform': 'Tiket.com',
                        'order_id': order_id,
                        'item': item,
                        'qty': qty,
                        'gross_excl': int(round(gross_excl)),
                        'discount': int(round(discount)),
                        'net_sales': int(round(net_sales)),
                        'tax': int(round(tax)),
                        'charge': 0,
                        'gross_all_incl': int(round(gross_all_incl)),
                    })

                if tiketcom_detail_rows:
                    tiketcom_detail_df = pd.DataFrame(tiketcom_detail_rows)

                    # === Detail Sheet ===
                    detail_sheet_rows = []
                    detail_sheet_rows.append(['DAILY SALES REPORT'] + [None] * 11)
                    detail_sheet_rows.append(['Periode :', period_str] + [None] * 10)
                    detail_sheet_rows.append([None] * 12)
                    detail_sheet_rows.append(['Date', 'Store', 'Platform', 'Nomer Order ID', 'Item Description', 'Qty', 'Gross Amount Excl.', 'Discount', 'Net Sales', 'Tax', 'Charge', 'Gross Sales (All incl)'])

                    for _, row in tiketcom_detail_df.iterrows():
                        date_val = row['date']
                        if hasattr(date_val, 'strftime'):
                            date_val = date_val.strftime('%Y-%m-%d')
                        detail_sheet_rows.append([
                            date_val,
                            row['store'],
                            row['platform'],
                            row['order_id'],
                            row['item'],
                            row['qty'],
                            row['gross_excl'],
                            row['discount'],
                            row['net_sales'],
                            row['tax'],
                            row['charge'],
                            row['gross_all_incl'],
                        ])

                    detail_sheet = pd.DataFrame(detail_sheet_rows)
                    detail_sheet.to_excel(writer, sheet_name='Tiketcom Detail', index=False, header=False)

                    # === Rekapitulasi Sheet ===
                    summary_df = tiketcom_detail_df.groupby(['date', 'store']).agg({
                        'gross_excl': 'sum',
                        'discount': 'sum',
                        'net_sales': 'sum',
                        'tax': 'sum',
                        'charge': 'sum',
                        'gross_all_incl': 'sum',
                    }).reset_index()
                    summary_df = summary_df.sort_values(['date', 'store']).reset_index(drop=True)

                    rekap_sheet_rows = []
                    rekap_sheet_rows.append(['DAILY SALES REPORT'] + [None] * 8)
                    rekap_sheet_rows.append(['Periode :', period_str] + [None] * 7)
                    rekap_sheet_rows.append([None] * 9)
                    rekap_sheet_rows.append(['Date', 'Store', 'Platform', 'Gross Amount Excl.', 'Discount', 'Net Sales', 'Tax', 'Charge', 'Gross Sales (All incl)'])

                    for _, row in summary_df.iterrows():
                        date_val = row['date']
                        if hasattr(date_val, 'strftime'):
                            date_val = date_val.strftime('%Y-%m-%d')
                        rekap_sheet_rows.append([
                            date_val,
                            row['store'],
                            'Tiket.com',
                            row['gross_excl'],
                            row['discount'],
                            row['net_sales'],
                            row['tax'],
                            row['charge'],
                            row['gross_all_incl'],
                        ])

                    # Add totals
                    rekap_sheet_rows.append([None] * 9)
                    rekap_sheet_rows.append([
                        None, 'TOTAL', None,
                        summary_df['gross_excl'].sum(),
                        summary_df['discount'].sum(),
                        summary_df['net_sales'].sum(),
                        summary_df['tax'].sum(),
                        summary_df['charge'].sum(),
                        summary_df['gross_all_incl'].sum(),
                    ])

                    rekap_sheet = pd.DataFrame(rekap_sheet_rows)
                    rekap_sheet.to_excel(writer, sheet_name='Tiketcom Rekapitulasi', index=False, header=False)
                    sheets_written = True

                    # ===== TIKET.COM ITEM SUMMARY (sheet tambahan) =====
                    # Agregasi dari detail transaksi yang sama, jadi total Sales
                    # = total Gross Sales (All incl) di sheet Tiketcom Detail.
                    tiketcom_item_summary = (
                        tiketcom_detail_df
                        .groupby(['store', 'item'], as_index=False)
                        .agg({'qty': 'sum', 'gross_all_incl': 'sum'})
                        .rename(columns={'gross_all_incl': 'sales'})
                    )
                    tiketcom_item_sheet = build_item_summary_sheet(
                        tiketcom_item_summary.to_dict('records'),
                        'Item Summary Tiket.com', period_str)
                    tiketcom_item_sheet.to_excel(
                        writer, sheet_name='Item Summary Tiket.com',
                        index=False, header=False)

            # ===== NEW TIKET.COM REPORT SHEET (from new_tiket_transactions) =====
            if 'newtiketcom' in report_list:
                # Get price list
                new_price_df = pd.read_sql("SELECT product_name, package, price FROM new_tiket_price_list", conn)
                new_price_lookup = {}
                for _, row in new_price_df.iterrows():
                    key = (row['product_name'].strip(), row['package'].strip())
                    new_price_lookup[key] = float(row['price'])

                # Query transactions - filter by order_date
                new_tiket_query = """
                    SELECT
                        order_id, order_detail_id, order_date, visit_date, valid_until,
                        settlement_date, redemption_date, product_name, package,
                        COALESCE(child_total, 0) + COALESCE(pax_total, 0) as qty,
                        total_payment, refund_status
                    FROM new_tiket_transactions
                    WHERE order_date >= %s AND order_date < %s
                      AND settlement_status = 'Paid'
                    ORDER BY order_date, order_id
                """
                new_tiket_df = pd.read_sql(new_tiket_query, conn, params=[start_date + " 00:00:00", end_date + " 23:59:59"])

                def extract_discount_pct(package):
                    if not package:
                        return 0.0
                    match = re.search(r'DISC\s*(\d+)\s*%', package, re.IGNORECASE)
                    if match:
                        return float(match.group(1))
                    return 0.0

                def get_store_name(product_name):
                    if not product_name:
                        return "Unknown"
                    lower = product_name.lower()
                    if 'paw patrol' in lower:
                        return "PAW Patrol Playtime"
                    elif 'nickelodeon' in lower:
                        return "NICKELODEON PLAYTIME"
                    return product_name

                def get_status(redemption_date, valid_until, refund_status):
                    from datetime import datetime
                    if refund_status and 'refund' in str(refund_status).lower() and 'no refund' not in str(refund_status).lower():
                        return "Refunded"
                    if redemption_date and pd.notna(redemption_date):
                        return "Redeemed"
                    if valid_until and pd.notna(valid_until):
                        try:
                            valid_dt = pd.to_datetime(valid_until)
                            if valid_dt < datetime.now():
                                return "Expired"
                        except:
                            pass
                    return "Available"

                new_tiket_rows = []
                for _, row in new_tiket_df.iterrows():
                    product_name = str(row['product_name']).strip() if row['product_name'] else ""
                    package = str(row['package']).strip() if row['package'] else ""
                    qty = int(row['qty']) if row['qty'] and row['qty'] > 0 else 1

                    price_key = (product_name, package)
                    price = new_price_lookup.get(price_key, 0)

                    gross_sales = price * qty
                    discount_pct = extract_discount_pct(package)
                    discount_amount = gross_sales * (discount_pct / 100)
                    nett_sales = gross_sales - discount_amount
                    actual_total_payment = float(row['total_payment']) if row['total_payment'] else 0
                    fee = nett_sales - actual_total_payment

                    store_name = get_store_name(product_name)

                    # Calculate valid_until: if empty, use visit_date + 7 days
                    valid_until = row['valid_until']
                    if pd.isna(valid_until) and pd.notna(row['visit_date']):
                        valid_until = pd.to_datetime(row['visit_date']) + pd.Timedelta(days=7)

                    status = get_status(row['redemption_date'], valid_until, row['refund_status'])

                    new_tiket_rows.append({
                        'order_id': row['order_id'],
                        'order_detail_id': row['order_detail_id'],
                        'order_date': row['order_date'],
                        'visit_date': row['visit_date'],
                        'valid_until_date': valid_until,
                        'settlement_date': row['settlement_date'],
                        'redeem_date': row['redemption_date'] if pd.notna(row['redemption_date']) else None,
                        'store': store_name,
                        'package': package,
                        'qty': qty,
                        'price': price,
                        'gross_sales': gross_sales,
                        'discount_pct': discount_pct,
                        'discount_amount': discount_amount,
                        'nett_sales': nett_sales,
                        'fee': fee,
                        'total_payment': actual_total_payment,
                        'status': status,
                    })

                if new_tiket_rows:
                    new_tiket_detail_df = pd.DataFrame(new_tiket_rows)

                    # === Detail Sheet ===
                    detail_rows = []
                    detail_rows.append(['NEW TIKET.COM REPORT'] + [None] * 17)
                    detail_rows.append(['Periode :', period_str] + [None] * 16)
                    detail_rows.append([None] * 18)
                    detail_rows.append([
                        'Order ID', 'Order Detail ID', 'Order Date', 'Visit Date', 'Valid Until Date',
                        'Settlement Date', 'Redeem Date', 'Store', 'Package', 'Qty', 'Price',
                        'Gross Sales', 'Discount %', 'Discount Amount', 'Nett Sales', 'Fee', 'Total Payment', 'Status'
                    ])

                    for _, row in new_tiket_detail_df.iterrows():
                        def fmt_date(d):
                            # Semua tanggal di Quick Export tampil sebagai yyyy-mm-dd.
                            if d is None or pd.isna(d):
                                return ''
                            if hasattr(d, 'strftime'):
                                return d.strftime('%Y-%m-%d')
                            return str(d) if d else ''

                        detail_rows.append([
                            row['order_id'],
                            row['order_detail_id'],
                            fmt_date(row['order_date']),
                            fmt_date(row['visit_date']),
                            fmt_date(row['valid_until_date']),
                            fmt_date(row['settlement_date']),
                            fmt_date(row['redeem_date']),
                            row['store'],
                            row['package'],
                            row['qty'],
                            row['price'],
                            row['gross_sales'],
                            f"{row['discount_pct']}%",
                            row['discount_amount'],
                            row['nett_sales'],
                            row['fee'],
                            row['total_payment'],
                            row['status'],
                        ])

                    # Add totals
                    detail_rows.append([None] * 18)
                    detail_rows.append([
                        None, None, None, None, None, None, None, None, 'TOTAL',
                        int(new_tiket_detail_df['qty'].sum()),
                        None,
                        int(new_tiket_detail_df['gross_sales'].sum()),
                        None,
                        int(new_tiket_detail_df['discount_amount'].sum()),
                        int(new_tiket_detail_df['nett_sales'].sum()),
                        int(new_tiket_detail_df['fee'].sum()),
                        int(new_tiket_detail_df['total_payment'].sum()),
                        None,
                    ])

                    detail_sheet = pd.DataFrame(detail_rows)
                    detail_sheet.to_excel(writer, sheet_name='New Tiketcom', index=False, header=False)
                    sheets_written = True

                    # ===== ALL TRANSACTION TIKET.COM ITEM SUMMARY =====
                    # Item = Package (sama dengan kolom Package di sheet detail),
                    # Sales = Gross Sales sebelum diskon.
                    new_item_summary = (
                        new_tiket_detail_df
                        .groupby(['store', 'package'], as_index=False)
                        .agg({'qty': 'sum', 'gross_sales': 'sum'})
                        .rename(columns={'package': 'item', 'gross_sales': 'sales'})
                    )
                    new_item_sheet = build_item_summary_sheet(
                        new_item_summary.to_dict('records'),
                        'Item Summary All Transaction Tiket.com', period_str)
                    new_item_sheet.to_excel(
                        writer, sheet_name='Item Summary All Txn Tiket.com',
                        index=False, header=False)

            # Sheet 'Info': catatan sheet yang dilewati + fallback kalau tidak ada
            # sheet sama sekali yang bisa dibuat.
            if skipped_reports or not sheets_written:
                info_rows = []
                if skipped_reports:
                    info_rows.append(['INFO - SHEET DILEWATI'])
                    info_rows.append([None])
                    for sheet_name, reason in skipped_reports:
                        info_rows.append([sheet_name, reason])
                    info_rows.append([None])
                if not sheets_written and not skipped_reports:
                    info_rows.append(['No data available'])
                info_df = pd.DataFrame(info_rows)
                info_df.to_excel(writer, sheet_name='Info', index=False, header=False)

        output.seek(0)
        file_base64 = base64.b64encode(output.read()).decode('utf-8')
        conn.close()

        return {
            "success": True,
            "file_base64": file_base64,
            "filename": f"Report_Mooboard_{start_date}_to_{end_date}.xlsx",
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/tiketcom-report")
async def get_tiketcom_report(
    start_date: str = Query(..., description="Start date YYYY-MM-DD"),
    end_date: str = Query(..., description="End date YYYY-MM-DD"),
    outlet: Optional[List[str]] = Query(None, description="Optional outlet filter (multi)"),
):
    """Tiket.com Report - POS transactions with calculated prices from tiketcom_price_list.

    Detects 27% discount from remarks field patterns:
    - '27%', '27 persen', 'promo 27', 'disc 27'
    """
    try:
        ck = cache_key("tiketcom-report", start_date, end_date, outlet)
        cached = get_cached(ck)
        if cached:
            return cached

        conn = psycopg2.connect(
            host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD
        )

        # Get price list
        price_df = pd.read_sql("SELECT * FROM tiketcom_price_list", conn)

        # Build price lookup dict: item_pattern (without %) -> price data
        price_lookup = {}
        for _, row in price_df.iterrows():
            pattern = row['item_pattern'].replace('%', '')
            price_lookup[pattern] = {
                'gross_excl': float(row['gross_amount_excl']),
                'net_sales': float(row['net_sales']),
                'tax': float(row['tax']),
                'gross_all_incl': float(row['gross_sales_all_incl']),
            }

        # Filter item mengikuti isi tiketcom_price_list (sama seperti di
        # combined-report): item baru tidak selalu berawalan 'TIK-'.
        if price_lookup:
            item_filter = " OR ".join(["item LIKE %s"] * len(price_lookup))
            item_params = [p + "%" for p in price_lookup.keys()]
        else:
            item_filter = "FALSE"
            item_params = []

        # Query POS for tiket.com items
        base_where = f"""
            ({item_filter})
            AND business_date >= %s AND business_date <= %s
        """
        params = item_params + [start_date + " 00:00:00", end_date + " 23:59:59"]
        if outlet:
            base_where += " AND outlet IN %s"
            params.append(tuple(outlet))

        query = f"""
            SELECT
                business_date::date as date,
                outlet,
                item,
                item_qty,
                remarks
            FROM pos_sales
            WHERE {base_where}
            ORDER BY business_date, outlet, item
        """
        df = pd.read_sql(query, conn, params=params)
        conn.close()

        if df.empty:
            return {
                "success": True,
                "detail_data": [],
                "summary_data": [],
                "metrics": {
                    "total_gross_excl": 0,
                    "total_discount": 0,
                    "total_net_sales": 0,
                    "total_tax": 0,
                    "total_gross_all_incl": 0,
                    "total_qty": 0,
                    "total_transactions": 0,
                },
            }

        def get_discount_pct(remarks):
            """Extract discount percentage from remarks. Returns 0 if no discount found."""
            if not remarks:
                return 0
            r = str(remarks).lower()
            # Pattern: "x%", "x %", "x persen", "disc x", "promo x"
            match = re.search(r'(\d+)\s*%|(\d+)\s*persen|disc\s*(\d+)|promo\s*(\d+)', r)
            if match:
                for g in match.groups():
                    if g:
                        return int(g)
            return 0

        def extract_order_id(remarks):
            if not remarks:
                return ''
            match = re.search(r'(\d{10})', str(remarks))
            return match.group(1) if match else str(remarks)

        def get_price_for_item(item):
            for pattern, prices in price_lookup.items():
                if item.startswith(pattern):
                    return prices
            return None

        detail_rows = []
        for _, row in df.iterrows():
            item = row['item']
            qty = int(row['item_qty'])
            remarks = row['remarks']

            prices = get_price_for_item(item)
            if not prices:
                continue

            discount_pct = get_discount_pct(remarks)
            order_id = extract_order_id(remarks)

            gross_excl = prices['gross_excl'] * qty
            discount = gross_excl * (discount_pct / 100) if discount_pct > 0 else 0
            net_sales = gross_excl - discount
            tax = net_sales * 0.1
            gross_all_incl = net_sales + tax

            detail_rows.append({
                'date': row['date'].strftime('%Y-%m-%d') if hasattr(row['date'], 'strftime') else str(row['date']),
                'store': row['outlet'],
                'platform': 'Tiket.com',
                'order_id': order_id,
                'item': item,
                'qty': qty,
                'gross_excl': int(round(gross_excl)),
                'discount': int(round(discount)),
                'net_sales': int(round(net_sales)),
                'tax': int(round(tax)),
                'charge': 0,
                'gross_all_incl': int(round(gross_all_incl)),
            })

        detail_df = pd.DataFrame(detail_rows)

        # Summary by date + store
        summary_df = detail_df.groupby(['date', 'store']).agg({
            'gross_excl': 'sum',
            'discount': 'sum',
            'net_sales': 'sum',
            'tax': 'sum',
            'charge': 'sum',
            'gross_all_incl': 'sum',
            'qty': 'sum',
        }).reset_index()
        summary_df['platform'] = 'Tiket.com'
        summary_df = summary_df.sort_values(['date', 'store']).reset_index(drop=True)

        metrics = {
            "total_gross_excl": float(detail_df['gross_excl'].sum()),
            "total_discount": float(detail_df['discount'].sum()),
            "total_net_sales": float(detail_df['net_sales'].sum()),
            "total_tax": float(detail_df['tax'].sum()),
            "total_gross_all_incl": float(detail_df['gross_all_incl'].sum()),
            "total_qty": int(detail_df['qty'].sum()),
            "total_transactions": len(detail_df),
        }

        result = {
            "success": True,
            "detail_data": detail_rows,
            "summary_data": summary_df.to_dict(orient='records'),
            "metrics": metrics,
        }
        set_cached(ck, result)
        return result

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/ota-report")
async def get_ota_report(
    start_date: str = Query(..., description="Start date YYYY-MM-DD"),
    end_date: str = Query(..., description="End date YYYY-MM-DD"),
    outlet: Optional[List[str]] = Query(None, description="Optional outlet filter (multi)"),
    platform: Optional[List[str]] = Query(None, description="Optional platform filter: tiketcom, blibli, website"),
):
    """OTA Report - All online travel agent transactions with calculated prices.

    Platforms: tiketcom, blibli, website
    Detects discount from remarks field patterns.
    """
    try:
        ck = cache_key("ota-report", start_date, end_date, outlet, platform)
        cached = get_cached(ck)
        if cached:
            return cached

        conn = psycopg2.connect(
            host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD
        )

        # Get price list from ota_price_list
        price_df = pd.read_sql("SELECT * FROM ota_price_list", conn)

        # Build price lookup dict: (platform, pattern_prefix) -> price data
        price_lookup = {}
        for _, row in price_df.iterrows():
            plat = row['platform']
            pattern = row['item_pattern'].replace('%', '')
            price_lookup[(plat, pattern)] = {
                'gross_excl': float(row['gross_amount_excl']),
                'net_sales': float(row['net_sales']),
                'tax': float(row['tax']),
                'gross_all_incl': float(row['gross_sales_all_incl']),
            }

        # Build platform conditions. Tiket.com memakai daftar pattern dari
        # ota_price_list karena sejak Okt 2026 ada item tanpa prefix 'TIK-'
        # (Pup-tastic Dessert Treat, Yum-Yum Bonus).
        platform_conditions = []
        platform_params = []
        platform_list = platform if platform else ['tiketcom', 'blibli', 'website']

        for plat in platform_list:
            if plat == 'tiketcom':
                tiketcom_patterns = [pattern for (p, pattern) in price_lookup if p == 'tiketcom']
                if tiketcom_patterns:
                    platform_conditions.append(
                        "(" + " OR ".join(["item LIKE %s"] * len(tiketcom_patterns)) + ")"
                    )
                    platform_params.extend(pattern + "%" for pattern in tiketcom_patterns)
                else:
                    platform_conditions.append("item LIKE 'TIK-%%'")
            elif plat == 'blibli':
                platform_conditions.append("item LIKE 'BLI-%%'")
            elif plat == 'website':
                platform_conditions.append("item LIKE 'WEB-%%'")

        if not platform_conditions:
            conn.close()
            return {
                "success": True,
                "detail_data": [],
                "summary_data": [],
                "metrics": {
                    "total_gross_excl": 0,
                    "total_discount": 0,
                    "total_net_sales": 0,
                    "total_tax": 0,
                    "total_gross_all_incl": 0,
                    "total_qty": 0,
                    "total_transactions": 0,
                },
                "platforms": [],
            }

        platform_where = "(" + " OR ".join(platform_conditions) + ")"

        base_where = f"""
            {platform_where}
            AND business_date >= %s AND business_date <= %s
        """
        params = platform_params + [start_date + " 00:00:00", end_date + " 23:59:59"]
        if outlet:
            base_where += " AND outlet IN %s"
            params.append(tuple(outlet))

        query = f"""
            SELECT
                business_date::date as date,
                outlet,
                item,
                item_qty,
                remarks
            FROM pos_sales
            WHERE {base_where}
            ORDER BY business_date, outlet, item
        """
        df = pd.read_sql(query, conn, params=params)
        conn.close()

        if df.empty:
            return {
                "success": True,
                "detail_data": [],
                "summary_data": [],
                "metrics": {
                    "total_gross_excl": 0,
                    "total_discount": 0,
                    "total_net_sales": 0,
                    "total_tax": 0,
                    "total_gross_all_incl": 0,
                    "total_qty": 0,
                    "total_transactions": 0,
                },
                "platforms": platform_list,
            }

        def get_discount_pct(remarks):
            """Extract discount percentage from remarks."""
            if not remarks:
                return 0
            r = str(remarks).lower()
            match = re.search(r'(\d+)\s*%|(\d+)\s*persen|disc\s*(\d+)|promo\s*(\d+)', r)
            if match:
                for g in match.groups():
                    if g:
                        return int(g)
            return 0

        def extract_order_id(remarks):
            if not remarks:
                return ''
            match = re.search(r'(\d{10})', str(remarks))
            return match.group(1) if match else str(remarks)

        def detect_platform(item):
            if item.startswith('TIK-'):
                return 'tiketcom'
            elif item.startswith('BLI-'):
                return 'blibli'
            elif item.startswith('WEB-'):
                return 'website'
            # Item tiket.com baru tidak berawalan TIK-, jadi fallback ke
            # daftar pattern per platform di ota_price_list.
            for (p, pattern) in price_lookup.keys():
                if item.startswith(pattern):
                    return p
            return None

        def get_price_for_item(item, plat):
            for (p, pattern), prices in price_lookup.items():
                if p == plat and item.startswith(pattern):
                    return prices
            return None

        detail_rows = []
        for _, row in df.iterrows():
            item = row['item']
            qty = int(row['item_qty'])
            remarks = row['remarks']

            plat = detect_platform(item)
            if not plat:
                continue

            prices = get_price_for_item(item, plat)
            if not prices:
                continue

            discount_pct = get_discount_pct(remarks)
            order_id = extract_order_id(remarks)

            gross_excl = prices['gross_excl'] * qty
            discount = gross_excl * (discount_pct / 100) if discount_pct > 0 else 0
            net_sales = gross_excl - discount
            tax = net_sales * 0.1
            gross_all_incl = net_sales + tax

            platform_display = {
                'tiketcom': 'Tiket.com',
                'blibli': 'Blibli',
                'website': 'Website',
            }.get(plat, plat)

            detail_rows.append({
                'date': row['date'].strftime('%Y-%m-%d') if hasattr(row['date'], 'strftime') else str(row['date']),
                'store': row['outlet'],
                'platform': platform_display,
                'order_id': order_id,
                'item': item,
                'qty': qty,
                'gross_excl': int(round(gross_excl)),
                'discount': int(round(discount)),
                'net_sales': int(round(net_sales)),
                'tax': int(round(tax)),
                'charge': 0,
                'gross_all_incl': int(round(gross_all_incl)),
            })

        if not detail_rows:
            return {
                "success": True,
                "detail_data": [],
                "summary_data": [],
                "metrics": {
                    "total_gross_excl": 0,
                    "total_discount": 0,
                    "total_net_sales": 0,
                    "total_tax": 0,
                    "total_gross_all_incl": 0,
                    "total_qty": 0,
                    "total_transactions": 0,
                },
                "platforms": platform_list,
            }

        detail_df = pd.DataFrame(detail_rows)

        # Summary by date + store + platform
        summary_df = detail_df.groupby(['date', 'store', 'platform']).agg({
            'gross_excl': 'sum',
            'discount': 'sum',
            'net_sales': 'sum',
            'tax': 'sum',
            'charge': 'sum',
            'gross_all_incl': 'sum',
            'qty': 'sum',
        }).reset_index()
        summary_df = summary_df.sort_values(['date', 'store', 'platform']).reset_index(drop=True)

        metrics = {
            "total_gross_excl": int(detail_df['gross_excl'].sum()),
            "total_discount": int(detail_df['discount'].sum()),
            "total_net_sales": int(detail_df['net_sales'].sum()),
            "total_tax": int(detail_df['tax'].sum()),
            "total_gross_all_incl": int(detail_df['gross_all_incl'].sum()),
            "total_qty": int(detail_df['qty'].sum()),
            "total_transactions": len(detail_df),
        }

        # Platform breakdown
        platform_breakdown = detail_df.groupby('platform').agg({
            'gross_all_incl': 'sum',
            'qty': 'sum',
        }).reset_index().to_dict(orient='records')

        result = {
            "success": True,
            "detail_data": detail_rows,
            "summary_data": summary_df.to_dict(orient='records'),
            "metrics": metrics,
            "platforms": platform_list,
            "platform_breakdown": platform_breakdown,
        }
        set_cached(ck, result)
        return result

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/jmh-reconciliation")
async def get_jmh_reconciliation(
    start_date: str = Query(..., description="Start date YYYY-MM-DD"),
    end_date: str = Query(..., description="End date YYYY-MM-DD"),
    outlet: Optional[str] = Query(None, description="Optional outlet filter: SNP or CPP"),
):
    """JMH Retail Reconciliation: POS Retail vs Bank (BCA JMH + BRI JMH + BNI JMH) per date."""
    try:
        ck = cache_key("jmh-reconciliation", start_date, end_date, outlet)
        cached = get_cached(ck)
        if cached:
            return cached

        conn = psycopg2.connect(
            host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD
        )

        # POS daily total - only 02-Retail category (same as quick export)
        pos_where = """
            business_date >= %s AND business_date <= %s
            AND outlet IS NOT NULL AND outlet != ''
            AND category = '02-Retail'
        """
        pos_params = [start_date + " 00:00:00", end_date + " 23:59:59"]

        if outlet == "SNP":
            pos_where += " AND outlet = 'OUTLET01-Park Nickelodeon'"
        elif outlet == "CPP":
            pos_where += " AND outlet = 'OUTLET02-Nickelodeon Theme Park Carstensz Mall'"

        pos_query = f"""
            SELECT DATE(business_date) as date, SUM(gross_sales_all_incl) as pos
            FROM pos_sales
            WHERE {pos_where}
            GROUP BY DATE(business_date) ORDER BY date
        """
        pos_df = pd.read_sql(pos_query, conn, params=pos_params)

        # BCA JMH daily total - RETAIL merchants only (MERCH), exclude transaction_date '00000000', only PAID
        bca_where = """
            process_effective_date IS NOT NULL
            AND process_effective_date >= %s AND process_effective_date <= %s
            AND merchant_name ILIKE '%%MERCH%%'
            AND transaction_date IS NOT NULL AND transaction_date != '' AND transaction_date != '00000000'
            AND merchant_payment_status = 'PAID'
            AND (merchant_name ILIKE '%%SPARK%%' OR merchant_name ILIKE '%%CTZ%%')
        """
        bca_params = [start_date, end_date]

        if outlet == "SNP":
            bca_where += " AND merchant_name ILIKE '%%SPARK%%'"
        elif outlet == "CPP":
            bca_where += " AND merchant_name ILIKE '%%CTZ%%'"

        bca_query = f"""
            SELECT process_effective_date as date, SUM(gross_amount) as bca
            FROM bca_jmh_transactions
            WHERE {bca_where}
            GROUP BY process_effective_date ORDER BY date
        """
        bca_df = pd.read_sql(bca_query, conn, params=bca_params)

        # BRI JMH daily total - RETAIL merchants only (MERCH/MERCHANDISE)
        bri_where = """
            tgl_trx IS NOT NULL AND tgl_trx >= %s AND tgl_trx <= %s
            AND (nama_merchant ILIKE '%%MERCH%%' OR nama_merchant ILIKE '%%MERCHANDISE%%')
            AND (nama_merchant ILIKE '%%SPARK%%' OR nama_merchant ILIKE '%%CTZ%%')
        """
        bri_params = [start_date, end_date]

        if outlet == "SNP":
            bri_where += " AND nama_merchant ILIKE '%%SPARK%%'"
        elif outlet == "CPP":
            bri_where += " AND nama_merchant ILIKE '%%CTZ%%'"

        bri_query = f"""
            SELECT tgl_trx as date, SUM(amt_trx) as bri
            FROM bri_jmh_transactions
            WHERE {bri_where}
            GROUP BY tgl_trx ORDER BY date
        """
        bri_df = pd.read_sql(bri_query, conn, params=bri_params)

        # BNI JMH daily total - RETAIL merchants only (MERCH)
        bni_where = """
            trx_date IS NOT NULL AND trx_date >= %s AND trx_date <= %s
            AND merchant_name ILIKE '%%MERCH%%'
            AND (merchant_name ILIKE '%%SPARK%%' OR merchant_name ILIKE '%%CTZ%%')
        """
        bni_params = [start_date, end_date]

        if outlet == "SNP":
            bni_where += " AND merchant_name ILIKE '%%SPARK%%'"
        elif outlet == "CPP":
            bni_where += " AND merchant_name ILIKE '%%CTZ%%'"

        bni_query = f"""
            SELECT trx_date as date, SUM(amount) as bni
            FROM bni_jmh_transactions
            WHERE {bni_where}
            GROUP BY trx_date ORDER BY date
        """
        bni_df = pd.read_sql(bni_query, conn, params=bni_params)

        conn.close()

        # Handle empty DataFrames
        if not pos_df.empty:
            pos_df['date'] = pd.to_datetime(pos_df['date'])
        if not bca_df.empty:
            bca_df['date'] = pd.to_datetime(bca_df['date'])
        if not bri_df.empty:
            bri_df['date'] = pd.to_datetime(bri_df['date'])
        if not bni_df.empty:
            bni_df['date'] = pd.to_datetime(bni_df['date'])

        date_range = pd.date_range(start=start_date, end=end_date)
        result_df = pd.DataFrame({'date': date_range})

        result_df = result_df.merge(pos_df, on='date', how='left') if not pos_df.empty else result_df.assign(pos=0.0)
        result_df = result_df.merge(bca_df, on='date', how='left') if not bca_df.empty else result_df.assign(bca=0.0)
        result_df = result_df.merge(bri_df, on='date', how='left') if not bri_df.empty else result_df.assign(bri=0.0)
        result_df = result_df.merge(bni_df, on='date', how='left') if not bni_df.empty else result_df.assign(bni=0.0)

        # Ensure all columns exist
        for col in ['pos', 'bca', 'bri', 'bni']:
            if col not in result_df.columns:
                result_df[col] = 0.0

        result_df = result_df.fillna(0)
        result_df['bank_total'] = result_df['bca'] + result_df['bri'] + result_df['bni']
        result_df['difference'] = result_df['bank_total'] - result_df['pos']
        result_df['date'] = result_df['date'].dt.strftime('%Y-%m-%d')

        for col in ['pos', 'bca', 'bri', 'bni', 'bank_total', 'difference']:
            result_df[col] = result_df[col].astype(float)

        result_df = result_df[(result_df['pos'] > 0) | (result_df['bank_total'] > 0)]

        result = {
            "success": True,
            "data": result_df.to_dict(orient='records'),
            "totals": {
                "pos": float(result_df['pos'].sum()),
                "bca": float(result_df['bca'].sum()),
                "bri": float(result_df['bri'].sum()),
                "bni": float(result_df['bni'].sum()),
                "bank_total": float(result_df['bank_total'].sum()),
                "difference": float(result_df['difference'].sum()),
            }
        }
        set_cached(ck, result)
        return result

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# =====================
# COGS Endpoints (Hierarchical BOM)
# =====================

from pydantic import BaseModel
from typing import Optional, List as PyList

class RawMaterialCreate(BaseModel):
    sku: str
    name: str
    unit: str
    price_per_unit: float = 0
    stock_qty: float = 0
    category: Optional[str] = None

class WipCreate(BaseModel):
    sku: str
    name: str
    unit: str
    yield_qty: float = 1
    category: Optional[str] = None

class WipRecipeCreate(BaseModel):
    wip_sku: str
    rm_sku: str
    qty: float

class MenuCreate(BaseModel):
    sku: str
    name: str
    category: Optional[str] = None
    selling_price: float = 0

class MenuRecipeCreate(BaseModel):
    menu_sku: str
    ingredient_type: str  # 'raw_material' or 'wip'
    ingredient_sku: str
    qty: float

# === Raw Materials ===
@app.get("/api/cogs/raw-materials")
def get_raw_materials():
    conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD)
    cur = conn.cursor()
    cur.execute("SELECT id, sku, name, unit, price_per_unit, stock_qty, category FROM cogs_raw_materials ORDER BY sku")
    rows = cur.fetchall()
    conn.close()
    return [{"id": r[0], "sku": r[1], "name": r[2], "unit": r[3], "price_per_unit": float(r[4]), "stock_qty": float(r[5]), "category": r[6]} for r in rows]

@app.post("/api/cogs/raw-materials")
def create_raw_material(data: RawMaterialCreate):
    conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD)
    cur = conn.cursor()
    try:
        cur.execute("INSERT INTO cogs_raw_materials (sku, name, unit, price_per_unit, stock_qty, category) VALUES (%s,%s,%s,%s,%s,%s) RETURNING id",
                    (data.sku, data.name, data.unit, data.price_per_unit, data.stock_qty, data.category))
        new_id = cur.fetchone()[0]
        conn.commit()
        return {"id": new_id}
    except psycopg2.errors.UniqueViolation:
        conn.rollback()
        raise HTTPException(status_code=400, detail="SKU already exists")
    finally:
        conn.close()

@app.put("/api/cogs/raw-materials/{id}")
def update_raw_material(id: int, data: RawMaterialCreate):
    conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD)
    cur = conn.cursor()
    cur.execute("UPDATE cogs_raw_materials SET sku=%s, name=%s, unit=%s, price_per_unit=%s, stock_qty=%s, category=%s, updated_at=CURRENT_TIMESTAMP WHERE id=%s",
                (data.sku, data.name, data.unit, data.price_per_unit, data.stock_qty, data.category, id))
    conn.commit()
    conn.close()
    return {"message": "Updated"}

@app.delete("/api/cogs/raw-materials/{id}")
def delete_raw_material(id: int):
    conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD)
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM cogs_raw_materials WHERE id=%s", (id,))
        conn.commit()
        return {"message": "Deleted"}
    except psycopg2.errors.ForeignKeyViolation:
        conn.rollback()
        raise HTTPException(status_code=400, detail="Cannot delete: used in WIP recipes")
    finally:
        conn.close()

# === WIP (Work In Progress) ===
@app.get("/api/cogs/wip")
def get_wip():
    conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD)
    cur = conn.cursor()
    cur.execute("SELECT id, sku, name, unit, yield_qty, category FROM cogs_wip ORDER BY sku")
    rows = cur.fetchall()
    conn.close()
    return [{"id": r[0], "sku": r[1], "name": r[2], "unit": r[3], "yield_qty": float(r[4]), "category": r[5]} for r in rows]

@app.post("/api/cogs/wip")
def create_wip(data: WipCreate):
    conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD)
    cur = conn.cursor()
    try:
        cur.execute("INSERT INTO cogs_wip (sku, name, unit, yield_qty, category) VALUES (%s,%s,%s,%s,%s) RETURNING id",
                    (data.sku, data.name, data.unit, data.yield_qty, data.category))
        new_id = cur.fetchone()[0]
        conn.commit()
        return {"id": new_id}
    except psycopg2.errors.UniqueViolation:
        conn.rollback()
        raise HTTPException(status_code=400, detail="SKU already exists")
    finally:
        conn.close()

@app.put("/api/cogs/wip/{id}")
def update_wip(id: int, data: WipCreate):
    conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD)
    cur = conn.cursor()
    old_sku = None
    cur.execute("SELECT sku FROM cogs_wip WHERE id=%s", (id,))
    row = cur.fetchone()
    if row:
        old_sku = row[0]
    cur.execute("UPDATE cogs_wip SET sku=%s, name=%s, unit=%s, yield_qty=%s, category=%s, updated_at=CURRENT_TIMESTAMP WHERE id=%s",
                (data.sku, data.name, data.unit, data.yield_qty, data.category, id))
    if old_sku and old_sku != data.sku:
        cur.execute("UPDATE cogs_wip_recipes SET wip_sku=%s WHERE wip_sku=%s", (data.sku, old_sku))
        cur.execute("UPDATE cogs_menu_recipes SET ingredient_sku=%s WHERE ingredient_type='wip' AND ingredient_sku=%s", (data.sku, old_sku))
    conn.commit()
    conn.close()
    return {"message": "Updated"}

@app.delete("/api/cogs/wip/{id}")
def delete_wip(id: int):
    conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD)
    cur = conn.cursor()
    cur.execute("DELETE FROM cogs_wip WHERE id=%s", (id,))
    conn.commit()
    conn.close()
    return {"message": "Deleted"}

# === WIP Recipes ===
@app.get("/api/cogs/wip-recipes")
def get_wip_recipes():
    conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD)
    cur = conn.cursor()
    cur.execute("""
        SELECT wr.id, wr.wip_sku, w.name as wip_name, wr.rm_sku, rm.name as rm_name, rm.unit, wr.qty, rm.price_per_unit, w.yield_qty
        FROM cogs_wip_recipes wr
        JOIN cogs_wip w ON w.sku = wr.wip_sku
        JOIN cogs_raw_materials rm ON rm.sku = wr.rm_sku
        ORDER BY wr.wip_sku, wr.id
    """)
    rows = cur.fetchall()
    conn.close()
    return [{"id": r[0], "wip_sku": r[1], "wip_name": r[2], "rm_sku": r[3], "rm_name": r[4], "unit": r[5],
             "qty": float(r[6]), "price_per_unit": float(r[7]), "yield_qty": float(r[8])} for r in rows]

@app.post("/api/cogs/wip-recipes")
def create_wip_recipe(data: WipRecipeCreate):
    conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD)
    cur = conn.cursor()
    cur.execute("INSERT INTO cogs_wip_recipes (wip_sku, rm_sku, qty) VALUES (%s,%s,%s) RETURNING id", (data.wip_sku, data.rm_sku, data.qty))
    new_id = cur.fetchone()[0]
    conn.commit()
    conn.close()
    return {"id": new_id}

@app.put("/api/cogs/wip-recipes/{id}")
def update_wip_recipe(id: int, data: WipRecipeCreate):
    conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD)
    cur = conn.cursor()
    cur.execute("UPDATE cogs_wip_recipes SET wip_sku=%s, rm_sku=%s, qty=%s WHERE id=%s", (data.wip_sku, data.rm_sku, data.qty, id))
    conn.commit()
    conn.close()
    return {"message": "Updated"}

@app.delete("/api/cogs/wip-recipes/{id}")
def delete_wip_recipe(id: int):
    conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD)
    cur = conn.cursor()
    cur.execute("DELETE FROM cogs_wip_recipes WHERE id=%s", (id,))
    conn.commit()
    conn.close()
    return {"message": "Deleted"}

# === Menus ===
@app.get("/api/cogs/menus")
def get_menus():
    conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD)
    cur = conn.cursor()
    cur.execute("SELECT id, sku, name, category, selling_price FROM cogs_menus ORDER BY sku")
    rows = cur.fetchall()
    conn.close()
    return [{"id": r[0], "sku": r[1], "name": r[2], "category": r[3], "selling_price": float(r[4])} for r in rows]

@app.post("/api/cogs/menus")
def create_menu(data: MenuCreate):
    conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD)
    cur = conn.cursor()
    try:
        cur.execute("INSERT INTO cogs_menus (sku, name, category, selling_price) VALUES (%s,%s,%s,%s) RETURNING id",
                    (data.sku, data.name, data.category, data.selling_price))
        new_id = cur.fetchone()[0]
        conn.commit()
        return {"id": new_id}
    except psycopg2.errors.UniqueViolation:
        conn.rollback()
        raise HTTPException(status_code=400, detail="SKU already exists")
    finally:
        conn.close()

@app.put("/api/cogs/menus/{id}")
def update_menu(id: int, data: MenuCreate):
    conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD)
    cur = conn.cursor()
    old_sku = None
    cur.execute("SELECT sku FROM cogs_menus WHERE id=%s", (id,))
    row = cur.fetchone()
    if row:
        old_sku = row[0]
    cur.execute("UPDATE cogs_menus SET sku=%s, name=%s, category=%s, selling_price=%s, updated_at=CURRENT_TIMESTAMP WHERE id=%s",
                (data.sku, data.name, data.category, data.selling_price, id))
    if old_sku and old_sku != data.sku:
        cur.execute("UPDATE cogs_menu_recipes SET menu_sku=%s WHERE menu_sku=%s", (data.sku, old_sku))
    conn.commit()
    conn.close()
    return {"message": "Updated"}

@app.delete("/api/cogs/menus/{id}")
def delete_menu(id: int):
    conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD)
    cur = conn.cursor()
    cur.execute("DELETE FROM cogs_menus WHERE id=%s", (id,))
    conn.commit()
    conn.close()
    return {"message": "Deleted"}

# === Menu Recipes ===
@app.get("/api/cogs/menu-recipes")
def get_menu_recipes():
    conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD)
    cur = conn.cursor()
    cur.execute("SELECT id, menu_sku, ingredient_type, ingredient_sku, qty FROM cogs_menu_recipes ORDER BY menu_sku, id")
    rows = cur.fetchall()
    conn.close()
    return [{"id": r[0], "menu_sku": r[1], "ingredient_type": r[2], "ingredient_sku": r[3], "qty": float(r[4])} for r in rows]

@app.post("/api/cogs/menu-recipes")
def create_menu_recipe(data: MenuRecipeCreate):
    conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD)
    cur = conn.cursor()
    cur.execute("INSERT INTO cogs_menu_recipes (menu_sku, ingredient_type, ingredient_sku, qty) VALUES (%s,%s,%s,%s) RETURNING id",
                (data.menu_sku, data.ingredient_type, data.ingredient_sku, data.qty))
    new_id = cur.fetchone()[0]
    conn.commit()
    conn.close()
    return {"id": new_id}

@app.put("/api/cogs/menu-recipes/{id}")
def update_menu_recipe(id: int, data: MenuRecipeCreate):
    conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD)
    cur = conn.cursor()
    cur.execute("UPDATE cogs_menu_recipes SET menu_sku=%s, ingredient_type=%s, ingredient_sku=%s, qty=%s WHERE id=%s",
                (data.menu_sku, data.ingredient_type, data.ingredient_sku, data.qty, id))
    conn.commit()
    conn.close()
    return {"message": "Updated"}

@app.delete("/api/cogs/menu-recipes/{id}")
def delete_menu_recipe(id: int):
    conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD)
    cur = conn.cursor()
    cur.execute("DELETE FROM cogs_menu_recipes WHERE id=%s", (id,))
    conn.commit()
    conn.close()
    return {"message": "Deleted"}

# === Cost Calculation ===
@app.get("/api/cogs/calculate")
def calculate_cogs():
    """Calculate cost for all WIPs and Menus"""
    conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD)
    cur = conn.cursor()

    # Get all raw materials prices
    cur.execute("SELECT sku, price_per_unit FROM cogs_raw_materials")
    rm_prices = {r[0]: float(r[1]) for r in cur.fetchall()}

    # Calculate WIP costs (batch cost / yield = per unit cost)
    cur.execute("SELECT sku, yield_qty FROM cogs_wip")
    wip_yields = {r[0]: float(r[1]) for r in cur.fetchall()}

    cur.execute("SELECT wip_sku, rm_sku, qty FROM cogs_wip_recipes")
    wip_recipes = cur.fetchall()

    wip_batch_costs = {}
    for wip_sku, rm_sku, qty in wip_recipes:
        if wip_sku not in wip_batch_costs:
            wip_batch_costs[wip_sku] = 0
        wip_batch_costs[wip_sku] += float(qty) * rm_prices.get(rm_sku, 0)

    wip_unit_costs = {}
    for wip_sku, batch_cost in wip_batch_costs.items():
        yield_qty = wip_yields.get(wip_sku, 1)
        wip_unit_costs[wip_sku] = batch_cost / yield_qty if yield_qty > 0 else 0

    # Calculate Menu costs
    cur.execute("SELECT sku, name, selling_price FROM cogs_menus")
    menus = cur.fetchall()

    cur.execute("SELECT menu_sku, ingredient_type, ingredient_sku, qty FROM cogs_menu_recipes")
    menu_recipes = cur.fetchall()

    menu_costs = {}
    for menu_sku, ing_type, ing_sku, qty in menu_recipes:
        if menu_sku not in menu_costs:
            menu_costs[menu_sku] = 0
        if ing_type == 'raw_material':
            menu_costs[menu_sku] += float(qty) * rm_prices.get(ing_sku, 0)
        elif ing_type == 'wip':
            menu_costs[menu_sku] += float(qty) * wip_unit_costs.get(ing_sku, 0)

    conn.close()

    # Build result
    wip_result = [{"sku": sku, "batch_cost": wip_batch_costs.get(sku, 0), "yield_qty": wip_yields.get(sku, 1),
                   "unit_cost": wip_unit_costs.get(sku, 0)} for sku in wip_yields.keys()]

    menu_result = []
    for sku, name, selling_price in menus:
        cost = menu_costs.get(sku, 0)
        margin = float(selling_price) - cost if selling_price else 0
        margin_pct = (margin / float(selling_price) * 100) if selling_price and float(selling_price) > 0 else 0
        menu_result.append({
            "sku": sku, "name": name, "selling_price": float(selling_price),
            "cost": cost, "margin": margin, "margin_pct": round(margin_pct, 2)
        })

    return {"wip_costs": wip_result, "menu_costs": menu_result}


# === Purchases ===
class PurchaseCreate(BaseModel):
    purchase_date: str
    rm_sku: str
    qty: float
    price_total: float
    supplier: Optional[str] = None
    notes: Optional[str] = None

@app.get("/api/cogs/purchases")
def get_purchases():
    conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD)
    cur = conn.cursor()
    cur.execute("""
        SELECT p.id, p.purchase_date, p.rm_sku, rm.name as rm_name, rm.unit, p.qty, p.price_total, p.supplier, p.notes, p.created_at
        FROM cogs_purchases p
        JOIN cogs_raw_materials rm ON rm.sku = p.rm_sku
        ORDER BY p.purchase_date DESC, p.id DESC
    """)
    rows = cur.fetchall()
    conn.close()
    return [{"id": r[0], "purchase_date": str(r[1]), "rm_sku": r[2], "rm_name": r[3], "unit": r[4], 
             "qty": float(r[5]), "price_total": float(r[6]), "supplier": r[7], "notes": r[8]} for r in rows]

@app.post("/api/cogs/purchases")
def create_purchase(data: PurchaseCreate):
    conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD)
    cur = conn.cursor()
    # Insert purchase
    cur.execute("""
        INSERT INTO cogs_purchases (purchase_date, rm_sku, qty, price_total, supplier, notes)
        VALUES (%s, %s, %s, %s, %s, %s) RETURNING id
    """, (data.purchase_date, data.rm_sku, data.qty, data.price_total, data.supplier, data.notes))
    new_id = cur.fetchone()[0]
    # Update RM stock (increase)
    cur.execute("UPDATE cogs_raw_materials SET stock_qty = stock_qty + %s WHERE sku = %s", (data.qty, data.rm_sku))
    # Update RM price_per_unit based on this purchase
    if data.qty > 0:
        price_per_unit = data.price_total / data.qty
        cur.execute("UPDATE cogs_raw_materials SET price_per_unit = %s WHERE sku = %s", (price_per_unit, data.rm_sku))
    conn.commit()
    conn.close()
    return {"id": new_id}

@app.delete("/api/cogs/purchases/{id}")
def delete_purchase(id: int):
    conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD)
    cur = conn.cursor()
    # Get purchase details first
    cur.execute("SELECT rm_sku, qty FROM cogs_purchases WHERE id = %s", (id,))
    row = cur.fetchone()
    if row:
        rm_sku, qty = row
        # Reverse the stock change
        cur.execute("UPDATE cogs_raw_materials SET stock_qty = stock_qty - %s WHERE sku = %s", (qty, rm_sku))
    cur.execute("DELETE FROM cogs_purchases WHERE id = %s", (id,))
    conn.commit()
    conn.close()
    return {"message": "Deleted"}

# === Productions ===
class ProductionCreate(BaseModel):
    production_date: str
    wip_sku: str
    batch_qty: float
    notes: Optional[str] = None

@app.get("/api/cogs/productions")
def get_productions():
    conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD)
    cur = conn.cursor()
    cur.execute("""
        SELECT p.id, p.production_date, p.wip_sku, w.name as wip_name, w.unit, p.batch_qty, p.output_qty, p.notes, p.created_at
        FROM cogs_productions p
        JOIN cogs_wip w ON w.sku = p.wip_sku
        ORDER BY p.production_date DESC, p.id DESC
    """)
    rows = cur.fetchall()
    conn.close()
    return [{"id": r[0], "production_date": str(r[1]), "wip_sku": r[2], "wip_name": r[3], "unit": r[4],
             "batch_qty": float(r[5]), "output_qty": float(r[6]), "notes": r[7]} for r in rows]

@app.post("/api/cogs/productions")
def create_production(data: ProductionCreate):
    conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD)
    cur = conn.cursor()
    
    # Get WIP yield
    cur.execute("SELECT yield_qty FROM cogs_wip WHERE sku = %s", (data.wip_sku,))
    row = cur.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=400, detail="WIP not found")
    yield_qty = float(row[0])
    output_qty = data.batch_qty * yield_qty
    
    # Get WIP recipe (raw materials needed)
    cur.execute("SELECT rm_sku, qty FROM cogs_wip_recipes WHERE wip_sku = %s", (data.wip_sku,))
    recipes = cur.fetchall()
    
    # Check if enough stock for all raw materials
    for rm_sku, qty_per_batch in recipes:
        needed = float(qty_per_batch) * data.batch_qty
        cur.execute("SELECT stock_qty FROM cogs_raw_materials WHERE sku = %s", (rm_sku,))
        stock_row = cur.fetchone()
        if not stock_row or float(stock_row[0]) < needed:
            conn.close()
            raise HTTPException(status_code=400, detail=f"Not enough stock for {rm_sku}. Need {needed}, have {float(stock_row[0]) if stock_row else 0}")
    
    # Deduct raw materials
    for rm_sku, qty_per_batch in recipes:
        needed = float(qty_per_batch) * data.batch_qty
        cur.execute("UPDATE cogs_raw_materials SET stock_qty = stock_qty - %s WHERE sku = %s", (needed, rm_sku))
    
    # Add WIP stock
    cur.execute("UPDATE cogs_wip SET stock_qty = stock_qty + %s WHERE sku = %s", (output_qty, data.wip_sku))
    
    # Insert production record
    cur.execute("""
        INSERT INTO cogs_productions (production_date, wip_sku, batch_qty, output_qty, notes)
        VALUES (%s, %s, %s, %s, %s) RETURNING id
    """, (data.production_date, data.wip_sku, data.batch_qty, output_qty, data.notes))
    new_id = cur.fetchone()[0]
    
    conn.commit()
    conn.close()
    return {"id": new_id, "output_qty": output_qty}

@app.delete("/api/cogs/productions/{id}")
def delete_production(id: int):
    conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD)
    cur = conn.cursor()

    # Get production details
    cur.execute("SELECT wip_sku, batch_qty, output_qty FROM cogs_productions WHERE id = %s", (id,))
    row = cur.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Production not found")

    wip_sku, batch_qty, output_qty = row

    # Reverse WIP stock
    cur.execute("UPDATE cogs_wip SET stock_qty = stock_qty - %s WHERE sku = %s", (output_qty, wip_sku))

    # Reverse raw material deductions
    cur.execute("SELECT rm_sku, qty FROM cogs_wip_recipes WHERE wip_sku = %s", (wip_sku,))
    recipes = cur.fetchall()
    for rm_sku, qty_per_batch in recipes:
        restore = float(qty_per_batch) * float(batch_qty)
        cur.execute("UPDATE cogs_raw_materials SET stock_qty = stock_qty + %s WHERE sku = %s", (restore, rm_sku))

    cur.execute("DELETE FROM cogs_productions WHERE id = %s", (id,))
    conn.commit()
    conn.close()
    return {"message": "Deleted"}


# === New Tiket.com Report (from new_tiket_transactions) ===

def extract_discount_from_package(package: str) -> float:
    """Extract discount percentage from package name like 'DISC 10%', 'DISC 7%', 'DISC 5%'"""
    if not package:
        return 0.0
    import re
    match = re.search(r'DISC\s*(\d+)\s*%', package, re.IGNORECASE)
    if match:
        return float(match.group(1))
    return 0.0

def determine_store(product_name: str) -> str:
    """Determine store from product name"""
    if not product_name:
        return "Unknown"
    lower = product_name.lower()
    if 'paw patrol' in lower:
        return "PAW Patrol Playtime"
    elif 'nickelodeon' in lower:
        return "NICKELODEON PLAYTIME - tiket.com Exclusive"
    return product_name

def determine_status(redemption_date, valid_until, refund_status) -> str:
    """Determine ticket status: Redeemed, Expired, Available, or Refunded"""
    from datetime import datetime

    if refund_status and 'refund' in str(refund_status).lower() and 'no refund' not in str(refund_status).lower():
        return "Refunded"

    if redemption_date and pd.notna(redemption_date):
        return "Redeemed"

    if valid_until and pd.notna(valid_until):
        try:
            valid_dt = pd.to_datetime(valid_until)
            if valid_dt < datetime.now():
                return "Expired"
        except:
            pass

    return "Available"


@app.get("/api/new-tiketcom-report")
async def get_new_tiketcom_report(
    start_date: str = Query(..., description="Start date YYYY-MM-DD"),
    end_date: str = Query(..., description="End date YYYY-MM-DD"),
    store: Optional[str] = Query(None, description="Filter by store: PAW, NICK, or all"),
):
    """New Tiket.com Report - from new_tiket_transactions table with price lookup."""
    try:
        conn = psycopg2.connect(
            host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD
        )

        # Get price list
        price_df = pd.read_sql("SELECT product_name, package, price FROM new_tiket_price_list", conn)
        price_lookup = {}
        for _, row in price_df.iterrows():
            key = (row['product_name'].strip(), row['package'].strip())
            price_lookup[key] = float(row['price'])

        # Query transactions - filter by order_date
        query = """
            SELECT
                order_id, order_detail_id, order_date, visit_date, valid_until,
                settlement_date, redemption_date, product_name, package,
                COALESCE(child_total, 0) + COALESCE(pax_total, 0) as qty,
                total_payment, refund_status, redeemed_by
            FROM new_tiket_transactions
            WHERE order_date >= %s AND order_date < %s
              AND settlement_status = 'Paid'
            ORDER BY order_date, order_id
        """
        params = [start_date + " 00:00:00", end_date + " 23:59:59"]

        df = pd.read_sql(query, conn, params=params)
        conn.close()

        if df.empty:
            return {"data": [], "summary": {}}

        # Process each row
        results = []
        for _, row in df.iterrows():
            product_name = str(row['product_name']).strip() if row['product_name'] else ""
            package = str(row['package']).strip() if row['package'] else ""
            qty = int(row['qty']) if row['qty'] and row['qty'] > 0 else 1

            # Lookup price
            price_key = (product_name, package)
            price = price_lookup.get(price_key, 0)

            # Calculate values
            gross_sales = price * qty
            discount_pct = extract_discount_from_package(package)
            discount_amount = gross_sales * (discount_pct / 100)
            nett_sales = gross_sales - discount_amount
            # Fee is derived from actual total_payment in transaction
            actual_total_payment = float(row['total_payment']) if row['total_payment'] else 0
            fee = nett_sales - actual_total_payment

            # Calculate valid_until: if empty, use visit_date + 7 days
            valid_until = row['valid_until']
            if pd.isna(valid_until) and pd.notna(row['visit_date']):
                valid_until = pd.to_datetime(row['visit_date']) + pd.Timedelta(days=7)

            # Determine store and status
            store_name = determine_store(product_name)
            status = determine_status(row['redemption_date'], valid_until, row['refund_status'])

            # Filter by store if specified
            if store:
                if store.upper() == "PAW" and "paw" not in store_name.lower():
                    continue
                elif store.upper() == "NICK" and "nickelodeon" not in store_name.lower():
                    continue

            results.append({
                "order_id": row['order_id'],
                "order_detail_id": row['order_detail_id'],
                "order_date": str(row['order_date']) if row['order_date'] else "",
                "visit_date": str(row['visit_date']) if row['visit_date'] else "",
                "valid_until_date": str(valid_until) if pd.notna(valid_until) else "",
                "settlement_date": str(row['settlement_date']) if row['settlement_date'] else "",
                "redeem_date": str(row['redemption_date']) if pd.notna(row['redemption_date']) else "",
                "store": store_name,
                "package": package,
                "qty": qty,
                "price": price,
                "gross_sales": gross_sales,
                "discount_pct": discount_pct,
                "discount_amount": discount_amount,
                "nett_sales": nett_sales,
                "fee": fee,
                "total_payment": actual_total_payment,
                "status": status,
            })

        # Summary
        result_df = pd.DataFrame(results) if results else pd.DataFrame()
        summary = {}
        if not result_df.empty:
            summary = {
                "total_qty": int(result_df['qty'].sum()),
                "total_gross_sales": float(result_df['gross_sales'].sum()),
                "total_discount": float(result_df['discount_amount'].sum()),
                "total_nett_sales": float(result_df['nett_sales'].sum()),
                "total_fee": float(result_df['fee'].sum()),
                "total_payment": float(result_df['total_payment'].sum()),
                "by_status": result_df.groupby('status')['qty'].sum().to_dict(),
                "by_store": result_df.groupby('store')['nett_sales'].sum().to_dict(),
            }

        return {"data": results, "summary": summary}

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
