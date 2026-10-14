# CPCM Analytics Dashboard - Developer Notes

## Untuk AI Agent yang Mengerjakan Project Ini

### Chart Animations (WAJIB)
Setiap chart di semua halaman HARUS menggunakan animasi:
1. Wrap chart dengan `<AnimatedChart>` component dari `@/components/animated-chart`
2. Tambahkan props animasi ke Recharts components:
   - **Area/Line**: `isAnimationActive={true} animationDuration={1500} animationEasing="ease-out"`
   - **Bar**: `isAnimationActive={true} animationDuration={800} animationEasing="ease-out"`
   - **Pie**: `isAnimationActive={true} animationDuration={1000} animationEasing="ease-out"`
3. Untuk grid layout (2 charts side-by-side), wrap SETIAP chart individual dengan `<AnimatedChart>`, BUKAN grid container-nya

Contoh:
```tsx
import { AnimatedChart } from "@/components/animated-chart"

// BENAR - wrap individual charts
<div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
  <AnimatedChart className="space-y-3">
    <ChartContainer>
      <BarChart>
        <Bar isAnimationActive={true} animationDuration={800} animationEasing="ease-out" />
      </BarChart>
    </ChartContainer>
  </AnimatedChart>
  <AnimatedChart className="space-y-3">
    ...
  </AnimatedChart>
</div>

// SALAH - jangan wrap grid container
<AnimatedChart className="grid grid-cols-1 lg:grid-cols-2 gap-8">
  ...
</AnimatedChart>
```

---

## Sales Channels (Sumber Penjualan Tiket)

### Channel yang Tersedia di Database

| Channel | Pattern di Item Name | Status di Report |
|---------|---------------------|------------------|
| Walk In | Tidak ada prefix channel | ✅ Masuk report |
| Blibli | `blibli` | ❌ Excluded |
| Tiketcom | `tiketcom`, `tiket.com`, `tiket com` | ❌ Excluded |
| Website | `website` | ❌ Excluded |
| Activity | `activity` | ❌ Excluded |

### Definisi "Walk In"
Walk In adalah penjualan tiket langsung di outlet (POS) yang BUKAN dari online marketplace. 
Di database, walk in diidentifikasi sebagai item yang:
- Kategori: lihat "Kategori Tiket" di bawah (nama kategori berubah per-store sejak Juli 2026)
- Item name TIDAK mengandung: blibli, tiketcom, tiket.com, website, activity
- Match pattern tiket: 2jam, 3jam, 1comp, 2comp, extra, birthday, field trip, promo, **super fun**, kaos kaki

### Kenapa Online Channel Di-exclude?
Saat ini report fokus ke Walk In karena:
1. Validasi dengan finance menggunakan data Walk In
2. Online channels punya flow revenue berbeda (marketplace fee, etc)
3. Kedepannya bisa ditambahkan sebagai filter terpisah

---

## Ticket Filter Definition

### Kategori Tiket
PENTING: nama kategori di `pos_sales` berubah mulai Juli 2026 (dipisah per store).
Filter harus mencakup nama lama DAN baru, kalau tidak data bulan lama hilang:

| Periode | Senayan (SNP) | Carstensz (CPP) |
|---------|---------------|-----------------|
| Jan–Jun 2026 | `01-Ticketing` | `TC01-Ticket Cartenz` |
| Jul 2026 (transisi) | `01-Ticketing` + `SNP-TICKET-SPARK Ticket` | `TC01-Ticket Cartenz` + `CPP-TICKET-Carstensz Ticket` |
| Agu 2026 dst | `SNP-TICKET-SPARK Ticket` | `CPP-TICKET-Carstensz Ticket` |

Kategori yang dipakai report Walk In (Quick Export, channel `walk_in`):
1. `01-Ticketing`
2. `TC01-Ticket Cartenz`
3. `SNP-TICKET-SPARK Ticket`
4. `CPP-TICKET-Carstensz Ticket`
5. `SNP-RETAIL-SPARK Retail`
6. `CPP-RETAIL-Carstensz Retail`
7. `SNP-BIRTHDAY-SPARK Birthday Package`
8. `CPP-BIRTHDAY-Carstensz Birthday Package`
9. `SNP-FIELDTRIP-SPARK Fieldtrip Package`
10. `CPP-FIELDTRIP-Carstensz Fieldtrip Package`

Catatan: `02-Retail` TIDAK dipakai di walk in — itu channel Retail JMH (dipakai
halaman JMH Retail Report & channel `retail_jmh`). Kategori BIRTHDAY/FIELDTRIP
tetap ikut karena item pattern walk in memang mencakup birthday & field trip.

### Item Filter (Pattern Match)
Hanya item yang match pattern berikut yang masuk report:
- `2\s*jam` — Tiket bermain 2 jam
- `3\s*jam` — Tiket bermain 3 jam  
- `1\s*comp|companion\s*1` — Tiket pendamping 1 orang
- `2\s*comp|companion\s*2` — Tiket pendamping 2 orang
- `extra` — Extra time (30 min, etc)
- `birthday` — Birthday packages (backdrop, paket ulang tahun)
- `field\s*trip` — Field trip tickets
- `promo` — Promo (mis. `PRM-SPF-001-Promo Super Fun`)
- `super\s*fun` — Promo Super Fun (ditambahkan Sep 2026, sebelumnya sudah
  ikut ke-match lewat `promo` karena nama itemnya "Promo Super Fun")
- `(XXS|XS|S|M|L)$` dengan `gross_sales_all_incl > 0` — Kaos kaki dengan penjualan
- `category_2 = 'CPP-ADD-Additional Ticket' AND item ~ 'companion'` — Companion
  dari CPP-ADD (Companion 1 Pax / 2 Pax). **PENTING:** item CPP-ADD lainnya
  (RTL-COIN, ADD-PUPB Pup Pup Boogie, DIY Face Painting) **tidak masuk walk_in**
  karena itu Activity, bukan tiket. Sebelumnya semua CPP-ADD masuk walk_in dan
  menyebabkan selisih dengan data Finance (mis. 2 Sep CPP +20k, 4 Sep CPP +200k).

### Item Exclusions (Online Channels)
Item berikut di-exclude:
- `blibli`
- `tiketcom`
- `tiket.com`
- `tiket com`
- `website`
- `activity`

### Outlet Rename (Display Only)
- `OUTLET01-Park Nickelodeon` (Senayan) → tampil sebagai `SNP`
- `OUTLET02-Nickelodeon Theme Park Carstensz Mall` → tampil sebagai `CPP`

Data di database tetap (POS dan tabel bank sama-sama menyimpan nama panjang),
hanya display di report yang berubah jadi SNP/CPP.

PENTING: POS dan tabel bank HARUS dikelompokkan dengan ekspresi store yang sama.
Kalau POS di-map ke SNP/CPP tapi bank masih pakai `outlet as store`, merge
`on=['date','store']` tidak ketemu → kolom bank jadi 0/kosong di Quick Export.

---

## Bank Filter (POS vs Bank Reconciliation)

Kolom `kategori` dan `outlet` di tabel bank adalah kolom turunan (lihat
`derive_kategori` / `derive_outlet` di `~/cpcm/db/dags/bca.py`):
- `kategori = 'TICKET'` bila merchant name mengandung NICKELODEON atau PAW PATROL
- `kategori = 'FNB'` bila mengandung GARFIELD / MR PORTER
- `outlet` = OUTLET01 (Senayan) / OUTLET02 (Carstensz)

### BRI
- Tabel `bri_transactions`, kolom tanggal `tgl_trx`
- Filter: `kategori = 'TICKET'`

### BCA
- Tabel `bca_transactions`, kolom tanggal `process_effective_date`
- Filter: `kategori = 'TICKET'` + `card_type <> ''` + `merchant_payment_status = 'PAID'`

### BNI
- Tabel `bni_transactions`, kolom tanggal `trx_date`
- Filter: `kategori = 'TICKET'`

### Nusapay
- Dari POS dengan `tender LIKE '%QRIS1-QRIS NUSA%'` + filter tiket yang sama

### Deposit & Voucher
- Deposit: POS `tender LIKE '%DPS1-DEPOSIT%'`
- Voucher: POS `tender LIKE '%VOUCHER%'` — pakai LIKE karena di kasir bisa
  gabung dengan tender lain, mis. `QRIS-QRIS BRI, VOUCHER-Discount Value`

---

## Format Export POS Baru (September 2026)

Finance mengubah export POS mulai September 2026. DAG `synology_pos_file_listener`
(`~/cpcm/db/dags/pos.py`) sekarang mendeteksi format dari **nama header**, bukan
posisi kolom, jadi penambahan kolom berikutnya tidak menggeser data.

| | Format lama (s/d Agustus 2026) | Format baru (September 2026+) |
|---|---|---|
| Jumlah kolom | 21 (1 kolom kosong/nomor baris + 20 data) | 30 (tanpa kolom kosong di kiri) |
| Header | baris ke-7 | baris ke-7 |
| `Category 2` | tidak ada | ada, di posisi ke-6 (setelah `Category`) |
| Baris pemisah `Business Date:` | ada per tanggal | tidak ada |
| Baris `Subtotal` / `Grand Total` | ada | hanya `Grand Total` di akhir |
| Kolom tambahan | — | Inventory Cost, Std. Cost, Point Awarded, Point Redeemed, Gross Profit (+%), Gross Profit (Actual) (+%), Promo Qty — **belum dipakai** |

Yang penting:
- **`Category` berubah arti.** Untuk item F&B, `category` sekarang berisi mode
  penjualan (`DINE-IN-DINE-IN`, `TAKEAWAY-TAKEAWAY`, `ONLINE-DELIVERY-ONLINE DELIVERY`,
  `PACKAGING-MOD-PACKAGING-MOD`), dan jenis produknya pindah ke `Category 2`
  (`01-Pizza`, `BEV-GARFIELD-...`, `FC0103-Main`, dst).
- **Kolom `category_2`** (tabel `pos_sales`) diisi NULL untuk file format lama,
  jadi bisa dipakai sebagai penanda format: `category_2 IS NULL` = data lama.
- **`row_hash`** file lama tetap dihitung dari 20 kolom lama saja, dan file baru
  dari 21 kolom — supaya upload ulang file yang sama tetap ter-deduplikasi
  (`ON CONFLICT (row_hash) DO NOTHING`). Sudah diverifikasi: hash baris lama hasil
  parser baru identik dengan baris yang sudah ada di database.
- Baris yang tidak punya `business_date` (Subtotal/Grand Total/baris kosong)
  dibuang. Kalau lebih dari separuh baris tidak punya tanggal, file dianggap tidak
  dikenali → masuk `failed/` + notifikasi Telegram (tidak insert data sampah).

### Dua Sheet F&B di Quick Export (terikat periode)

Karena format lama dan baru tidak bisa digabung dalam satu sheet, F&B dipecah jadi
dua sheet yang **masing-masing hanya berlaku untuk satu periode**. Batasnya `end_date`
dibandingkan dengan `FNB_NEW_FORMAT_START = '2026-09-01'` di `backend/main.py`.

| Report id | Sheet | Kolom | Periode |
|-----------|-------|-------|---------|
| `cafe` | `Cafe Sales Report` | 20 (Food & Beverage) | sebelum 1 Sep 2026 |
| `newsales` | `FNB New Report` | 25 (+ Packaging, + BNI) | 1 Sep 2026 ke atas |

- Sheet yang periodenya tidak cocok **tidak dibuat** dan alasannya ditulis di sheet
  **`Info`** — jadi export tidak pernah gagal, tapi juga tidak pernah diam-diam
  mengirim sheet dengan format yang salah.
- Periode yang melewati September (mis. 15 Agu – 15 Sep) dianggap periode baru;
  baris Agustus tetap masuk lewat fallback `category` lama.
- Layout lama 20 kolom bukan kode terpisah: baris layout baru diproyeksikan lewat
  `fnb_old_layout()` / `CAFE_OLD_COLUMNS` (buang kolom Packaging + BNI; Total & Diff
  tetap angka yang sama). Sudah diverifikasi: angka Agustus 2026 identik dengan
  baseline sebelum perubahan (Total 397.097.831, Diff 6.038.064).
- Di frontend (`components/quick-export.tsx`) pilihan sheet F&B **ditukar otomatis**
  saat periode melewati batas September, supaya tidak perlu unselect manual.
  Konstanta `FNB_NEW_FORMAT_START` di frontend harus sama dengan yang di backend.

### Format Tanggal di Quick Export

Semua sel tanggal di semua sheet Quick Export memakai **`yyyy-mm-dd`**. Satu-satunya
yang dulu menyimpang adalah sheet `New Tiketcom` (Order Date / Visit Date / Valid
Until / Settlement / Redeem Date memakai `yyyy-mm-dd HH:MM:SS`, mis.
`2026-08-01 08:45:38`) — sekarang sudah dipotong. Baris `Periode :` sengaja
dibiarkan `2026/09/01 - 2026/09/24` mengikuti template Finance.

### Order Tiket.com Multi-Tiket Tampil "Belum Redeem" (temuan + fix)

User melaporkan order `1356812012` / detail `1400560732` dan order `1356133373` /
detail `1400242336` (NICKELODEON PLAYTIME) sudah redeem di tiket.com tapi di sheet
**New Tiketcom** statusnya masih belum `Redeemed` (dan kolom *Redeem Date* kosong).
Ternyata bukan masalah sheet-nya, tapi parser ingest-nya. Dua bug di
`parse_value()` (`~/cpcm/db/dags/new_tiket.py`):

| Bug | Penyebab | Dampak |
|-----|----------|--------|
| `Redemption Date` hilang | Kolom ini berisi **satu timestamp per tiket**, dipisah koma (`01 Aug 2026 12:27:12,01 Aug 2026 12:27:12,...`) kalau `CHILD Total` > 1. `pd.to_datetime()` atas seluruh string melempar error, lalu `except: return None` — hilang tanpa log | 101 baris (semua order multi-tiket) `redemption_date` NULL → status `Available`/`Expired`, bukan `Redeemed` |
| `Settlement Date` bulan/tanggal tertukar | Format di file ISO (`2026-08-03 00:00:00`), tapi diparse `dayfirst=True` → day=08, month=03 | 96 baris tersimpan `2026-03-08` (harusnya `2026-08-03`) |

Perbaikannya di `parse_value()` / `parse_timestamp()`:
- nilai dipisah koma → diparse satu per satu, diambil yang **paling awal**;
- nilai yang berawalan `YYYY-MM-DD` diparse **tanpa** `dayfirst` (format tiket.com yang
  lain seperti `01 Aug 2026 23:59:59` tetap butuh `dayfirst`).

Data lama sudah di-backfill (171 baris: 100 `redemption_date` + 96 `settlement_date`).
Setelah backfill: 344 baris `Redeemed`, 15 `Expired`, 0 `Available`; rentang
`settlement_date` semua Agustus 2026 (nyambung dengan tanggal order).

#### Ingest-nya jadi upsert (per `order_detail_id`)

Perbaikan parser saja tidak cukup: `row_hash` dihitung dari **seluruh nilai mentah**
file, jadi baris yang isinya berubah (mis. order yang baru redeem) menghasilkan hash
baru → dengan `ON CONFLICT (row_hash) DO NOTHING` baris itu masuk sebagai **duplikat**,
bukan update. Karena export tiket.com sifatnya snapshot, ingest-nya diubah:

- Kunci natural tabel = **`order_detail_id`** (satu baris = satu detail order).
  `CREATE UNIQUE INDEX ..._order_detail_id_key`, dan UNIQUE di `row_hash` dilepas
  (diganti index biasa) supaya re-export tidak bentrok.
- `ON CONFLICT (order_detail_id) DO UPDATE SET col = COALESCE(EXCLUDED.col, table.col)`.
  Artinya **nilai baru yang terisi menang, nilai kosong tidak menghapus** nilai lama
  (`N/A`/`-`/blank → NULL tetap memakai data lama). `row_hash` tidak di-update, tetap
  jadi sidik jari baris saat pertama masuk.
- Sudah diuji: baris yang redeem-nya dikosongkan kembali terisi setelah file yang sama
  di-ingest ulang; kolom yang kosong di file (`refund_reason`) tidak menghapus nilai
  lama; kolom yang terisi (`settlement_status`) ikut ter-update; jumlah baris tetap
  359 (tidak ada duplikat).

DAG lain (`pos.py`, `bca.py`, `bri.py`, `bni.py`, `tiket.py`) tidak diubah — polanya
tetap pakai `row_hash` masing-masing.

### Bucket F&B (Food / Beverage / Packaging)

Sejak September, bucket diambil dari `category_2`; untuk data sebelum September
memakai nama `category` lama sebagai fallback (`category_2 IS NULL AND category IN ...`).

Sumber daftar item: `docs/fnb_category.xlsx` (sheet `List Item Category`) dari Finance.
Di `backend/main.py` daftar ini disimpan sekali di `FNB_BUCKETS` dan dipakai oleh
`/api/fnb-sales`, `/api/fnb-reconciliation`, dan sheet *Cafe Sales Report*.

| Outlet | Food | Beverage | Packaging |
|--------|------|----------|-----------|
| OUTLET01 (Garfield Café) | 01-Appetizers & Snacks, 02-Main Course, 03-Pizza, 04-Sides, 05-Dessert, 06-Other, GSNP001-Gelato, FOOD-GARFIELD-FOOD GARFIELD, TKA-GRF-Take Away | 01-Hot, 02-Cold, BEV-GARFIELD-BEVERAGES GARFIELD | TAKEAWAY-PACKAGING, PACKAGING-Packaging |
| OUTLET02 (Mr. Porter) | FC0101-Starter (C), FC0102-Pizza selection (C), FC0103-Main, FC0104-Kids Menu, FC0105-PAWSOME SNACK BREAK, FC0106-Dessert (C), FC0108-Takeaway, FC0109-Birthday Package (C), FOOD-PORTERS-FOOD PORTER'S, TKA-GRF-Take Away | BC0101-Coffee (C) … BC0107-Add-On, BEV-PORTERS-BEVERAGES PORTERS | TAKEAWAY-PACKAGING, PACKAGING-Packaging |

Catatan:
- **Packaging** nominalnya 0 (hanya mengeluarkan stock item, tidak ada biaya
  tambahan), tapi tetap muncul sebagai kolom di report. `FC0107` memang tidak ada.
- `CPP-FLT-Field Trip Package` masuk **Walk In**, bukan F&B.
- Kolom **BNI** ada di report (sempat terhapus, sudah dikembalikan).
- Sheet *FNB New Report* jadi **25 kolom** (Packaging ditambahkan di Gross Excl,
  Discount, Net Sales, Service Charge; urutan: Food, Beverage, Packaging).
  Sheet *Cafe Sales Report* tetap 20 kolom untuk periode sebelum September.
- Bug lama yang ikut diperbaiki: filter F&B memakai `'FC01-Food'` / `'BC01-Beverages'`
  yang tidak pernah match `'FC01-Food (C)'` / `'BC01-Beverages (C)'`, jadi F&B
  Carstensz tidak pernah muncul di `/api/fnb-sales`.

### Angka Validasi September (1–24 Sep 2026, dari `docs/new_posts_format.xlsx`)

Total POS seluruh file sudah dicek sama persis dengan baris `Grand Total` file
(10 kolom, selisih 0). Bucket F&B (gross amount excl) juga sama persis:

| Outlet | Food | Beverage | Packaging |
|--------|------|----------|-----------|
| OUTLET01 | 66.795.000 | 33.737.250 | 45.000 |
| OUTLET02 | 53.968.000 | 18.504.000 | 25.000 |

Walk in (gross_sales_all_incl) 1–24 Sep: OUTLET01 302.740.500 (tidak berubah),
OUTLET02 135.604.500 (naik 4.340.000 setelah `CPP-ADD-Additional Ticket` masuk).

**Diff Cafe September besar** (OUTLET01 +27,6 jt, OUTLET02 +48,2 jt) bukan karena
bucket F&B salah: data bank (`bri_transactions` s/d 9 Sep, `bca_transactions` s/d
10 Sep) belum ada untuk 11–24 Sep, sementara POS sudah lengkap. Diff 1–8 Sep ≈ 0.

### Kenapa 5 Sep 2026 Mr. Porter masih ada Diff (temuan)

Untuk periode 1–9 Sep (di mana data bank harusnya sudah lengkap), hanya **satu
store-day** yang tidak balance: **5 Sep, Mr. Porter, Diff +17.497.348**. Semua
store-day lain persis 0. Penyebabnya satu bill:

- `POS009/03266`, gross **13.357.773**, tender `EDC_BCA-EDC BCA`.
- Transaksinya **ada** di `bca_transactions` tanggal 5 Sep dengan `card_type='CRD'`,
  tapi `merchant_payment_status = 'PEND'` — bukan `'PAID'`. Filter BCA kita
  (`merchant_payment_status = 'PAID'`) jadi mengeluarkannya.

Sisa selisih kecil (± 0,1–1,5 jt) per hari berasal dari pergeseran cut-off
settlement: transaksi malam hari di POS muncul di tanggal bank berikutnya
(mis. 1 Sep: POS 1.202.801 vs bank 1.690.057).

Keputusan apakah status `PEND` ikut dihitung **belum diambil** — filter yang sama
dipakai sheet Walk In juga, jadi mengubahnya akan ikut mengubah angka walk in.

### Tender baru September 2026

`EDC_BCA-EDC BCA`, `EDC_BRI-EDC BRI`, `EDC_BNI-EDC BNI`, `QRIS3-QRIS BNI`,
`STARTHING-QR Starthing`, `POINT1-Redeem Point`.

`STARTHING` dan `POINT1` **tidak punya kolom** di report manapun, jadi nominalnya
masuk ke kolom `Diff`. Kalau Finance mau angka Diff bersih, dua tender ini perlu
kolom sendiri.

---

## Tender Types (Payment Methods)

| Tender Code | Description |
|-------------|-------------|
| `CASH-Cash` | Pembayaran tunai |
| `CC01-BRI` | Kartu kredit BRI |
| `CC02-BCA` | Kartu kredit BCA |
| `EDC1-NUSAPAY` | EDC Nusapay |
| `DPS1-DEPOSIT` | Pembayaran pakai deposit |
| `VOUCHER-Voucher Value` | Pembayaran pakai voucher |
| `QRIS1-QRIS NUSA` | QRIS Nusapay |

---

## Endpoints dan Filter Status

| Endpoint | Filter Applied |
|----------|---------------|
| `/api/combined-report` (Quick Export) | ✅ Ticket filter + Walk In only |
| `/api/reconciliation` (POS vs Bank) | ✅ Ticket filter |
| `/api/sales` (Dashboard Ticketing) | ✅ Ticket filter + Walk In only |
| `/api/fnb-sales` (F&B Report) | ❌ Separate filter (Food & Beverages categories) |

---

## Dashboard Metrics yang Terpengaruh

Metrics berikut menggunakan ticket filter (Walk In only):
- Total Gross Amount
- Net Sales
- Total Discount
- Total Tax
- Daily Gross Amount Trend
- Chart by Category (Tiket 2 Jam, 3 Jam, Companion, Extra Time, Birthday, Field Trip)
- Chart by Source (Walk In, Kaos Kaki)
- Payment Methods
- Busiest Days

---

## Angka Validasi dengan Finance

| Tanggal | Outlet | Metric | Value |
|---------|--------|--------|-------|
| 12 Mei 2026 | All | POS | 7,060,000 |
| 1 Juni 2026 | OUTLET01 | gross_excl | 54,781,827 |
| 1 Juni 2026 | OUTLET01 | gross_all | 33,435,000 |
| 3 Juni 2026 | OUTLET01 | gross_all | 7,065,000 |

---

## Quick Reference Commands

```bash
# Check unique items by channel
PGPASSWORD=xxx psql -h host -p port -U user -d db -c "
  SELECT DISTINCT item FROM pos_sales 
  WHERE category IN ('01-Ticketing', 'TC01-Ticket Cartenz')
  ORDER BY item;"

# Check tender types
PGPASSWORD=xxx psql -h host -p port -U user -d db -c "
  SELECT DISTINCT tender FROM pos_sales 
  WHERE tender IS NOT NULL ORDER BY tender;"
```
