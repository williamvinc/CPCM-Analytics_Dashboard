"use client"
import React, { useState, useMemo, useCallback } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardAction, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuSeparator, DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetClose } from "@/components/ui/sheet"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ChartContainer, ChartStyle, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis, Pie, PieChart, Sector, Label as RechartsLabel } from "recharts"
import type { PieSectorShapeProps } from "recharts/types/polar/Pie"
import { Download, Loader2, TrendingUpIcon, TrendingDownIcon, CalendarDays, Info, Layers, Globe, Wallet, CalendarCheck, UtensilsCrossed, Clock, Trophy, ChevronDown } from "lucide-react"
import { DateRangePicker } from "@/components/ui/date-range-picker"
import { DateRange } from "react-day-picker"

// Rupiah formatter (compact)
const formatRp = (val: number) => {
  if (val >= 1_000_000_000) return `Rp${(val / 1_000_000_000).toFixed(1)}B`
  if (val >= 1_000_000) return `Rp${(val / 1_000_000).toFixed(1)}M`
  if (val >= 1_000) return `Rp${(val / 1_000).toFixed(0)}K`
  return `Rp${val.toFixed(0)}`
}

// Rupiah formatter (full)
const formatRpFull = (val: number) => `Rp${val.toLocaleString('id-ID')}`

const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
]

// Day name mapping
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function getPreviousMonth(monthStr: string): string {
  const [y, m] = monthStr.split('-').map(Number)
  const prevMonth = m === 1 ? 12 : m - 1
  const prevYear = m === 1 ? y - 1 : y
  return `${prevYear}-${String(prevMonth).padStart(2, '0')}`
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null
  return ((current - previous) / previous) * 100
}

interface Metrics {
  total_gross: number
  total_transactions: number
  avg_per_transaction: number
  total_qty: number
  total_net_sales: number
  total_discount: number
  total_tax: number
}

interface TransformResult {
  preview_data: any[]
  all_data: any[]
  metrics: {
    total_gross: number
    total_transactions: number
    avg_per_transaction: number
    total_qty: number | null
    total_net_sales: number | null
    total_discount: number | null
    total_tax: number | null
  }
  available_months: string[]
  chart_category: any[]
  chart_source: any[]
  chart_daily: any[]
  chart_monthly: any[]
  chart_tender: any[]
  file_base64: string
  total_rows: number
}

function computeMetricsFromData(data: any[]): Metrics {
  const totalGross = data.reduce((s: number, r: any) => s + (Number(r['Gross Amount']) || 0), 0)
  const totalQty = data.reduce((s: number, r: any) => s + (Number(r['Item Qty']) || 0), 0)
  const totalNetSales = data.reduce((s: number, r: any) => s + (Number(r['Net Sales']) || 0), 0)
  const totalDiscount = data.reduce((s: number, r: any) => s + (Number(r['Discount']) || 0), 0)
  const totalTax = data.reduce((s: number, r: any) => s + (Number(r['Tax']) || 0), 0)
  return {
    total_gross: totalGross,
    total_transactions: data.length,
    avg_per_transaction: data.length > 0 ? totalGross / data.length : 0,
    total_qty: totalQty,
    total_net_sales: totalNetSales,
    total_discount: totalDiscount,
    total_tax: totalTax,
  }
}

// ---- TOOLTIP INFO BUTTON ----
function InfoTooltip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="w-3.5 h-3.5 text-muted-foreground/60 cursor-help inline-block ml-1" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[250px] text-xs">
        <p>{text}</p>
      </TooltipContent>
    </Tooltip>
  )
}

export default function TransformationPage() {
  const today = new Date()
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)

  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: firstOfMonth,
    to: today,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<TransformResult | null>(null)
  const [selectedMonth, setSelectedMonth] = useState<string>("all")
  const [activeTender, setActiveTender] = useState<string>("")
  const [reconciliation, setReconciliation] = useState<any>(null)
  const [outlets, setOutlets] = useState<string[]>([])
  const [selectedOutlets, setSelectedOutlets] = useState<string[]>([])
  const [fnbData, setFnbData] = useState<any>(null)
  const [retailData, setRetailData] = useState<any>(null)

  const formatDateStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  const handleDateRangeChange = (range: DateRange | undefined) => {
    setDateRange(range)
    if (range?.from && range?.to) {
      fetchData(formatDateStr(range.from), formatDateStr(range.to), selectedOutlets)
    }
  }

  const fetchData = async (start: string, end: string, outletList?: string[]) => {
    setLoading(true)
    setError(null)
    setSelectedMonth("all")

    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000"
      const outletParams = (outletList && outletList.length > 0) ? outletList.map(o => `&outlet=${encodeURIComponent(o)}`).join('') : ""
      const [salesRes, reconRes, fnbRes, retailRes] = await Promise.all([
        fetch(`${backendUrl}/api/sales?start_date=${start}&end_date=${end}${outletParams}`),
        fetch(`${backendUrl}/api/reconciliation?start_date=${start}&end_date=${end}${outletParams}`),
        fetch(`${backendUrl}/api/fnb-sales?start_date=${start}&end_date=${end}${outletParams}`),
        fetch(`${backendUrl}/api/retail-sales?start_date=${start}&end_date=${end}`),
      ])

      if (!salesRes.ok) {
        const errData = await salesRes.json()
        throw new Error(errData.detail || "Failed to fetch sales data.")
      }

      const data = await salesRes.json()
      setResult(data)

      if (reconRes.ok) {
        const reconData = await reconRes.json()
        setReconciliation(reconData)
      }

      if (fnbRes.ok) {
        const fnbResult = await fnbRes.json()
        setFnbData(fnbResult)
      }

      if (retailRes.ok) {
        const retailResult = await retailRes.json()
        setRetailData(retailResult)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000"
    fetch(`${backendUrl}/api/outlets`)
      .then(res => res.json())
      .then(data => setOutlets(data.outlets || []))
      .catch(() => {})
    if (dateRange?.from && dateRange?.to) {
      fetchData(formatDateStr(dateRange.from), formatDateStr(dateRange.to))
    }
  }, [])

  // ---- CLIENT-SIDE MONTH FILTERING ----
  const filteredData = useMemo(() => {
    if (!result) return null
    if (selectedMonth === "all") return result.all_data
    return result.all_data.filter((row: any) => {
      const date = row['Business Date']
      if (!date) return false
      return date.startsWith(selectedMonth)
    })
  }, [result, selectedMonth])

  const filteredMetrics = useMemo<Metrics | null>(() => {
    if (!filteredData || filteredData.length === 0) return null
    return computeMetricsFromData(filteredData)
  }, [filteredData])

  const previousMetrics = useMemo<Metrics | null>(() => {
    if (!result || !result.all_data) return null
    if (selectedMonth === "all") {
      const months = result.available_months
      if (months.length < 2) return null
      const prevMonth = months[months.length - 2]
      const prevData = result.all_data.filter((row: any) =>
        row['Business Date']?.startsWith(prevMonth)
      )
      if (prevData.length === 0) return null
      return computeMetricsFromData(prevData)
    } else {
      const prevMonthStr = getPreviousMonth(selectedMonth)
      const prevData = result.all_data.filter((row: any) =>
        row['Business Date']?.startsWith(prevMonthStr)
      )
      if (prevData.length === 0) return null
      return computeMetricsFromData(prevData)
    }
  }, [result, selectedMonth])

  const currentPeriodMetrics = useMemo<Metrics | null>(() => {
    if (!result || selectedMonth !== "all") return filteredMetrics
    const months = result.available_months
    if (months.length < 2) return filteredMetrics
    const latestMonth = months[months.length - 1]
    const latestData = result.all_data.filter((row: any) =>
      row['Business Date']?.startsWith(latestMonth)
    )
    if (latestData.length === 0) return filteredMetrics
    return computeMetricsFromData(latestData)
  }, [result, selectedMonth, filteredMetrics])

  const comparisonLabel = useMemo(() => {
    if (!result) return ''
    if (selectedMonth === "all") {
      const months = result.available_months
      if (months.length < 2) return ''
      return `${months[months.length - 1]} vs ${months[months.length - 2]}`
    }
    return `${selectedMonth} vs ${getPreviousMonth(selectedMonth)}`
  }, [result, selectedMonth])

  const filteredChartCategory = useMemo(() => {
    if (!filteredData) return []
    const map: Record<string, number> = {}
    filteredData.forEach((r: any) => {
      const cat = r['New Category']
      if (cat && cat !== 'null') {
        map[cat] = (map[cat] || 0) + (Number(r['Gross Amount']) || 0)
      }
    })
    return Object.entries(map).map(([k, v]) => ({ 'New Category': k, 'Gross Amount': v }))
  }, [filteredData])

  const filteredChartSource = useMemo(() => {
    if (!filteredData) return []
    const map: Record<string, number> = {}
    filteredData.forEach((r: any) => {
      const src = r['Source']
      if (src && src !== 'null') {
        map[src] = (map[src] || 0) + (Number(r['Gross Amount']) || 0)
      }
    })
    return Object.entries(map).map(([k, v]) => ({ 'Source': k, 'Gross Amount': v }))
  }, [filteredData])

  const filteredChartDaily = useMemo(() => {
    if (!filteredData) return []
    const map: Record<string, { gross: number; qty: number }> = {}
    filteredData.forEach((r: any) => {
      const date = r['Business Date']
      if (date) {
        if (!map[date]) map[date] = { gross: 0, qty: 0 }
        map[date].gross += Number(r['Gross Amount']) || 0
        map[date].qty += Number(r['Item Qty']) || 0
      }
    })
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, vals]) => ({ date, gross: vals.gross, qty: vals.qty }))
  }, [filteredData])

  // Busiest days analysis (by Net Sales)
  const busiestDays = useMemo(() => {
    if (!filteredData) return []
    const dayMap: Record<string, { netSales: number; count: number }> = {}
    filteredData.forEach((r: any) => {
      const dateStr = r['Business Date']
      if (!dateStr) return
      const date = new Date(dateStr)
      const dayName = DAY_NAMES[date.getDay()]
      if (!dayMap[dayName]) dayMap[dayName] = { netSales: 0, count: 0 }
      dayMap[dayName].netSales += Number(r['Net Sales']) || 0
      dayMap[dayName].count += 1
    })
    return Object.entries(dayMap)
      .map(([day, vals]) => ({
        day,
        netSales: vals.netSales,
        count: vals.count,
        fill: `var(--color-${day.toLowerCase()})`,
      }))
      .sort((a, b) => b.netSales - a.netSales)
  }, [filteredData])

  const busiestDaysConfig = useMemo<ChartConfig>(() => {
    const config: ChartConfig = {
      netSales: { label: 'Net Sales' },
    }
    const dayColors = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-1)', 'var(--chart-3)']
    busiestDays.forEach((item, i) => {
      config[item.day.toLowerCase()] = {
        label: item.day,
        color: dayColors[i % dayColors.length],
      }
    })
    return config
  }, [busiestDays])

  // Interactive pie chart data for tender
  const tenderPieData = useMemo(() => {
    if (!filteredData) return []
    const map: Record<string, number> = {}
    filteredData.forEach((r: any) => {
      const tender = r['Tender']
      if (tender && String(tender).trim()) {
        const key = String(tender).trim()
        map[key] = (map[key] || 0) + (Number(r['Gross Amount']) || 0)
      }
    })
    return Object.entries(map).map(([k, v]) => ({
      tender: k.toLowerCase().replace(/[^a-z0-9]/g, '_'),
      tenderLabel: k,
      amount: v,
      fill: `var(--color-${k.toLowerCase().replace(/[^a-z0-9]/g, '_')})`,
    }))
  }, [filteredData])

  const tenderChartConfig = useMemo<ChartConfig>(() => {
    const config: ChartConfig = {
      amount: { label: 'Gross Amount' },
    }
    tenderPieData.forEach((item, i) => {
      config[item.tender] = {
        label: item.tenderLabel,
        color: CHART_COLORS[i % CHART_COLORS.length],
      }
    })
    return config
  }, [tenderPieData])

  React.useEffect(() => {
    if (tenderPieData.length > 0 && !tenderPieData.find(d => d.tender === activeTender)) {
      setActiveTender(tenderPieData[0].tender)
    }
  }, [tenderPieData, activeTender])

  const activeTenderIndex = useMemo(
    () => tenderPieData.findIndex((item) => item.tender === activeTender),
    [activeTender, tenderPieData]
  )

  const renderPieShape = useCallback(
    ({ index, outerRadius = 0, ...props }: PieSectorShapeProps) => {
      if (index === activeTenderIndex) {
        return (
          <g>
            <Sector {...props} outerRadius={outerRadius + 10} />
            <Sector
              {...props}
              outerRadius={outerRadius + 25}
              innerRadius={outerRadius + 12}
            />
          </g>
        )
      }
      return <Sector {...props} outerRadius={outerRadius} />
    },
    [activeTenderIndex]
  )

  const handleDownload = () => {
    if (!result?.file_base64) return
    const byteCharacters = atob(result.file_base64)
    const byteNumbers = new Array(byteCharacters.length)
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i)
    }
    const byteArray = new Uint8Array(byteNumbers)
    const blob = new Blob([byteArray], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "SalesDetails_Processed.xlsx"
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // ---- COMPARISON CARD HELPER ----
  function MetricCard({
    title,
    value,
    prevValue,
    formatter = formatRpFull,
    footerLabel,
    tooltipText,
  }: {
    title: string
    value: number
    prevValue: number | null
    formatter?: (val: number) => string
    footerLabel: string
    tooltipText: string
  }) {
    const change = prevValue !== null ? pctChange(value, prevValue) : null
    const isUp = change !== null && change >= 0
    const TrendIcon = isUp ? TrendingUpIcon : TrendingDownIcon

    let trendText = ''
    if (change !== null) {
      if (isUp) {
        trendText = change > 5 ? 'Trending up this period' : 'Relatively stable'
      } else {
        trendText = change < -5 ? 'Trending down this period' : 'Relatively stable'
      }
    }

    return (
      <Card className="@container/card" data-slot="card">
        <CardHeader>
          <CardDescription className="flex items-center">
            {title}
            <InfoTooltip text={tooltipText} />
          </CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl truncate">
            {formatter(value)}
          </CardTitle>
          {change !== null && (
            <CardAction>
              <Badge variant="outline" className={`shrink-0 ${isUp ? 'text-green-600 border-green-200' : 'text-red-600 border-red-200'}`}>
                <TrendIcon className={`size-3 ${isUp ? 'text-green-600' : 'text-red-600'}`} />
                {change >= 0 ? '+' : ''}{change.toFixed(1)}%
              </Badge>
            </CardAction>
          )}
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          {change !== null && (
            <div className="line-clamp-1 flex gap-2 font-medium">
              {trendText}{" "}
              <TrendIcon className={`size-4 ${isUp ? 'text-green-600' : 'text-red-600'}`} />
            </div>
          )}
          <div className="text-muted-foreground">
            {footerLabel}
          </div>
        </CardFooter>
      </Card>
    )
  }

  // Area chart config
  const areaChartConfig = {
    gross: { label: 'Gross Amount', color: 'var(--chart-1)' },
  } satisfies ChartConfig

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-6 p-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Data Transformation</h1>
          <p className="text-muted-foreground">Automate Sales Data</p>
        </div>

        {/* Filter + Download Row - aligned right */}
        <div className="flex items-center gap-3 flex-wrap justify-end">
          <DateRangePicker
            value={dateRange}
            onChange={handleDateRangeChange}
            className="w-[280px]"
          />
          {outlets.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-[250px] justify-between">
                  <span className="truncate text-sm">
                    {selectedOutlets.length === 0 ? 'All Outlets' : `${selectedOutlets.length} outlet${selectedOutlets.length > 1 ? 's' : ''} selected`}
                  </span>
                  <ChevronDown className="w-4 h-4 ml-2 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[300px]">
                {outlets.map((o) => (
                  <DropdownMenuCheckboxItem
                    key={o}
                    checked={selectedOutlets.includes(o)}
                    onCheckedChange={(checked) => {
                      const newSelection = checked
                        ? [...selectedOutlets, o]
                        : selectedOutlets.filter(x => x !== o)
                      setSelectedOutlets(newSelection)
                      if (dateRange?.from && dateRange?.to) fetchData(formatDateStr(dateRange.from), formatDateStr(dateRange.to), newSelection)
                    }}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {o}
                  </DropdownMenuCheckboxItem>
                ))}
                {selectedOutlets.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => {
                        setSelectedOutlets([])
                        if (dateRange?.from && dateRange?.to) fetchData(formatDateStr(dateRange.from), formatDateStr(dateRange.to), [])
                      }}
                      className="text-muted-foreground justify-center"
                    >
                      Clear all
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {result?.available_months && result.available_months.length > 1 && (
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Filter by month" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Months</SelectItem>
                {result.available_months.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {result && (
            <Button onClick={handleDownload} variant="default" size="default" className="shadow-md rounded-xl font-bold">
              <Download className="w-4 h-4 mr-2" />
              Download (.xlsx)
            </Button>
          )}
          {loading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
        </div>

        {error && (
          <div className="p-4 bg-destructive/10 text-destructive font-bold rounded-lg animate-in slide-in-from-top-2">
            {error}
          </div>
        )}

        {result && filteredMetrics && (
          <div className="flex flex-col gap-6 animate-in fade-in zoom-in-95 duration-500">

            {/* Ticketing Section Title */}
            <div className="flex items-center gap-2 pt-2">
              <div className="h-8 w-1 rounded-full bg-primary" />
              <h2 className="text-xl font-semibold tracking-tight">Ticketing Report</h2>
            </div>

            {/* Metric Cards with Period Comparison */}
            <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-br *:data-[slot=card]:from-blue-50 *:data-[slot=card]:to-indigo-50/50 *:data-[slot=card]:shadow-sm dark:*:data-[slot=card]:from-blue-950/30 dark:*:data-[slot=card]:to-indigo-950/20">
              <MetricCard
                title="Total Gross Amount"
                value={selectedMonth === "all" ? (currentPeriodMetrics?.total_gross ?? filteredMetrics.total_gross) : filteredMetrics.total_gross}
                prevValue={previousMetrics?.total_gross ?? null}
                footerLabel={comparisonLabel || 'All periods combined'}
                tooltipText="SUM(Gross Amount) - kolom gross_amount"
              />
            </div>

            {/* Secondary Metric Cards with Comparison */}
            <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-br *:data-[slot=card]:from-blue-50 *:data-[slot=card]:to-indigo-50/50 *:data-[slot=card]:shadow-sm @xl/main:grid-cols-3 dark:*:data-[slot=card]:from-blue-950/30 dark:*:data-[slot=card]:to-indigo-950/20">
              <MetricCard
                title="Net Sales"
                value={selectedMonth === "all" ? (currentPeriodMetrics?.total_net_sales ?? filteredMetrics.total_net_sales) : filteredMetrics.total_net_sales}
                prevValue={previousMetrics?.total_net_sales ?? null}
                footerLabel={comparisonLabel || 'All periods combined'}
                tooltipText="SUM(Net Sales) - kolom net_sales"
              />
              <MetricCard
                title="Total Discount"
                value={selectedMonth === "all" ? (currentPeriodMetrics?.total_discount ?? filteredMetrics.total_discount) : filteredMetrics.total_discount}
                prevValue={previousMetrics?.total_discount ?? null}
                footerLabel={comparisonLabel || 'All periods combined'}
                tooltipText="SUM(Discount) - kolom discount"
              />
              <MetricCard
                title="Total Tax"
                value={selectedMonth === "all" ? (currentPeriodMetrics?.total_tax ?? filteredMetrics.total_tax) : filteredMetrics.total_tax}
                prevValue={previousMetrics?.total_tax ?? null}
                footerLabel={comparisonLabel || 'All periods combined'}
                tooltipText="SUM(Tax) - kolom tax"
              />
            </div>

            {/* Daily Trend - shadcn Area Chart */}
            {filteredChartDaily.length > 1 && (
              <>
                <Separator />
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold">Daily Gross Amount Trend</h3>
                    <InfoTooltip text="SUM(Gross Amount) per Business Date" />
                  </div>
                  <p className="text-sm text-muted-foreground">Gross amount over time{selectedMonth !== "all" ? ` - ${selectedMonth}` : ''}</p>
                  <ChartContainer
                    config={areaChartConfig}
                    className="aspect-auto h-[300px] w-full"
                  >
                    <AreaChart data={filteredChartDaily}>
                      <defs>
                        <linearGradient id="fillGross" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--color-gross)" stopOpacity={0.8} />
                          <stop offset="95%" stopColor="var(--color-gross)" stopOpacity={0.1} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} />
                      <XAxis
                        dataKey="date"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        minTickGap={32}
                        tickFormatter={(value) => {
                          const date = new Date(value)
                          return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
                        }}
                      />
                      <YAxis tickFormatter={(val) => formatRp(val)} tickLine={false} axisLine={false} />
                      <ChartTooltip
                        cursor={false}
                        content={
                          <ChartTooltipContent
                            labelFormatter={(value) => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            indicator="dot"
                          />
                        }
                      />
                      <Area dataKey="gross" type="natural" fill="url(#fillGross)" stroke="var(--color-gross)" />
                    </AreaChart>
                  </ChartContainer>
                </div>
              </>
            )}

            {/* Category + Source Bar Charts */}
            <Separator />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-muted-foreground" />
                  <h3 className="text-base font-semibold">Gross Amount by Category</h3>
                  <InfoTooltip text="SUM(Gross Amount) GROUP BY New Category - kategori: 2 Jam, 3 Jam, 1 Comp, 2 Comp" />
                </div>
                <p className="text-sm text-muted-foreground">Aggregation of transformed categories</p>
                <ChartContainer
                  config={{ gross: { label: 'Gross Amount', color: 'var(--chart-2)' } }}
                  className="h-[300px] w-full"
                >
                  <BarChart data={filteredChartCategory} margin={{ top: 10, right: 10, bottom: 20, left: 0 }} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tickFormatter={(val) => formatRp(val)} />
                    <YAxis dataKey="New Category" type="category" width={200} tick={{ fontSize: 12 }} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="Gross Amount" fill="var(--color-gross)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ChartContainer>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-muted-foreground" />
                  <h3 className="text-base font-semibold">Gross Amount by Source</h3>
                  <InfoTooltip text="SUM(Gross Amount) GROUP BY Source - sumber: Blibli, Tiket.com, Website, Walk In, Kaos Kaki" />
                </div>
                <p className="text-sm text-muted-foreground">Aggregation of mapped lead sources</p>
                <ChartContainer
                  config={{ gross: { label: 'Gross Amount', color: 'var(--chart-3)' } }}
                  className="h-[300px] w-full"
                >
                  <BarChart data={filteredChartSource} margin={{ top: 10, right: 10, bottom: 20, left: 20 }} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tickFormatter={(val) => formatRp(val)} />
                    <YAxis dataKey="Source" type="category" width={100} tick={{ fontSize: 11 }} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="Gross Amount" fill="var(--color-gross)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ChartContainer>
              </div>
            </div>

            {/* Payment Method Pie + Busiest Days - side by side */}
            <Separator />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Payment Method - Interactive Pie Chart */}
              {tenderPieData.length > 0 && (
                <div className="space-y-3" data-chart="pie-tender">
                  <ChartStyle id="pie-tender" config={tenderChartConfig} />
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <Wallet className="w-4 h-4 text-muted-foreground" />
                        <h3 className="text-base font-semibold">Payment Methods</h3>
                        <InfoTooltip text="SUM(Gross Amount) GROUP BY Tender" />
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">By tender type</p>
                    </div>
                    <Select value={activeTender} onValueChange={setActiveTender}>
                      <SelectTrigger className="h-7 w-[160px] rounded-lg pl-2.5" aria-label="Select tender">
                        <SelectValue placeholder="Select tender" />
                      </SelectTrigger>
                      <SelectContent align="end" className="rounded-xl">
                        {tenderPieData.map((item) => {
                          const config = tenderChartConfig[item.tender]
                          if (!config) return null
                          return (
                            <SelectItem key={item.tender} value={item.tender} className="rounded-lg [&_span]:flex">
                              <div className="flex items-center gap-2 text-xs">
                                <span className="flex h-3 w-3 shrink-0 rounded-xs" style={{ backgroundColor: `var(--color-${item.tender})` }} />
                                {item.tenderLabel}
                              </div>
                            </SelectItem>
                          )
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                  <ChartContainer id="pie-tender" config={tenderChartConfig} className="mx-auto aspect-square w-full max-w-[300px]">
                    <PieChart>
                      <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                      <Pie
                        data={tenderPieData}
                        dataKey="amount"
                        nameKey="tender"
                        innerRadius={60}
                        strokeWidth={5}
                        shape={renderPieShape}
                      >
                        <RechartsLabel
                          content={({ viewBox }) => {
                            if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                              const activeItem = tenderPieData[activeTenderIndex]
                              return (
                                <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                                  <tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-2xl font-bold">
                                    {activeItem ? formatRp(activeItem.amount) : ''}
                                  </tspan>
                                  <tspan x={viewBox.cx} y={(viewBox.cy || 0) + 24} className="fill-muted-foreground text-xs">
                                    {activeItem?.tenderLabel || ''}
                                  </tspan>
                                </text>
                              )
                            }
                          }}
                        />
                      </Pie>
                    </PieChart>
                  </ChartContainer>
                </div>
              )}

              {/* Busiest Days Analysis */}
              {busiestDays.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <CalendarCheck className="w-4 h-4 text-muted-foreground" />
                    <h3 className="text-base font-semibold">Busiest Days</h3>
                    <InfoTooltip text="SUM(Net Sales) GROUP BY day of week dari Business Date" />
                  </div>
                  <p className="text-sm text-muted-foreground">Net Sales by day of week{selectedMonth !== "all" ? ` - ${selectedMonth}` : ''}</p>
                  <ChartContainer config={busiestDaysConfig} className="h-[300px] w-full">
                    <BarChart data={busiestDays} margin={{ top: 10, right: 10, bottom: 20, left: 20 }} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tickFormatter={(val) => formatRp(val)} />
                      <YAxis dataKey="day" type="category" width={90} tick={{ fontSize: 12 }} />
                      <ChartTooltip
                        content={
                          <ChartTooltipContent
                            formatter={(value, name) => {
                              if (name === 'netSales') return [formatRpFull(value as number), 'Net Sales']
                              return [value, name]
                            }}
                          />
                        }
                      />
                      <Bar dataKey="netSales" radius={[0, 4, 4, 0]}>
                        {busiestDays.map((entry) => (
                          <RechartsLabel key={entry.day} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ChartContainer>
                  {/* Rank summary */}
                  <div className="space-y-2">
                      {busiestDays.slice(0, 3).map((day, i) => (
                        <div key={day.day} className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <Badge variant={i === 0 ? 'default' : 'secondary'} className="text-xs">
                              #{i + 1}
                            </Badge>
                            <span className="font-medium">{day.day}</span>
                          </div>
                          <div className="text-right">
                            <span className="font-semibold">{formatRp(day.netSales)}</span>
                            <span className="text-muted-foreground text-xs ml-2">({day.count} txn)</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

            {/* Reconciliation Table */}
            {reconciliation?.data && reconciliation.data.length > 0 && (
              <>
                <Separator />
                <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle>POS vs Bank</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/40">
                          <th className="px-4 py-3 text-left font-medium text-muted-foreground">Date</th>
                          <th className="px-4 py-3 text-right font-medium text-muted-foreground">POS</th>
                          <th className="px-4 py-3 text-right font-medium text-muted-foreground">BCA</th>
                          <th className="px-4 py-3 text-right font-medium text-muted-foreground">BRI</th>
                          <th className="px-4 py-3 text-right font-medium text-muted-foreground">BCA + BRI</th>
                          <th className="px-4 py-3 text-right font-medium text-muted-foreground">Difference</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reconciliation.data.map((row: any, i: number) => (
                          <tr key={row.date} className={i % 2 === 0 ? '' : 'bg-muted/20'}>
                            <td className="px-4 py-2.5 font-medium">{row.date}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{formatRpFull(row.pos)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{formatRpFull(row.bca)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{formatRpFull(row.bri)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{formatRpFull(row.bank_total)}</td>
                            <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${row.difference < 0 ? 'text-red-500' : ''}`}>
                              {formatRpFull(row.difference)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 font-semibold bg-muted/40">
                          <td className="px-4 py-3">Total</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatRpFull(reconciliation.totals.pos)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatRpFull(reconciliation.totals.bca)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatRpFull(reconciliation.totals.bri)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatRpFull(reconciliation.totals.bank_total)}</td>
                          <td className={`px-4 py-3 text-right tabular-nums font-bold ${reconciliation.totals.difference < 0 ? 'text-red-500' : ''}`}>
                            {formatRpFull(reconciliation.totals.difference)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </CardContent>
              </Card>
              </>
            )}

            {/* ═══════════════════════ F&B REPORT SECTION ═══════════════════════ */}
            {fnbData && fnbData.success && (
              <>
                {/* F&B Section Title */}
                <div className="flex items-center gap-2 pt-4">
                  <div className="h-8 w-1 rounded-full bg-orange-500" />
                  <h2 className="text-xl font-semibold tracking-tight">F&B Report</h2>
                </div>

                {/* F&B Metric Cards */}
                <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-3 *:data-[slot=card]:bg-gradient-to-br *:data-[slot=card]:from-orange-50 *:data-[slot=card]:to-amber-50/50 *:data-[slot=card]:shadow-sm dark:*:data-[slot=card]:from-orange-950/30 dark:*:data-[slot=card]:to-amber-950/20">
                  <Card className="border-0" data-slot="card">
                    <CardHeader>
                      <CardDescription className="flex items-center gap-2">
                        <UtensilsCrossed className="w-4 h-4 text-muted-foreground" />
                        Total F&B Revenue
                        <InfoTooltip text="SUM(Gross Amount) - kolom gross_amount, kategori: 03-Food, FC01-Food, 04-Beverages, BC01-Beverages" />
                      </CardDescription>
                      <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                        {formatRpFull(fnbData.metrics.total_gross)}
                      </CardTitle>
                    </CardHeader>
                    <CardFooter className="text-sm text-muted-foreground">
                      {fnbData.metrics.total_transactions} transactions
                    </CardFooter>
                  </Card>

                  <Card className="border-0" data-slot="card">
                    <CardHeader>
                      <CardDescription className="flex items-center gap-2">
                        <Layers className="w-4 h-4 text-muted-foreground" />
                        Total Items Sold
                        <InfoTooltip text="SUM(Item Qty) - kolom item_qty" />
                      </CardDescription>
                      <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                        {fnbData.metrics.total_qty.toLocaleString('id-ID')}
                      </CardTitle>
                    </CardHeader>
                    <CardFooter className="text-sm text-muted-foreground">
                      Food & Beverages combined
                    </CardFooter>
                  </Card>

                  <Card className="border-0" data-slot="card">
                    <CardHeader>
                      <CardDescription className="flex items-center gap-2">
                        <Trophy className="w-4 h-4 text-muted-foreground" />
                        Avg per Transaction
                        <InfoTooltip text="SUM(Gross Amount) / COUNT(rows)" />
                      </CardDescription>
                      <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                        {formatRpFull(fnbData.metrics.avg_per_transaction)}
                      </CardTitle>
                    </CardHeader>
                    <CardFooter className="text-sm text-muted-foreground">
                      Average basket size
                    </CardFooter>
                  </Card>
                </div>

                {/* Peak Hours Chart */}
                {fnbData.peak_hours.length > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-muted-foreground" />
                        <h3 className="text-base font-semibold">Peak Hours</h3>
                        <InfoTooltip text="SUM(Gross Amount) GROUP BY HOUR(bill_created_date)" />
                      </div>
                      <p className="text-sm text-muted-foreground">F&B revenue by hour of day</p>
                      <ChartContainer
                        config={{ revenue: { label: 'Revenue', color: 'var(--chart-4)' } }}
                        className="aspect-auto h-[300px] w-full"
                      >
                        <BarChart data={fnbData.peak_hours} margin={{ top: 10, right: 10, bottom: 20, left: 0 }}>
                          <defs>
                            <linearGradient id="fillPeakHour" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="var(--color-revenue)" stopOpacity={0.8} />
                              <stop offset="95%" stopColor="var(--color-revenue)" stopOpacity={0.3} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid vertical={false} />
                          <XAxis
                            dataKey="hour"
                            tickLine={false}
                            axisLine={false}
                            tickMargin={8}
                            tickFormatter={(val) => `${String(val).padStart(2, '0')}:00`}
                          />
                          <YAxis tickFormatter={(val) => formatRp(val)} tickLine={false} axisLine={false} />
                          <ChartTooltip
                            content={
                              <ChartTooltipContent
                                labelFormatter={(val) => `${String(val).padStart(2, '0')}:00 - ${String(Number(val) + 1).padStart(2, '0')}:00`}
                              />
                            }
                          />
                          <Bar dataKey="revenue" fill="url(#fillPeakHour)" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ChartContainer>
                    </div>
                  </>
                )}

                {/* Food vs Beverages Split Pie */}
                {fnbData.category_split && fnbData.category_split.length > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <UtensilsCrossed className="w-4 h-4 text-muted-foreground" />
                        <h3 className="text-base font-semibold">Food vs Beverages</h3>
                        <InfoTooltip text="Persentase Gross Amount Food & Beverages terhadap total semua kategori" />
                      </div>
                      <p className="text-sm text-muted-foreground">Contribution to total gross sales from all categories ({formatRpFull(fnbData.total_all_gross)})</p>
                      <div className="flex items-center justify-center">
                        <ChartContainer
                          config={{
                            food: { label: 'Food', color: 'var(--chart-1)' },
                            beverages: { label: 'Beverages', color: 'var(--chart-4)' },
                            other: { label: 'Other', color: 'var(--chart-3)' },
                          }}
                          className="mx-auto aspect-square w-full max-w-[300px]"
                        >
                          <PieChart>
                            <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                            <Pie
                              data={[
                                { name: 'food', label: 'Food', value: fnbData.category_split[0]?.amount || 0, fill: 'var(--color-food)' },
                                { name: 'beverages', label: 'Beverages', value: fnbData.category_split[1]?.amount || 0, fill: 'var(--color-beverages)' },
                                { name: 'other', label: 'Other', value: Math.max(0, fnbData.total_all_gross - (fnbData.category_split[0]?.amount || 0) - (fnbData.category_split[1]?.amount || 0)), fill: 'var(--color-other)' },
                              ]}
                              dataKey="value"
                              nameKey="name"
                              innerRadius={60}
                              strokeWidth={5}
                            >
                              <RechartsLabel
                                content={({ viewBox }) => {
                                  if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                                    const totalPct = (fnbData.category_split[0]?.pct || 0) + (fnbData.category_split[1]?.pct || 0)
                                    return (
                                      <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                                        <tspan x={viewBox.cx} y={(viewBox.cy || 0) - 8} className="fill-foreground text-2xl font-bold">
                                          {totalPct.toFixed(1)}%
                                        </tspan>
                                        <tspan x={viewBox.cx} y={(viewBox.cy || 0) + 14} className="fill-muted-foreground text-[10px]">
                                          of total sales from
                                        </tspan>
                                        <tspan x={viewBox.cx} y={(viewBox.cy || 0) + 28} className="fill-muted-foreground text-[10px]">
                                          all categories
                                        </tspan>
                                      </text>
                                    )
                                  }
                                }}
                              />
                            </Pie>
                          </PieChart>
                        </ChartContainer>
                      </div>
                      <div className="flex justify-center gap-8 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="h-3 w-3 rounded-sm bg-[var(--chart-1)]" />
                          <span className="font-medium">Food</span>
                          <span className="text-muted-foreground">{fnbData.category_split[0]?.pct || 0}% ({formatRp(fnbData.category_split[0]?.amount || 0)})</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="h-3 w-3 rounded-sm bg-[var(--chart-4)]" />
                          <span className="font-medium">Beverages</span>
                          <span className="text-muted-foreground">{fnbData.category_split[1]?.pct || 0}% ({formatRp(fnbData.category_split[1]?.amount || 0)})</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="h-3 w-3 rounded-sm bg-[var(--chart-3)]" />
                          <span className="font-medium">Other</span>
                          <span className="text-muted-foreground">{(100 - (fnbData.category_split[0]?.pct || 0) - (fnbData.category_split[1]?.pct || 0)).toFixed(1)}%</span>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {/* Top 10 & Bottom 10 Items */}
                <Separator />
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* Top 10 */}
                  {fnbData.top_10_items.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <TrendingUpIcon className="w-4 h-4 text-green-600" />
                        <h3 className="text-base font-semibold">Top 10 Items</h3>
                        <InfoTooltip text="SUM(Gross Amount), SUM(Item Qty) GROUP BY item - TOP 10 DESC" />
                      </div>
                      <p className="text-sm text-muted-foreground">Highest revenue items</p>
                      <ChartContainer
                        config={{ revenue: { label: 'Revenue', color: 'var(--chart-2)' }, qty: { label: 'Qty', color: 'var(--chart-3)' } }}
                        className="h-[400px] w-full"
                      >
                        <BarChart
                          data={fnbData.top_10_items}
                          layout="vertical"
                          margin={{ top: 0, right: 10, bottom: 0, left: 10 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                          <XAxis type="number" tickFormatter={(val) => formatRp(val)} />
                          <YAxis
                            dataKey="item"
                            type="category"
                            width={180}
                            tick={{ fontSize: 11 }}
                            tickFormatter={(val) => val.length > 25 ? val.slice(0, 25) + '…' : val}
                          />
                          <ChartTooltip
                            content={
                              <ChartTooltipContent
                                formatter={(value, name) => {
                                  if (name === 'revenue') return [formatRpFull(value as number), 'Revenue']
                                  if (name === 'qty') return [`${value} pcs`, 'Qty']
                                  return [value, name]
                                }}
                              />
                            }
                          />
                          <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[0, 4, 4, 0]} />
                        </BarChart>
                      </ChartContainer>
                      <div className="space-y-1.5">
                        {fnbData.top_10_items.slice(0, 5).map((item: any, i: number) => (
                          <div key={item.item} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <Badge variant={i === 0 ? 'default' : 'secondary'} className="text-xs">#{i + 1}</Badge>
                              <span className="font-medium truncate max-w-[200px]">{item.item}</span>
                            </div>
                            <div className="text-right">
                              <span className="font-semibold">{formatRp(item.revenue)}</span>
                              {item.qty > 0 && <span className="text-muted-foreground text-xs ml-2">({item.qty} pcs)</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                      <Sheet>
                        <SheetTrigger asChild>
                          <Button variant="ghost" size="sm" className="w-full text-muted-foreground">
                            See all {fnbData.all_items?.length || 0} items
                          </Button>
                        </SheetTrigger>
                        <SheetContent side="bottom" className="max-h-[80vh] rounded-t-2xl">
                          <SheetHeader>
                            <SheetTitle>All F&B Items - by Revenue</SheetTitle>
                            <SheetDescription>Ranked from highest to lowest gross amount</SheetDescription>
                          </SheetHeader>
                          <div className="overflow-y-auto max-h-[60vh] space-y-1 px-4 pb-4">
                            {(fnbData.all_items || []).map((item: any, i: number) => (
                              <div key={item.item} className="flex items-center justify-between text-sm py-2 border-b border-border/50 last:border-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-muted-foreground w-6 text-right">#{i + 1}</span>
                                  <span className="font-medium truncate max-w-[300px]">{item.item}</span>
                                </div>
                                <div className="text-right shrink-0 ml-2">
                                  <span className="font-semibold">{formatRp(item.revenue)}</span>
                                  {item.qty > 0 && <span className="text-muted-foreground text-xs ml-2">({item.qty} pcs)</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </SheetContent>
                      </Sheet>
                    </div>
                  )}

                  {/* Bottom 10 */}
                  {fnbData.bottom_10_items.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <TrendingDownIcon className="w-4 h-4 text-red-500" />
                        <h3 className="text-base font-semibold">Bottom 10 Items</h3>
                        <InfoTooltip text="SUM(Gross Amount), SUM(Item Qty) GROUP BY item - BOTTOM 10 ASC" />
                      </div>
                      <p className="text-sm text-muted-foreground">Lowest revenue items</p>
                      <ChartContainer
                        config={{ revenue: { label: 'Revenue', color: 'var(--chart-5)' }, qty: { label: 'Qty', color: 'var(--chart-3)' } }}
                        className="h-[400px] w-full"
                      >
                        <BarChart
                          data={fnbData.bottom_10_items}
                          layout="vertical"
                          margin={{ top: 0, right: 10, bottom: 0, left: 10 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                          <XAxis type="number" tickFormatter={(val) => formatRp(val)} />
                          <YAxis
                            dataKey="item"
                            type="category"
                            width={180}
                            tick={{ fontSize: 11 }}
                            tickFormatter={(val) => val.length > 25 ? val.slice(0, 25) + '…' : val}
                          />
                          <ChartTooltip
                            content={
                              <ChartTooltipContent
                                formatter={(value, name) => {
                                  if (name === 'revenue') return [formatRpFull(value as number), 'Revenue']
                                  if (name === 'qty') return [`${value} pcs`, 'Qty']
                                  return [value, name]
                                }}
                              />
                            }
                          />
                          <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[0, 4, 4, 0]} />
                        </BarChart>
                      </ChartContainer>
                      <div className="space-y-1.5">
                        {fnbData.bottom_10_items.slice(0, 5).map((item: any, i: number) => (
                          <div key={item.item} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs border-red-200 text-red-600">#{i + 1}</Badge>
                              <span className="font-medium truncate max-w-[200px]">{item.item}</span>
                            </div>
                            <div className="text-right">
                              <span className="font-semibold">{formatRp(item.revenue)}</span>
                              {item.qty > 0 && <span className="text-muted-foreground text-xs ml-2">({item.qty} pcs)</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                      <Sheet>
                        <SheetTrigger asChild>
                          <Button variant="ghost" size="sm" className="w-full text-muted-foreground">
                            See all {fnbData.all_items?.length || 0} items
                          </Button>
                        </SheetTrigger>
                        <SheetContent side="bottom" className="max-h-[80vh] rounded-t-2xl">
                          <SheetHeader>
                            <SheetTitle>All F&B Items - by Revenue (Low to High)</SheetTitle>
                            <SheetDescription>Ranked from lowest to highest gross amount</SheetDescription>
                          </SheetHeader>
                          <div className="overflow-y-auto max-h-[60vh] space-y-1 px-4 pb-4">
                            {([...(fnbData.all_items || [])].reverse()).map((item: any, i: number) => (
                              <div key={item.item} className="flex items-center justify-between text-sm py-2 border-b border-border/50 last:border-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-muted-foreground w-6 text-right">#{i + 1}</span>
                                  <span className="font-medium truncate max-w-[300px]">{item.item}</span>
                                </div>
                                <div className="text-right shrink-0 ml-2">
                                  <span className="font-semibold">{formatRp(item.revenue)}</span>
                                  {item.qty > 0 && <span className="text-muted-foreground text-xs ml-2">({item.qty} pcs)</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </SheetContent>
                      </Sheet>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ═══════════════════════ RETAIL REPORT SECTION ═══════════════════════ */}
            {retailData && retailData.success && (
              <>
                {/* Retail Section Title */}
                <div className="flex items-center gap-2 pt-4">
                  <div className="h-8 w-1 rounded-full bg-emerald-500" />
                  <h2 className="text-xl font-semibold tracking-tight">Retail Report (JMH)</h2>
                </div>

                {/* Retail Metric Cards */}
                <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-3 *:data-[slot=card]:bg-gradient-to-br *:data-[slot=card]:from-emerald-50 *:data-[slot=card]:to-teal-50/50 *:data-[slot=card]:shadow-sm dark:*:data-[slot=card]:from-emerald-950/30 dark:*:data-[slot=card]:to-teal-950/20">
                  <Card className="border-0" data-slot="card">
                    <CardHeader>
                      <CardDescription className="flex items-center gap-2">
                        <Layers className="w-4 h-4 text-muted-foreground" />
                        Total Retail Revenue
                        <InfoTooltip text="SUM(BCA JMH + BRI JMH) - total transaksi retail dari bank" />
                      </CardDescription>
                      <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                        {formatRpFull(retailData.metrics.total_revenue)}
                      </CardTitle>
                    </CardHeader>
                    <CardFooter className="text-sm text-muted-foreground">
                      {retailData.metrics.outlet_count} outlet(s)
                    </CardFooter>
                  </Card>

                  <Card className="border-0" data-slot="card">
                    <CardHeader>
                      <CardDescription className="flex items-center gap-2">
                        <Wallet className="w-4 h-4 text-muted-foreground" />
                        BCA Transactions
                        <InfoTooltip text="SUM(gross_amount) dari bca_jmh_transactions" />
                      </CardDescription>
                      <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                        {formatRpFull(retailData.metrics.bca_total)}
                      </CardTitle>
                    </CardHeader>
                    <CardFooter className="text-sm text-muted-foreground">
                      Credit/Debit card via BCA
                    </CardFooter>
                  </Card>

                  <Card className="border-0" data-slot="card">
                    <CardHeader>
                      <CardDescription className="flex items-center gap-2">
                        <Wallet className="w-4 h-4 text-muted-foreground" />
                        BRI Transactions
                        <InfoTooltip text="SUM(amt_trx) dari bri_jmh_transactions" />
                      </CardDescription>
                      <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                        {formatRpFull(retailData.metrics.bri_total)}
                      </CardTitle>
                    </CardHeader>
                    <CardFooter className="text-sm text-muted-foreground">
                      Credit/Debit card via BRI
                    </CardFooter>
                  </Card>
                </div>

                {/* Retail Daily Trend */}
                {retailData.daily_data && retailData.daily_data.length > 1 && (
                  <>
                    <Separator />
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <CalendarDays className="w-4 h-4 text-muted-foreground" />
                        <h3 className="text-base font-semibold">Daily Retail Revenue</h3>
                        <InfoTooltip text="SUM(BCA + BRI) per tanggal transaksi" />
                      </div>
                      <p className="text-sm text-muted-foreground">Combined BCA and BRI transactions over time</p>
                      <ChartContainer
                        config={{
                          bca: { label: 'BCA', color: 'var(--chart-1)' },
                          bri: { label: 'BRI', color: 'var(--chart-2)' },
                        }}
                        className="aspect-auto h-[300px] w-full"
                      >
                        <AreaChart data={retailData.daily_data}>
                          <defs>
                            <linearGradient id="fillRetailBca" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="var(--color-bca)" stopOpacity={0.8} />
                              <stop offset="95%" stopColor="var(--color-bca)" stopOpacity={0.1} />
                            </linearGradient>
                            <linearGradient id="fillRetailBri" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="var(--color-bri)" stopOpacity={0.8} />
                              <stop offset="95%" stopColor="var(--color-bri)" stopOpacity={0.1} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid vertical={false} />
                          <XAxis
                            dataKey="date"
                            tickLine={false}
                            axisLine={false}
                            tickMargin={8}
                            minTickGap={32}
                            tickFormatter={(value) => {
                              const date = new Date(value)
                              return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
                            }}
                          />
                          <YAxis tickFormatter={(val) => formatRp(val)} tickLine={false} axisLine={false} />
                          <ChartTooltip
                            cursor={false}
                            content={
                              <ChartTooltipContent
                                labelFormatter={(value) => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                                indicator="dot"
                              />
                            }
                          />
                          <Area dataKey="bca" type="natural" fill="url(#fillRetailBca)" stroke="var(--color-bca)" stackId="1" />
                          <Area dataKey="bri" type="natural" fill="url(#fillRetailBri)" stroke="var(--color-bri)" stackId="1" />
                        </AreaChart>
                      </ChartContainer>
                    </div>
                  </>
                )}

                {/* Retail by Outlet */}
                {retailData.outlet_data && retailData.outlet_data.length > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Globe className="w-4 h-4 text-muted-foreground" />
                        <h3 className="text-base font-semibold">Revenue by Outlet</h3>
                        <InfoTooltip text="SUM(BCA + BRI) GROUP BY outlet" />
                      </div>
                      <p className="text-sm text-muted-foreground">Breakdown by store location / period</p>
                      <ChartContainer
                        config={{ total: { label: 'Total', color: 'var(--chart-3)' } }}
                        className="h-[300px] w-full"
                      >
                        <BarChart data={retailData.outlet_data} margin={{ top: 10, right: 10, bottom: 20, left: 10 }} layout="vertical">
                          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                          <XAxis type="number" tickFormatter={(val) => formatRp(val)} />
                          <YAxis dataKey="outlet_label" type="category" width={180} tick={{ fontSize: 12 }} />
                          <ChartTooltip
                            content={
                              <ChartTooltipContent
                                formatter={(value, name) => {
                                  if (name === 'total') return [formatRpFull(value as number), 'Total']
                                  return [value, name]
                                }}
                              />
                            }
                          />
                          <Bar dataKey="total" fill="var(--color-total)" radius={[0, 4, 4, 0]} />
                        </BarChart>
                      </ChartContainer>
                    </div>
                  </>
                )}

                {/* Retail Reconciliation Table */}
                {retailData.recon_data && retailData.recon_data.length > 0 && (
                  <>
                    <Separator />
                    <Card className="shadow-sm">
                      <CardHeader>
                        <CardTitle>Retail Bank Transactions</CardTitle>
                      </CardHeader>
                      <CardContent className="p-0">
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b bg-muted/40">
                                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Date</th>
                                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Outlet</th>
                                <th className="px-4 py-3 text-right font-medium text-muted-foreground">BCA</th>
                                <th className="px-4 py-3 text-right font-medium text-muted-foreground">BRI</th>
                                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {retailData.recon_data.map((row: any, i: number) => (
                                <tr key={`${row.date}-${row.outlet}`} className={i % 2 === 0 ? '' : 'bg-muted/20'}>
                                  <td className="px-4 py-2.5 font-medium">{row.date}</td>
                                  <td className="px-4 py-2.5">{row.outlet_label}</td>
                                  <td className="px-4 py-2.5 text-right tabular-nums">{formatRpFull(row.bca)}</td>
                                  <td className="px-4 py-2.5 text-right tabular-nums">{formatRpFull(row.bri)}</td>
                                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{formatRpFull(row.total)}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="border-t-2 font-semibold bg-muted/40">
                                <td className="px-4 py-3" colSpan={2}>Total</td>
                                <td className="px-4 py-3 text-right tabular-nums">{formatRpFull(retailData.totals.bca)}</td>
                                <td className="px-4 py-3 text-right tabular-nums">{formatRpFull(retailData.totals.bri)}</td>
                                <td className="px-4 py-3 text-right tabular-nums font-bold">{formatRpFull(retailData.totals.total)}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </CardContent>
                    </Card>
                  </>
                )}
              </>
            )}

          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
