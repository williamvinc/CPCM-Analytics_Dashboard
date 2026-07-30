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
from typing import List, Optional
from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

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
    required_cols = ['Category', 'Item', 'Gross Amount']
    missing_cols = [col for col in required_cols if col not in df.columns]
    if missing_cols:
        raise HTTPException(status_code=400, detail=f"Missing columns: {', '.join(missing_cols)}")

    has_date = 'Business Date' in df.columns
    if has_date:
        df['Business Date'] = pd.to_datetime(df['Business Date'], errors='coerce')

    valid_categories = ["01-Ticketing", "TC01-Ticket Cartenz"]
    df_filtered = df[df['Category'].isin(valid_categories)].copy()

    item_str = df_filtered['Item'].astype(str).str.strip()
    item_lower = item_str.str.lower()
    gross_amt = pd.to_numeric(df_filtered['Gross Amount'], errors='coerce').fillna(0)

    is_kaos_kaki = item_str.str.contains(r'\b(XXS|XS|S|M|L)$', flags=re.IGNORECASE, regex=True)
    is_2jam = item_lower.str.contains(r'2\s*jam', regex=True)
    is_3jam = item_lower.str.contains(r'3\s*jam', regex=True)
    is_1comp = item_lower.str.contains(r'1\s*comp|companion\s*1', regex=True)
    is_2comp = item_lower.str.contains(r'2\s*comp|companion\s*2', regex=True)

    new_cat = pd.Series('null', index=df_filtered.index)
    new_cat = new_cat.where(~is_2jam, 'Tiket Bermain - 2 Jam')
    new_cat = new_cat.where(~(~is_2jam & is_3jam), 'Tiket Bermain - 3 Jam')
    new_cat = new_cat.where(~(~is_2jam & ~is_3jam & is_1comp), 'Tiket Pendamping - 1 Orang')
    new_cat = new_cat.where(~(~is_2jam & ~is_3jam & ~is_1comp & is_2comp), 'Tiket Pendamping - 2 Orang')

    has_new_cat = new_cat != 'null'
    is_blibli = item_lower.str.contains('blibli', regex=False)
    is_tiketcom = item_lower.str.contains(r'tiket\s*com|ticket\s*com|tiket\.com|ticket\.com', regex=True)
    is_website = item_lower.str.contains('website|web', regex=True)
    is_skye = item_lower.str.contains(r'skye|marshall|sbsp', regex=True)

    source = pd.Series('null', index=df_filtered.index)
    source = source.where(~(has_new_cat & is_blibli), 'BLIBLI')
    source = source.where(~(has_new_cat & ~is_blibli & is_tiketcom), 'TIKET.COM')
    source = source.where(~(has_new_cat & ~is_blibli & ~is_tiketcom & is_website), 'WEBSITE')
    source = source.where(~(has_new_cat & ~is_blibli & ~is_tiketcom & ~is_website & is_skye), 'KAOS KAKI')
    source = source.where(~(has_new_cat & ~is_blibli & ~is_tiketcom & ~is_website & ~is_skye), 'WALK IN')
    source = source.where(~is_kaos_kaki, 'KAOS KAKI')

    df_filtered['New Category'] = new_cat
    df_filtered['Source'] = source

    drop_mask = is_kaos_kaki & ((gross_amt == 0) | gross_amt.isna())
    df_result = df_filtered[~drop_mask].copy()
    df_result = df_result[~((df_result['New Category'] == 'null') & (df_result['Source'] == 'null'))]

    unnamed_cols = [col for col in df_result.columns if 'Unnamed:' in str(col)]
    if unnamed_cols:
        df_result = df_result.drop(columns=unnamed_cols)

    df_result['Gross Amount'] = pd.to_numeric(df_result['Gross Amount'], errors='coerce').fillna(0)

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

    total_gross = float(df_result['Gross Amount'].sum())
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
        agg_dict = {'Gross Amount': 'sum'}
        if has_qty:
            agg_dict['Item Qty'] = 'sum'
        daily_grouped = daily_df.groupby('_date_str', as_index=False).agg(agg_dict)
        daily_grouped = daily_grouped.sort_values('_date_str')
        daily_grouped = daily_grouped.rename(columns={'_date_str': 'date'})
        chart_daily = daily_grouped.to_dict(orient='records')

    chart_monthly = []
    if has_date:
        monthly_df = df_result.copy()
        monthly_df['_month_str'] = monthly_df['Business Date'].dt.strftime('%Y-%m')
        agg_dict = {'Gross Amount': 'sum'}
        if has_qty:
            agg_dict['Item Qty'] = 'sum'
        monthly_grouped = monthly_df.groupby('_month_str', as_index=False).agg(agg_dict)
        monthly_grouped = monthly_grouped.sort_values('_month_str')
        monthly_grouped = monthly_grouped.rename(columns={'_month_str': 'month'})
        chart_monthly = monthly_grouped.to_dict(orient='records')

    chart1_df = df_result[df_result['New Category'] != 'null'].copy()
    chart1_grouped = chart1_df.groupby('New Category', as_index=False)['Gross Amount'].sum()
    chart1_data = chart1_grouped.to_dict(orient='records')

    chart2_df = df_result[df_result['Source'] != 'null'].copy()
    chart2_grouped = chart2_df.groupby('Source', as_index=False)['Gross Amount'].sum()
    chart2_data = chart2_grouped.to_dict(orient='records')

    chart_tender = []
    if 'Tender' in df_result.columns:
        tender_df = df_result.copy()
        tender_df['Tender'] = tender_df['Tender'].astype(str).str.strip()
        tender_df = tender_df[tender_df['Tender'] != '']
        tender_grouped = tender_df.groupby('Tender', as_index=False)['Gross Amount'].sum()
        chart_tender = tender_grouped.to_dict(orient='records')

    if has_date:
        df_result['Business Date'] = df_result['Business Date'].dt.strftime('%Y-%m-%d')
        if '_month' in df_result.columns:
            df_result = df_result.drop(columns=['_month'])

    df_result = df_result.fillna("")

    display_cols = ['Business Date', 'Category', 'Item', 'New Category', 'Source', 'Gross Amount']
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
        query = "SELECT DISTINCT outlet FROM pos_sales WHERE outlet IS NOT NULL AND outlet != '' ORDER BY outlet"
        df = pd.read_sql(query, conn)
        conn.close()
        outlets_list = [{"id": o, "label": o} for o in df['outlet'].tolist() if o]
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
):
    try:
        ck = cache_key("sales", start_date, end_date, outlet)
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
        query = "SELECT * FROM pos_sales WHERE business_date >= %s AND business_date <= %s"
        params = [start_date + " 00:00:00", end_date + " 23:59:59"]
        if outlet:
            query += " AND outlet IN %s"
            params.append(tuple(outlet))
        df = pd.read_sql(query, conn, params=params)
        conn.close()

        if df.empty:
            raise HTTPException(status_code=404, detail="No data found for the selected date range.")

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
):
    try:
        ck = cache_key("reconciliation", start_date, end_date, outlet)
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

        pos_query = """
            SELECT DATE(business_date) as date, SUM(gross_sales_all_incl) as pos
            FROM pos_sales
            WHERE business_date >= %s AND business_date <= %s
        """
        pos_params = [start_date + " 00:00:00", end_date + " 23:59:59"]
        if outlet:
            pos_query += " AND outlet IN %s"
            pos_params.append(tuple(outlet))
        pos_query += " GROUP BY DATE(business_date) ORDER BY date"
        pos_df = pd.read_sql(pos_query, conn, params=pos_params)

        bca_query = """
            SELECT
                process_effective_date as date,
                SUM(gross_amount) as bca
            FROM bca_transactions
            WHERE process_effective_date IS NOT NULL
              AND process_effective_date >= %s AND process_effective_date <= %s
            GROUP BY process_effective_date
            ORDER BY date
        """
        bca_df = pd.read_sql(bca_query, conn, params=[start_date, end_date])

        bri_query = """
            SELECT
                tgl_trx as date,
                SUM(amt_trx) as bri
            FROM bri_transactions
            WHERE tgl_trx IS NOT NULL
              AND tgl_trx >= %s AND tgl_trx <= %s
            GROUP BY tgl_trx
            ORDER BY date
        """
        bri_df = pd.read_sql(bri_query, conn, params=[start_date, end_date])
        conn.close()

        pos_df['date'] = pd.to_datetime(pos_df['date'])
        bca_df['date'] = pd.to_datetime(bca_df['date'])
        bri_df['date'] = pd.to_datetime(bri_df['date'])

        date_range = pd.date_range(start=start_date, end=end_date)
        result_df = pd.DataFrame({'date': date_range})

        result_df = result_df.merge(pos_df, on='date', how='left')
        result_df = result_df.merge(bca_df, on='date', how='left')
        result_df = result_df.merge(bri_df, on='date', how='left')

        result_df = result_df.fillna(0)
        result_df['bank_total'] = result_df['bca'] + result_df['bri']
        result_df['difference'] = result_df['bank_total'] - result_df['pos']
        result_df['date'] = result_df['date'].dt.strftime('%Y-%m-%d')

        for col in ['pos', 'bca', 'bri', 'bank_total', 'difference']:
            result_df[col] = result_df[col].astype(float)

        result = {
            "success": True,
            "data": result_df.to_dict(orient='records'),
            "totals": {
                "pos": float(result_df['pos'].sum()),
                "bca": float(result_df['bca'].sum()),
                "bri": float(result_df['bri'].sum()),
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

        fnb_categories = ('03-Food', 'FC01-Food', '04-Beverages', 'BC01-Beverages')
        base_where = "category IN %s AND business_date >= %s AND business_date <= %s"
        params = [fnb_categories, start_date + " 00:00:00", end_date + " 23:59:59"]
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

        food_cats = ('03-Food', 'FC01-Food')
        bev_cats = ('04-Beverages', 'BC01-Beverages')
        food_gross = float(df[df['category'].isin(food_cats)]['gross_amount'].sum())
        bev_gross = float(df[df['category'].isin(bev_cats)]['gross_amount'].sum())

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
    bank: Optional[str] = Query(None, description="Filter by bank: bca or bri"),
):
    """Merchant Bank Report - BCA and BRI transaction details with settlement info."""
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

        conn.close()

        # Combine
        df = pd.concat([bca_df, bri_df], ignore_index=True)

        if df.empty:
            return {
                "success": True,
                "metrics": {"total_gross": 0, "total_mdr": 0, "total_nett": 0, "mdr_rate": 0, "total_transactions": 0, "bca_total": 0, "bri_total": 0},
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

        metrics = {
            "total_gross": total_gross,
            "total_mdr": total_mdr,
            "total_nett": total_nett,
            "mdr_rate": mdr_rate,
            "total_transactions": len(df),
            "bca_total": bca_total,
            "bri_total": bri_total,
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


@app.get("/api/combined-report")
async def get_combined_report(
    start_date: str = Query(..., description="Start date YYYY-MM-DD"),
    end_date: str = Query(..., description="End date YYYY-MM-DD"),
    reports: str = Query("sales,discount,merchant", description="Comma-separated: sales,discount,merchant"),
    outlets: str = Query(None, description="Comma-separated outlet names (empty = all outlets)"),
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

        # POS item exclusions shared by every POS query (online / non-walk-in).
        item_exclusions = """
                          AND LOWER(item) NOT LIKE '%%blibli%%'
                          AND LOWER(item) NOT LIKE '%%tiketcom%%'
                          AND LOWER(item) NOT LIKE '%%tiket.com%%'
                          AND LOWER(item) NOT LIKE '%%tiket com%%'
                          AND LOWER(item) NOT LIKE '%%website%%'
                          AND LOWER(item) NOT LIKE '%%activity%%'
        """
        ts_params = [start_date + " 00:00:00", end_date + " 23:59:59"]

        output = io.BytesIO()
        sheets_written = False

        with pd.ExcelWriter(output, engine='openpyxl') as writer:

            # ===== SALES REPORT SHEET =====
            if 'sales' in report_list:
                pos_query = f"""
                    SELECT
                        DATE(business_date) as date,
                        outlet as store,
                        'Walk In Ticket' as platform,
                        SUM(gross_amount_excl) as gross_amount_excl,
                        SUM(discount) as discount,
                        SUM(net_sales) as net_sales,
                        SUM(tax) as tax,
                        SUM(charge) as charge,
                        SUM(gross_sales_all_incl) as gross_sales_all_incl
                    FROM pos_sales
                    WHERE business_date >= %s AND business_date <= %s
                      {outlet_filter_sql}
                      AND category IN ('01-Ticketing', 'SNP-TICKET-SPARK Ticket')
                      {item_exclusions}
                    GROUP BY DATE(business_date), outlet
                    ORDER BY DATE(business_date), outlet
                """
                pos_df = pd.read_sql(pos_query, conn, params=ts_params + outlet_params)

                # BRI ticketing, per date + outlet
                bri_query = f"""
                    SELECT tgl_trx as date, outlet, SUM(amt_trx) as bri
                    FROM bri_transactions
                    WHERE tgl_trx IS NOT NULL AND tgl_trx >= %s AND tgl_trx <= %s
                      AND kategori = 'TICKET'
                      {outlet_filter_sql}
                    GROUP BY tgl_trx, outlet
                """
                bri_df = pd.read_sql(bri_query, conn, params=[start_date, end_date] + outlet_params)

                # BCA ticketing, real card payments settled/PAID, per date + outlet
                bca_query = f"""
                    SELECT process_effective_date as date, outlet, SUM(gross_amount) as bca
                    FROM bca_transactions
                    WHERE process_effective_date IS NOT NULL AND process_effective_date >= %s AND process_effective_date <= %s
                      AND kategori = 'TICKET'
                      AND card_type <> ''
                      AND merchant_payment_status = 'PAID'
                      {outlet_filter_sql}
                    GROUP BY process_effective_date, outlet
                """
                bca_df = pd.read_sql(bca_query, conn, params=[start_date, end_date] + outlet_params)

                # Nusapay: Walk In tickets with QRIS1-QRIS NUSA tender, per date + outlet
                nusapay_query = f"""
                    SELECT DATE(business_date) as date, outlet, SUM(gross_sales_all_incl) as nusapay
                    FROM pos_sales
                    WHERE business_date >= %s AND business_date <= %s
                      {outlet_filter_sql}
                      AND category IN ('01-Ticketing', 'SNP-TICKET-SPARK Ticket')
                      AND tender = 'QRIS1-QRIS NUSA'
                      {item_exclusions}
                    GROUP BY DATE(business_date), outlet
                """
                nusapay_df = pd.read_sql(nusapay_query, conn, params=ts_params + outlet_params)

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
                    if not nusapay_df.empty:
                        nusapay_df['date'] = pd.to_datetime(nusapay_df['date'])
                        pos_df = pos_df.merge(
                            nusapay_df.rename(columns={'outlet': 'store'}), on=['date', 'store'], how='left')
                    else:
                        pos_df['nusapay'] = 0

                    for col in ('bri', 'bca', 'nusapay'):
                        if col not in pos_df.columns:
                            pos_df[col] = 0
                    pos_df = pos_df.fillna(0)
                    pos_df['deposit'] = 0
                    pos_df['total_bank'] = pos_df['bri'] + pos_df['bca'] + pos_df['nusapay'] + pos_df['deposit']
                    # Diff = POS gross (all incl) - bank receipts. Negative means
                    # bank received more than POS recorded (matches finance format).
                    pos_df['diff'] = pos_df['gross_sales_all_incl'] - pos_df['total_bank']
                    pos_df = pos_df.sort_values(['date', 'store']).reset_index(drop=True)

                    sales_rows = []
                    sales_rows.append(['DAILY SALES REPORT'] + [None] * 14)
                    sales_rows.append(['Periode :', period_str] + [None] * 13)
                    sales_rows.append([None] * 15)
                    sales_rows.append([None, None, None, 'POS', None, None, None, None, None, 'Payment Method / Merchant Report'] + [None] * 5)
                    sales_rows.append(['Date', 'Store', 'Platform', 'Gross Amount Excl.', 'Discount', 'Net Sales', 'Tax', 'Charge', 'Gross Sales (All incl)', 'BRI', 'BCA', 'Nusapay', 'Deposit', 'Total', 'Diff'])

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
                            row['nusapay'],
                            row['deposit'],
                            row['total_bank'],
                            row['diff'],
                        ])

                    sales_rows.append([None] * 15)
                    sales_rows.append([None] * 15)
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
                        pos_df['nusapay'].sum(),
                        pos_df['deposit'].sum(),
                        pos_df['total_bank'].sum(),
                        pos_df['diff'].sum(),
                    ])

                    sales_sheet = pd.DataFrame(sales_rows)
                    sales_sheet.to_excel(writer, sheet_name='Sales Report', index=False, header=False)
                    sheets_written = True

            # ===== DISCOUNT REPORT SHEET =====
            if 'discount' in report_list:
                discount_query = f"""
                    SELECT
                        business_date as date,
                        outlet as store,
                        'Walk In Ticket' as platform,
                        bill_no,
                        ROUND(SUM(discount * 1.1)) as total_discount,
                        MAX(remarks) as remark
                    FROM pos_sales
                    WHERE business_date >= %s AND business_date <= %s
                      {outlet_filter_sql}
                      AND category IN ('01-Ticketing', 'SNP-TICKET-SPARK Ticket')
                      {item_exclusions}
                      AND discount > 0
                    GROUP BY business_date, outlet, bill_no
                    ORDER BY business_date, outlet, bill_no
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
                # BRI ticketing per date + outlet
                bri_merchant_query = f"""
                    SELECT
                        tgl_trx as date,
                        outlet as store,
                        SUM(amt_trx) as amount,
                        SUM(disc_amt) as mdr
                    FROM bri_transactions
                    WHERE tgl_trx IS NOT NULL AND tgl_trx >= %s AND tgl_trx <= %s
                      AND kategori = 'TICKET'
                      {outlet_filter_sql}
                    GROUP BY tgl_trx, outlet
                """
                bri_merchant = pd.read_sql(bri_merchant_query, conn, params=[start_date, end_date] + outlet_params)
                if not bri_merchant.empty:
                    bri_merchant['date'] = pd.to_datetime(bri_merchant['date'])
                    bri_merchant['net'] = bri_merchant['amount'] - bri_merchant['mdr']

                # BCA ticketing, real card payments settled/PAID, per date + outlet
                bca_merchant_query = f"""
                    SELECT
                        process_effective_date as date,
                        outlet as store,
                        SUM(gross_amount) as amount,
                        SUM(mdr_amount) as mdr,
                        SUM(nett_amount) as net
                    FROM bca_transactions
                    WHERE process_effective_date IS NOT NULL AND process_effective_date >= %s AND process_effective_date <= %s
                      AND kategori = 'TICKET'
                      AND card_type <> ''
                      AND merchant_payment_status = 'PAID'
                      {outlet_filter_sql}
                    GROUP BY process_effective_date, outlet
                """
                bca_merchant = pd.read_sql(bca_merchant_query, conn, params=[start_date, end_date] + outlet_params)
                if not bca_merchant.empty:
                    bca_merchant['date'] = pd.to_datetime(bca_merchant['date'])

                # Nusapay: Walk In tickets with QRIS1-QRIS NUSA tender - MDR rate 0.7%, per date + outlet
                nusapay_merchant_query = f"""
                    SELECT
                        DATE(business_date) as date,
                        outlet as store,
                        SUM(gross_sales_all_incl) as amount
                    FROM pos_sales
                    WHERE business_date >= %s AND business_date <= %s
                      {outlet_filter_sql}
                      AND category IN ('01-Ticketing', 'SNP-TICKET-SPARK Ticket')
                      AND tender = 'QRIS1-QRIS NUSA'
                      {item_exclusions}
                    GROUP BY DATE(business_date), outlet
                """
                nusapay_merchant = pd.read_sql(nusapay_merchant_query, conn, params=ts_params + outlet_params)
                if not nusapay_merchant.empty:
                    nusapay_merchant['date'] = pd.to_datetime(nusapay_merchant['date'])
                    nusapay_merchant['mdr'] = nusapay_merchant['amount'] * 0.007  # 0.7% MDR
                    nusapay_merchant['net'] = nusapay_merchant['amount'] - nusapay_merchant['mdr']

                # Union of (date, store) keys across all three sources.
                keys = set()
                for dfm in (bri_merchant, bca_merchant, nusapay_merchant):
                    if not dfm.empty:
                        keys.update(zip(dfm['date'].tolist(), dfm['store'].tolist()))
                keys = sorted(keys, key=lambda k: (k[0], k[1]))

                def _lookup(dfm, date, store):
                    if dfm.empty:
                        return None
                    sub = dfm[(dfm['date'] == date) & (dfm['store'] == store)]
                    return sub.iloc[0] if len(sub) > 0 else None

                merchant_rows = []
                merchant_rows.append(['MERCHANT REPORT'] + [None] * 17)
                merchant_rows.append(['Periode :', period_str] + [None] * 16)
                merchant_rows.append([None] * 18)
                merchant_rows.append(['Date', 'Store', 'Platform', 'BRI', None, None, 'BCA', None, None, 'NUSAPAY', None, None, 'DEPOSIT', None, None, 'TOTAL', None, None])
                merchant_rows.append([None, None, None, 'Amont Transaction', 'MDR', 'Net Amount', 'Amont Transaction', 'MDR', 'Net Amount', 'Amont Transaction', 'MDR', 'Net Amount', 'Amont Transaction', 'MDR', 'Net Amount', 'Amont Transaction', 'MDR', 'Net Amount'])

                totals = {'bri_amt': 0, 'bri_mdr': 0, 'bri_net': 0, 'bca_amt': 0, 'bca_mdr': 0, 'bca_net': 0, 'nusapay_amt': 0, 'nusapay_mdr': 0, 'nusapay_net': 0}

                for date, store in keys:
                    bri_row = _lookup(bri_merchant, date, store)
                    bca_row = _lookup(bca_merchant, date, store)
                    nusapay_row = _lookup(nusapay_merchant, date, store)

                    bri_amt = float(bri_row['amount']) if bri_row is not None else 0
                    bri_mdr = float(bri_row['mdr']) if bri_row is not None else 0
                    bri_net = float(bri_row['net']) if bri_row is not None else 0
                    bca_amt = float(bca_row['amount']) if bca_row is not None else 0
                    bca_mdr = float(bca_row['mdr']) if bca_row is not None else 0
                    bca_net = float(bca_row['net']) if bca_row is not None else 0
                    nusapay_amt = float(nusapay_row['amount']) if nusapay_row is not None else 0
                    nusapay_mdr = float(nusapay_row['mdr']) if nusapay_row is not None else 0
                    nusapay_net = float(nusapay_row['net']) if nusapay_row is not None else 0

                    totals['bri_amt'] += bri_amt
                    totals['bri_mdr'] += bri_mdr
                    totals['bri_net'] += bri_net
                    totals['bca_amt'] += bca_amt
                    totals['bca_mdr'] += bca_mdr
                    totals['bca_net'] += bca_net
                    totals['nusapay_amt'] += nusapay_amt
                    totals['nusapay_mdr'] += nusapay_mdr
                    totals['nusapay_net'] += nusapay_net

                    total_amt = bri_amt + bca_amt + nusapay_amt
                    total_mdr = bri_mdr + bca_mdr + nusapay_mdr
                    total_net = bri_net + bca_net + nusapay_net

                    merchant_rows.append([
                        date.strftime('%Y-%m-%d'),
                        store,
                        'Walk In Ticket',
                        bri_amt, bri_mdr, bri_net,
                        bca_amt, bca_mdr, bca_net,
                        nusapay_amt, nusapay_mdr, nusapay_net,
                        0, 0, 0,
                        total_amt, total_mdr, total_net,
                    ])

                merchant_rows.append([None] * 18)
                merchant_rows.append([None] * 18)
                total_all_amt = totals['bri_amt'] + totals['bca_amt'] + totals['nusapay_amt']
                total_all_mdr = totals['bri_mdr'] + totals['bca_mdr'] + totals['nusapay_mdr']
                total_all_net = totals['bri_net'] + totals['bca_net'] + totals['nusapay_net']
                merchant_rows.append([
                    None, 'TOTAL', None,
                    totals['bri_amt'], totals['bri_mdr'], totals['bri_net'],
                    totals['bca_amt'], totals['bca_mdr'], totals['bca_net'],
                    totals['nusapay_amt'], totals['nusapay_mdr'], totals['nusapay_net'],
                    0, 0, 0,
                    total_all_amt, total_all_mdr, total_all_net,
                ])

                merchant_sheet = pd.DataFrame(merchant_rows)
                merchant_sheet.to_excel(writer, sheet_name='Merchant Report', index=False, header=False)
                sheets_written = True

            # Add empty sheet if no sheets were written
            if not sheets_written:
                empty_df = pd.DataFrame([['No data available']])
                empty_df.to_excel(writer, sheet_name='Info', index=False, header=False)

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
