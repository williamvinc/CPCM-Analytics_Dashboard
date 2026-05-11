"use client"
import React, { useState, useMemo, useCallback } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardAction, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ChartContainer, ChartStyle, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis, Pie, PieChart, Sector, Label as RechartsLabel } from "recharts"
import type { PieSectorShapeProps } from "recharts/types/polar/Pie"
import { Download, Loader2, TrendingUpIcon, TrendingDownIcon, CalendarDays, Info } from "lucide-react"

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
  const firstOfMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  const [startDate, setStartDate] = useState<string>(firstOfMonth)
  const [endDate, setEndDate] = useState<string>(todayStr)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<TransformResult | null>(null)
  const [selectedMonth, setSelectedMonth] = useState<string>("all")
  const [activeTender, setActiveTender] = useState<string>("")
  const [reconciliation, setReconciliation] = useState<any>(null)

  const fetchData = async (start: string, end: string) => {
    setLoading(true)
    setError(null)
    setSelectedMonth("all")

    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000"
      const [salesRes, reconRes] = await Promise.all([
        fetch(`${backendUrl}/api/sales?start_date=${start}&end_date=${end}`),
        fetch(`${backendUrl}/api/reconciliation?start_date=${start}&end_date=${end}`),
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
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    fetchData(firstOfMonth, todayStr)
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

        {/* Filter + Download Row — aligned right */}
        <div className="flex items-center gap-3 flex-wrap justify-end">
          <div className="flex items-center gap-3">
            <CalendarDays className="w-4 h-4 text-muted-foreground" />
            <div className="flex items-center gap-2">
              <Label htmlFor="start-date" className="text-sm font-medium">From</Label>
              <Input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); if (e.target.value && endDate) fetchData(e.target.value, endDate) }}
                className="w-[160px]"
              />
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="end-date" className="text-sm font-medium">To</Label>
              <Input
                id="end-date"
                type="date"
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value); if (startDate && e.target.value) fetchData(startDate, e.target.value) }}
                className="w-[160px]"
              />
            </div>
          </div>
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

            {/* Metric Cards with Period Comparison */}
            <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs dark:*:data-[slot=card]:bg-card">
              <MetricCard
                title="Total Gross Amount"
                value={selectedMonth === "all" ? (currentPeriodMetrics?.total_gross ?? filteredMetrics.total_gross) : filteredMetrics.total_gross}
                prevValue={previousMetrics?.total_gross ?? null}
                footerLabel={comparisonLabel || 'All periods combined'}
                tooltipText="Sum of column 'Gross Amount' from transformed data"
              />
            </div>

            {/* Secondary Metric Cards with Comparison */}
            <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-3 dark:*:data-[slot=card]:bg-card">
              <MetricCard
                title="Net Sales"
                value={selectedMonth === "all" ? (currentPeriodMetrics?.total_net_sales ?? filteredMetrics.total_net_sales) : filteredMetrics.total_net_sales}
                prevValue={previousMetrics?.total_net_sales ?? null}
                footerLabel={comparisonLabel || 'All periods combined'}
                tooltipText="Sum of column 'Net Sales' — revenue after discount before tax"
              />
              <MetricCard
                title="Total Discount"
                value={selectedMonth === "all" ? (currentPeriodMetrics?.total_discount ?? filteredMetrics.total_discount) : filteredMetrics.total_discount}
                prevValue={previousMetrics?.total_discount ?? null}
                footerLabel={comparisonLabel || 'All periods combined'}
                tooltipText="Sum of column 'Discount' from transformed data"
              />
              <MetricCard
                title="Total Tax"
                value={selectedMonth === "all" ? (currentPeriodMetrics?.total_tax ?? filteredMetrics.total_tax) : filteredMetrics.total_tax}
                prevValue={previousMetrics?.total_tax ?? null}
                footerLabel={comparisonLabel || 'All periods combined'}
                tooltipText="Sum of column 'Tax' from transformed data"
              />
            </div>

            {/* Daily Trend — shadcn Area Chart */}
            {filteredChartDaily.length > 1 && (
              <Card className="pt-0 shadow-sm">
                <CardHeader className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
                  <div className="grid flex-1 gap-1">
                    <CardTitle className="flex items-center">
                      Daily Gross Amount Trend
                      <InfoTooltip text="Aggregated 'Gross Amount' per 'Business Date'. Each point = total gross for that day." />
                    </CardTitle>
                    <CardDescription>
                      Gross amount over time{selectedMonth !== "all" ? ` — ${selectedMonth}` : ''}
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
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
                </CardContent>
              </Card>
            )}

            {/* Category + Source Bar Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center">
                    Gross Amount by Category
                    <InfoTooltip text="'Gross Amount' grouped by 'New Category' (derived from Item name pattern matching: 2 Jam, 3 Jam, 1 Comp, 2 Comp)" />
                  </CardTitle>
                  <CardDescription>Aggregation of transformed categories</CardDescription>
                </CardHeader>
                <CardContent>
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
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center">
                    Gross Amount by Source
                    <InfoTooltip text="'Gross Amount' grouped by 'Source' (derived from Item name: Blibli, Tiket.com, Website, Walk In, Kaos Kaki)" />
                  </CardTitle>
                  <CardDescription>Aggregation of mapped lead sources</CardDescription>
                </CardHeader>
                <CardContent>
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
                </CardContent>
              </Card>
            </div>

            {/* Payment Method Pie + Busiest Days — side by side */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Payment Method — Interactive Pie Chart */}
              {tenderPieData.length > 0 && (
                <Card data-chart="pie-tender" className="flex flex-col shadow-sm">
                  <ChartStyle id="pie-tender" config={tenderChartConfig} />
                  <CardHeader className="flex-row items-start space-y-0 pb-0">
                    <div className="grid gap-1">
                      <CardTitle className="flex items-center">
                        Payment Methods
                        <InfoTooltip text="'Gross Amount' grouped by 'Tender' column. Shows distribution across payment methods." />
                      </CardTitle>
                      <CardDescription>By tender type</CardDescription>
                    </div>
                    <Select value={activeTender} onValueChange={setActiveTender}>
                      <SelectTrigger className="ml-auto h-7 w-[160px] rounded-lg pl-2.5" aria-label="Select tender">
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
                  </CardHeader>
                  <CardContent className="flex flex-1 justify-center pb-0">
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
                  </CardContent>
                </Card>
              )}

              {/* Busiest Days Analysis */}
              {busiestDays.length > 0 && (
                <Card className="shadow-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center">
                      Busiest Days
                      <InfoTooltip text="'Net Sales' aggregated by day of week from 'Business Date'. Sorted by highest Net Sales." />
                    </CardTitle>
                    <CardDescription>Net Sales by day of week{selectedMonth !== "all" ? ` — ${selectedMonth}` : ''}</CardDescription>
                  </CardHeader>
                  <CardContent>
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
                    <div className="mt-4 space-y-2">
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
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Reconciliation Table */}
            {reconciliation?.data && reconciliation.data.length > 0 && (
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
            )}

          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
