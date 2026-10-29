"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { PlusCircle, Download, Loader2, Store } from "lucide-react"
import { DateRangePicker } from "@/components/ui/date-range-picker"
import { DateRange } from "react-day-picker"

type ReportType = 'sales' | 'discount' | 'merchant' | 'cafe' | 'newsales' | 'fnbmerchant' | 'activity' | 'activitymerchant' | 'tiketcom' | 'newtiketcom' | 'webvoucher'

interface ReportOption {
  id: ReportType
  label: string
  description: string
}

interface OutletOption {
  id: string
  label: string
}

const REPORT_OPTIONS: ReportOption[] = [
  { id: 'sales', label: 'Sales Report', description: 'Daily POS sales with bank reconciliation' },
  { id: 'discount', label: 'Discount Report', description: 'Discount details per transaction' },
  { id: 'merchant', label: 'Walk In Merchant Report', description: 'BCA, BRI & BNI transactions with MDR' },
  { id: 'cafe', label: 'Cafe Sales Report', description: 'F&B format lama (Food & Beverage) - periode sebelum Sep 2026' },
  { id: 'newsales', label: 'FNB New Report', description: 'F&B format baru (Packaging & BNI) - periode Sep 2026 ke atas' },
  { id: 'fnbmerchant', label: 'FNB Merchant Report', description: 'F&B settlement per merchant (BRI, BCA, BNI, Nusapay, Deposit) with MDR' },
  { id: 'activity', label: 'Activity Sales Report', description: 'Activity sales (Mrs. Puff, Pup Pup Boogie, DIY, etc.)' },
  { id: 'activitymerchant', label: 'Activity Merchant Report', description: 'Activity settlement per merchant (BRI, BCA, Nusapay, Deposit) with MDR' },
  { id: 'tiketcom', label: 'Tiket.com POS Report', description: 'Tiket.com sales with calculated prices (detail + rekap)' },
  { id: 'newtiketcom', label: 'All Transaction Tiket.com Report', description: 'New Tiket.com from new_tiket_transactions (with status)' },
  { id: 'webvoucher', label: 'Website Voucher Report', description: 'Validasi POS vs voucher website (jam bermain, jumlah kunjungan, kaos kaki)' },
]

const ALL_OUTLETS = '__all__'

// Format F&B berganti mulai September 2026 (Category 2 + kolom Packaging).
// Harus sama dengan FNB_NEW_FORMAT_START di backend.
const FNB_NEW_FORMAT_START = '2026-09-01'

export function QuickExport() {
  const today = new Date()
  const prevMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  const prevMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0)

  const [open, setOpen] = React.useState(false)
  const [selectedReports, setSelectedReports] = React.useState<ReportType[]>(['sales', 'discount', 'merchant', 'cafe', 'newsales', 'fnbmerchant', 'activity', 'activitymerchant', 'tiketcom', 'newtiketcom', 'webvoucher'])
  const [loading, setLoading] = React.useState(false)
  const [dateRange, setDateRange] = React.useState<DateRange | undefined>({
    from: prevMonthStart,
    to: prevMonthEnd,
  })
  const [progress, setProgress] = React.useState(0)
  const [status, setStatus] = React.useState<string>('')
  const [outlets, setOutlets] = React.useState<OutletOption[]>([])
  const [selectedOutlets, setSelectedOutlets] = React.useState<string[]>([ALL_OUTLETS])
  const [selectedChannel, setSelectedChannel] = React.useState<string>("walk_in")
  const [loadingOutlets, setLoadingOutlets] = React.useState(false)

  const formatDateStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  React.useEffect(() => {
    if (open && outlets.length === 0) {
      fetchOutlets()
    }
  }, [open])

  const fetchOutlets = async () => {
    setLoadingOutlets(true)
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000"
    try {
      const res = await fetch(`${backendUrl}/api/outlets`)
      if (res.ok) {
        const data = await res.json()
        setOutlets(data.outlets || [])
      }
    } catch (err) {
      console.error('Failed to fetch outlets:', err)
    } finally {
      setLoadingOutlets(false)
    }
  }

  const toggleOutlet = (outletId: string) => {
    if (outletId === ALL_OUTLETS) {
      setSelectedOutlets([ALL_OUTLETS])
    } else {
      setSelectedOutlets(prev => {
        const withoutAll = prev.filter(o => o !== ALL_OUTLETS)
        if (withoutAll.includes(outletId)) {
          const newSelection = withoutAll.filter(o => o !== outletId)
          return newSelection.length === 0 ? [ALL_OUTLETS] : newSelection
        } else {
          return [...withoutAll, outletId]
        }
      })
    }
  }

  const selectAllOutlets = () => {
    setSelectedOutlets([ALL_OUTLETS])
  }

  // Filter reports based on channel - hide irrelevant ones for retail_jmh
  const visibleReports = React.useMemo(() => {
    if (selectedChannel === 'retail_jmh') {
      return REPORT_OPTIONS.filter(r => ['sales', 'discount', 'merchant'].includes(r.id))
    }
    return REPORT_OPTIONS
  }, [selectedChannel])

  // When channel changes, remove hidden reports from selection
  React.useEffect(() => {
    if (selectedChannel === 'retail_jmh') {
      setSelectedReports(prev => prev.filter(r => ['sales', 'discount', 'merchant'].includes(r)))
    }
  }, [selectedChannel])

  // Format F&B terikat periode (sama dengan aturan backend): sebelum Sep 2026 pakai
  // 'Cafe Sales Report', Sep 2026 ke atas pakai 'FNB New Report'. Kalau salah satu
  // sedang dipilih, pilihan itu ditukar otomatis supaya tidak ada sheet yang dikirim
  // dengan format yang tidak cocok periodenya.
  const fnbPeriodIsNew = dateRange?.to ? formatDateStr(dateRange.to) >= FNB_NEW_FORMAT_START : false

  React.useEffect(() => {
    const wanted: ReportType = fnbPeriodIsNew ? 'newsales' : 'cafe'
    const unwanted: ReportType = fnbPeriodIsNew ? 'cafe' : 'newsales'
    setSelectedReports(prev => {
      const hasFnb = prev.includes('cafe') || prev.includes('newsales')
      if (!hasFnb || (prev.includes(wanted) && !prev.includes(unwanted))) return prev
      return [...prev.filter(r => r !== unwanted), wanted]
    })
  }, [fnbPeriodIsNew])

  const toggleReport = (reportId: ReportType) => {
    setSelectedReports(prev =>
      prev.includes(reportId)
        ? prev.filter(r => r !== reportId)
        : [...prev, reportId]
    )
  }

  const selectAllReports = () => {
    if (selectedChannel === 'retail_jmh') {
      setSelectedReports(['sales', 'discount', 'merchant'])
    } else {
      setSelectedReports(['sales', 'discount', 'merchant', 'cafe', 'newsales', 'fnbmerchant', 'activity', 'activitymerchant', 'tiketcom', 'newtiketcom', 'webvoucher'])
    }
  }

  const downloadFile = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const exportReports = async () => {
    if (selectedReports.length === 0) return

    setLoading(true)
    setProgress(10)
    setStatus('Preparing export...')

    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000"

    try {
      setProgress(30)
      setStatus('Fetching data from server...')

      const reportsParam = selectedReports.join(',')
      const outletsParam = selectedOutlets.includes(ALL_OUTLETS)
        ? ''
        : selectedOutlets.join(',')

      const startDate = dateRange?.from ? formatDateStr(dateRange.from) : ''
      const endDate = dateRange?.to ? formatDateStr(dateRange.to) : ''

      let url = `${backendUrl}/api/combined-report?start_date=${startDate}&end_date=${endDate}&reports=${reportsParam}&channel=${selectedChannel}`
      if (outletsParam) {
        url += `&outlets=${encodeURIComponent(outletsParam)}`
      }

      const res = await fetch(url)

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.detail || 'Failed to generate report')
      }

      setProgress(70)
      setStatus('Processing Excel file...')

      const data = await res.json()

      if (data.file_base64) {
        setProgress(90)
        setStatus('Downloading...')

        const byteCharacters = atob(data.file_base64)
        const byteNumbers = new Array(byteCharacters.length)
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i)
        }
        const blob = new Blob([new Uint8Array(byteNumbers)], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        })
        downloadFile(blob, data.filename || `Report_Mooboard_${startDate}_to_${endDate}.xlsx`)

        setProgress(100)
        setStatus('Export complete!')

        setTimeout(() => {
          setOpen(false)
          setLoading(false)
          setProgress(0)
          setStatus('')
        }, 1000)
      }
    } catch (err: any) {
      console.error('Export failed:', err)
      setStatus(`Error: ${err.message}`)
      setTimeout(() => {
        setLoading(false)
        setProgress(0)
        setStatus('')
      }, 3000)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      setOpen(isOpen)
      if (!isOpen) {
        setLoading(false)
        setProgress(0)
        setStatus('')
      }
    }}>
      <DialogTrigger asChild>
        <Button
          variant="default"
          className="w-full bg-rose-600 hover:bg-rose-700 text-white font-semibold"
        >
          <PlusCircle className="mr-2 h-4 w-4" />
          Quick Export
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[450px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Quick Export</DialogTitle>
          <DialogDescription>
            Export combined report with multiple sheets in one Excel file.
          </DialogDescription>
        </DialogHeader>

        {/* Date Range Selection */}
        <div className="p-3 rounded-lg border bg-muted/30">
          <DateRangePicker
            value={dateRange}
            onChange={setDateRange}
            className="w-full"
          />
        </div>

        {/* Outlet Selection */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Store className="w-4 h-4 text-muted-foreground" />
              <Label className="text-sm font-medium">Store / Outlet</Label>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={selectAllOutlets}
              disabled={loading || selectedOutlets.includes(ALL_OUTLETS)}
              className="h-6 px-2 text-xs"
            >
              All Outlets
            </Button>
          </div>
          <div className="grid gap-1.5 max-h-[140px] overflow-y-auto rounded-lg border p-2">
            {loadingOutlets ? (
              <div className="flex items-center justify-center py-3 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading outlets...
              </div>
            ) : (
              <>
                <div
                  className={`flex items-center space-x-3 p-2 rounded-md transition-colors cursor-pointer ${
                    selectedOutlets.includes(ALL_OUTLETS)
                      ? 'bg-rose-50 dark:bg-rose-950/30'
                      : 'hover:bg-muted/50'
                  }`}
                  onClick={() => toggleOutlet(ALL_OUTLETS)}
                >
                  <Checkbox
                    id="outlet-all"
                    checked={selectedOutlets.includes(ALL_OUTLETS)}
                    onCheckedChange={() => toggleOutlet(ALL_OUTLETS)}
                    disabled={loading}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <Label htmlFor="outlet-all" className="text-sm cursor-pointer font-medium">
                    All Outlets
                  </Label>
                </div>
                {outlets.map((outlet) => (
                  <div
                    key={outlet.id}
                    className={`flex items-center space-x-3 p-2 rounded-md transition-colors cursor-pointer ${
                      selectedOutlets.includes(outlet.id)
                        ? 'bg-rose-50 dark:bg-rose-950/30'
                        : 'hover:bg-muted/50'
                    }`}
                    onClick={() => toggleOutlet(outlet.id)}
                  >
                    <Checkbox
                      id={`outlet-${outlet.id}`}
                      checked={selectedOutlets.includes(outlet.id)}
                      onCheckedChange={() => toggleOutlet(outlet.id)}
                      disabled={loading}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <Label htmlFor={`outlet-${outlet.id}`} className="text-sm cursor-pointer">
                      {outlet.label}
                    </Label>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        {/* Channel Selection */}
        <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
          <Store className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="flex flex-col gap-1 flex-1">
            <Label className="text-xs text-muted-foreground">Sales Channel</Label>
            <select
              value={selectedChannel}
              onChange={(e) => setSelectedChannel(e.target.value)}
              disabled={loading}
              className="h-8 px-2 rounded-md border bg-background text-sm"
            >
              <option value="walk_in">Walk In (Default)</option>
              <option value="all">All Channels</option>
              <option value="retail_jmh">Retail (JMH)</option>
              <option value="blibli">Blibli</option>
              <option value="tiketcom">Tiket.com</option>
              <option value="website">Website</option>
            </select>
          </div>
        </div>

        {/* Report Selection */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Include Sheets</Label>
            <Button
              variant="ghost"
              size="sm"
              onClick={selectAllReports}
              disabled={loading || selectedReports.length === visibleReports.length}
              className="h-6 px-2 text-xs"
            >
              Select All
            </Button>
          </div>
          <div className="grid gap-2">
            {visibleReports.map((report) => (
              <div
                key={report.id}
                className={`flex items-center space-x-3 p-3 rounded-lg border transition-colors ${
                  selectedReports.includes(report.id)
                    ? 'bg-rose-50 border-rose-200 dark:bg-rose-950/30 dark:border-rose-800'
                    : 'hover:bg-muted/50'
                }`}
              >
                <Checkbox
                  id={report.id}
                  checked={selectedReports.includes(report.id)}
                  onCheckedChange={() => toggleReport(report.id)}
                  disabled={loading}
                />
                <div className="grid gap-0.5 leading-none flex-1">
                  <Label htmlFor={report.id} className="font-medium cursor-pointer text-sm">
                    {report.label}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {report.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Format F&B mengikuti periode:{' '}
            {fnbPeriodIsNew
              ? "'FNB New Report' (Sep 2026 ke atas)"
              : "'Cafe Sales Report' (sebelum Sep 2026)"}
          </p>
        </div>

        {/* Progress Section */}
        {loading && (
          <div className="space-y-2 py-2 animate-in fade-in">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{status}</span>
              <span className="font-medium">{progress}%</span>
            </div>
            <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-rose-600 transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={exportReports}
            disabled={selectedReports.length === 0 || loading || !dateRange?.from || !dateRange?.to}
            className="bg-rose-600 hover:bg-rose-700 min-w-[140px]"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Export ({selectedReports.length} sheets)
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
