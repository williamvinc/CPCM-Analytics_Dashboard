import pandas as pd
import re
import io
import base64
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import math

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/api/transform/sales")
async def transform_sales(file: UploadFile = File(...)):
    if not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="Only .xlsx files are supported.")

    try:
        contents = await file.read()
        # Read data assuming the header is on the 7th row (skip rows 0-5)
        df = pd.read_excel(io.BytesIO(contents), skiprows=6)

        # Validate required columns
        required_cols = ['Category', 'Item', 'Gross Amount']
        missing_cols = [col for col in required_cols if col not in df.columns]

        if missing_cols:
            raise HTTPException(status_code=400, detail=f"Missing columns: {', '.join(missing_cols)}")

        # --- Parse Business Date ---
        has_date = 'Business Date' in df.columns
        if has_date:
            df['Business Date'] = pd.to_datetime(df['Business Date'], errors='coerce')

        # 1. Filter rows
        valid_categories = ["01-Ticketing", "TC01-Ticket Cartenz"]
        df_filtered = df[df['Category'].isin(valid_categories)].copy()

        # 2. Create new columns
        df_filtered['New Category'] = 'null'
        df_filtered['Source'] = 'null'

        indices_to_drop = []

        # 3 & 4. Item Identification
        for idx, row in df_filtered.iterrows():
            item = str(row['Item']).strip()
            item_lower = item.lower()
            category = str(row['Category'])
            gross_amt = row['Gross Amount']

            try:
                gross_amt_val = float(gross_amt)
            except (ValueError, TypeError):
                gross_amt_val = None

            # Check for Socks first
            if re.search(r'\b(XXS|XS|S|M|L)$', item, re.IGNORECASE):
                df_filtered.at[idx, 'Source'] = 'KAOS KAKI'
                if gross_amt_val == 0 or math.isnan(gross_amt_val) if isinstance(gross_amt_val, float) else False:
                    indices_to_drop.append(idx)
                continue

            new_cat = 'null'
            source = 'null'

            # --- IDENTIFY NEW CATEGORY ---
            if re.search(r'2\s*jam', item_lower):
                new_cat = 'Tiket Bermain - 2 Jam'
            elif re.search(r'3\s*jam', item_lower):
                new_cat = 'Tiket Bermain - 3 Jam'
            elif re.search(r'(1\s*comp|companion\s*1)', item_lower):
                new_cat = 'Tiket Pendamping - 1 Orang'
            elif re.search(r'(2\s*comp|companion\s*2)', item_lower):
                new_cat = 'Tiket Pendamping - 2 Orang'

            # --- IDENTIFY SOURCE ---
            if new_cat == 'null':
                source = 'null'
            elif 'blibli' in item_lower:
                source = 'BLIBLI'
            elif re.search(r'tiket\s*com|ticket\s*com|tiket\.com|ticket\.com', item_lower):
                source = 'TIKET.COM'
            elif 'website' in item_lower or 'web' in item_lower:
                source = 'WEBSITE'
            elif re.search(r'skye|marshall|sbsp', item_lower):
                source = 'KAOS KAKI'
            else:
                source = 'WALK IN'

            df_filtered.at[idx, 'New Category'] = new_cat
            df_filtered.at[idx, 'Source'] = source

        # Apply row deletion for socks with Gross Amount 0
        df_result = df_filtered.drop(index=indices_to_drop)

        # Hide rows where both 'New Category' and 'Source' are 'null'
        df_result = df_result[~((df_result['New Category'] == 'null') & (df_result['Source'] == 'null'))]

        # Hide Unnamed columns (if present)
        unnamed_cols = [col for col in df_result.columns if 'Unnamed:' in str(col)]
        if unnamed_cols:
            df_result = df_result.drop(columns=unnamed_cols)

        # --- Compute numeric columns safely ---
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

        # =====================================================
        # BUILD ANALYTICS DATA
        # =====================================================

        # --- METRICS ---
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

        # --- AVAILABLE MONTHS (for filter) ---
        available_months = []
        if has_date:
            df_result['_month'] = df_result['Business Date'].dt.to_period('M')
            months = df_result['_month'].dropna().unique()
            months_sorted = sorted(months)
            available_months = [str(m) for m in months_sorted]

        # --- CHART: Daily Trend ---
        chart_daily = []
        if has_date:
            daily_df = df_result.copy()
            daily_df['_date_str'] = daily_df['Business Date'].dt.strftime('%Y-%m-%d')
            daily_grouped = daily_df.groupby('_date_str', as_index=False).agg({
                'Gross Amount': 'sum',
                'Item Qty': 'sum',
            } if has_qty else {
                'Gross Amount': 'sum',
            })
            daily_grouped = daily_grouped.sort_values('_date_str')
            daily_grouped = daily_grouped.rename(columns={'_date_str': 'date'})
            chart_daily = daily_grouped.to_dict(orient='records')

        # --- CHART: Monthly Trend ---
        chart_monthly = []
        if has_date:
            monthly_df = df_result.copy()
            monthly_df['_month_str'] = monthly_df['Business Date'].dt.strftime('%Y-%m')
            monthly_grouped = monthly_df.groupby('_month_str', as_index=False).agg({
                'Gross Amount': 'sum',
                'Item Qty': 'sum',
            } if has_qty else {
                'Gross Amount': 'sum',
            })
            monthly_grouped = monthly_grouped.sort_values('_month_str')
            monthly_grouped = monthly_grouped.rename(columns={'_month_str': 'month'})
            chart_monthly = monthly_grouped.to_dict(orient='records')

        # --- CHART: Gross Amount by New Category ---
        chart1_df = df_result[df_result['New Category'] != 'null'].copy()
        chart1_grouped = chart1_df.groupby('New Category', as_index=False)['Gross Amount'].sum()
        chart1_data = chart1_grouped.to_dict(orient='records')

        # --- CHART: Gross Amount by Source ---
        chart2_df = df_result[df_result['Source'] != 'null'].copy()
        chart2_grouped = chart2_df.groupby('Source', as_index=False)['Gross Amount'].sum()
        chart2_data = chart2_grouped.to_dict(orient='records')

        # --- CHART: Tender (Payment Method) breakdown ---
        chart_tender = []
        if 'Tender' in df_result.columns:
            tender_df = df_result.copy()
            tender_df['Tender'] = tender_df['Tender'].astype(str).str.strip()
            tender_df = tender_df[tender_df['Tender'] != '']
            tender_grouped = tender_df.groupby('Tender', as_index=False)['Gross Amount'].sum()
            chart_tender = tender_grouped.to_dict(orient='records')

        # --- TABLE PREVIEW ---
        # Convert dates to string for JSON
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

        # --- ALL DATA for client-side filtering ---
        all_data = df_result.to_dict(orient='records')

        # Generate Excel Download File in Memory
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
            "total_rows": len(df_result)
        }

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

        # Validate required columns (Store is now optional)
        required_cols = ['Project', 'Port', 'Total ticket out', 'Total Coin Input', 'Billing Period']
        missing_cols = [col for col in required_cols if col not in df.columns]
        if missing_cols:
            raise HTTPException(status_code=400, detail=f"Missing columns: {', '.join(missing_cols)}")

        has_store_column = 'Store' in df.columns
        has_game_type = 'Game Type' in df.columns

        # Rename columns
        df = df.rename(columns={
            'Project': 'Machine Name',
            'Port': 'Player Side',
        })

        # Exclude 'Total' rows and blank machine names
        if has_store_column:
            df = df[df['Store'].astype(str).str.strip().str.lower() != 'total']
        # Always filter out rows where Machine Name is empty or 'Total'
        df = df[df['Machine Name'].astype(str).str.strip() != '']
        df = df[df['Machine Name'].astype(str).str.strip().str.lower() != 'total']

        # Parse numeric columns
        df['Total ticket out'] = pd.to_numeric(df['Total ticket out'], errors='coerce').fillna(0)
        df['Total Coin Input'] = pd.to_numeric(df['Total Coin Input'], errors='coerce').fillna(0)

        # Parse billing period
        df['Billing Period'] = pd.to_datetime(df['Billing Period'], errors='coerce')
        df['_date_str'] = df['Billing Period'].dt.strftime('%Y-%m-%d')
        df['_month'] = df['Billing Period'].dt.to_period('M')

        # Available months for filtering
        months = df['_month'].dropna().unique()
        months_sorted = sorted(months)
        available_months = [str(m) for m in months_sorted]

        # Available stores for filtering
        available_stores = sorted([str(s) for s in df['Store'].dropna().unique() if str(s).strip() != '']) if has_store_column else []

        # Available game types for filtering
        available_game_types = sorted([str(g) for g in df['Game Type'].dropna().unique() if str(g).strip() != '']) if has_game_type else []

        # ALL ROW DATA (for client-side filtering)
        df_export = df.copy()
        df_export['Billing Period'] = df_export['Billing Period'].dt.strftime('%Y-%m-%d')
        if '_month' in df_export.columns:
            df_export = df_export.drop(columns=['_month', '_date_str'], errors='ignore')
        df_export = df_export.fillna("")
        all_data = df_export.to_dict(orient='records')

        # GROUP BY Machine Name + Player Side (aggregated table)
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

        # METRICS (totals)
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

        # CHART: Top machines by Ticket Out
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

        # CHART: Daily trend
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

        # Generate Excel Download
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


@app.post("/api/transform/machine-rate-card")
async def transform_machine_rate_card(file: UploadFile = File(...)):
    """Parse the second Excel file (no headers) with columns: Machine Name, Player Side, Ticket Leak"""
    if not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="Only .xlsx files are supported.")

    try:
        contents = await file.read()
        df = pd.read_excel(io.BytesIO(contents), header=None)

        # Expect exactly 3 columns
        if len(df.columns) < 3:
            raise HTTPException(status_code=400, detail=f"Expected at least 3 columns, got {len(df.columns)}")

        # Name the first 3 columns
        df = df.iloc[:, :3]
        df.columns = ['Machine Name', 'Player Side', 'Ticket Leak']

        # Clean data
        df['Machine Name'] = df['Machine Name'].astype(str).str.strip()
        df['Player Side'] = df['Player Side'].astype(str).str.strip()
        df['Ticket Leak'] = pd.to_numeric(df['Ticket Leak'], errors='coerce').fillna(0)

        # Filter out empty machine names
        df = df[df['Machine Name'] != '']
        df = df[df['Machine Name'].str.lower() != 'nan']

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
