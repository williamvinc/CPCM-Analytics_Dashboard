"use client"

import React, { useState, useEffect, useMemo } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, CardAction } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuSeparator, DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { Download, Loader2, ChevronDown, Info, TrendingDown, Percent, Store, Layers, ShoppingBag, Tag } from "lucide-react"
import { AnimatedChart } from "@/components/animated-chart"
import { DateRangePicker } from "@/components/ui/date-range-picker"
import { DateRange } from "react-day-picker"

const formatRp = (val: number) => `Rp${val.toLocaleString('id-ID')}`
const formatRpCompact = (val: number) => {
  if (val >= 1_000_000_000) return `Rp${(val / 1_000_000_000).toFixed(1)}B`
  if (val >= 1_000_000) return `Rp${(val / 1_000_000).toFixed(1)}M`
  if (val >= 1_000) return `Rp${(val / 1_000).toFixed(0)}K`
  return `Rp${val.toFixed(0)}`
}

// Date preset helpers
const getDatePresets = () => {
  const today = new Date()
  const formatDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const todayStr = formatDate(today)
  const dayOfWeek = today.getDay()
  const monday = new Date(today)
  monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0)
  const yearStart = new Date(today.getFullYear(), 0, 1)
  const last7 = new Date(today)
  last7.setDate(today.getDate() - 6)
  const last30 = new Date(today)
  last30.setDate(today.getDate() - 29)
  return {
    today: { start: todayStr, end: todayStr, label: 'Today' },
    week: { start: formatDate(monday), end: formatDate(sunday), label: 'This Week' },
    month: { start: formatDate(monthStart), end: formatDate(monthEnd), label: 'This Month' },
    ytd: { start: formatDate(yearStart), end: todayStr, label: 'YTD' },
    last7: { start: formatDate(last7), end: todayStr, label: 'Last 7d' },
    last30: { start: formatDate(last30), end: todayStr, label: 'Last 30d' },
  }
}

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

interface DiscountResult {
  success: boolean
  metrics: {
    total_discount: number
    total_gross: number
    discount_rate: number
    total_transactions: number
    avg_discount: number
  }
  chart_daily: Array<{ date: string; discount: number; gross: number; rate: number }>
  chart_category: Array<{ category: string; discount: number; gross_amount_excl: number; rate: number }>
  chart_outlet: Array<{ outlet: string; discount: number; gross_amount_excl: number; rate: number }>
  top_discounted_items: Array<{ item: string; discount: number; gross_amount_excl: number; rate: number }>
  all_data: any[]
  file_base64: string
  total_rows: number
}

export default function DiscountReportPage() {
  const today = new Date()
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)

  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: firstOfMonth,
    to: today,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<DiscountResult | null>(null)
  const [outlets, setOutlets] = useState<string[]>([])
  const [selectedOutlets, setSelectedOutlets] = useState<string[]>([])
  const [activePreset, setActivePreset] = useState<string | null>(null)

  const datePresets = getDatePresets()
  const formatDateStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  const applyPreset = (presetKey: string) => {
    const preset = datePresets[presetKey as keyof typeof datePresets]
    if (preset) {
      const from = new Date(preset.start + 'T00:00:00')
      const to = new Date(preset.end + 'T00:00:00')
      setDateRange({ from, to })
      setActivePreset(presetKey)
      fetchData(preset.start, preset.end, selectedOutlets)
    }
  }

  const handleDateRangeChange = (range: DateRange | undefined) => {
    setDateRange(range)
    setActivePreset(null)
    if (range?.from && range?.to) {
      fetchData(formatDateStr(range.from), formatDateStr(range.to), selectedOutlets)
    }
  }

  const fetchData = async (start: string, end: string, outletList?: string[]) => {
    setLoading(true)
    setError(null)
    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000"
      const outletParams = (outletList && outletList.length > 0) ? outletList.map(o => `&outlet=${encodeURIComponent(o)}`).join('') : ""
      const res = await fetch(`${backendUrl}/api/discount-report?start_date=${start}&end_date=${end}${outletParams}`)
      if (!res.ok) throw new Error((await res.json()).detail || "Failed to fetch data")
      setResult(await res.json())
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000"
    fetch(`${backendUrl}/api/outlets`).then(r => r.json()).then(d => setOutlets(d.outlets || [])).catch(() => {})
    if (dateRange?.from && dateRange?.to) {
      fetchData(formatDateStr(dateRange.from), formatDateStr(dateRange.to))
    }
  }, [])

  const handleDownload = () => {
    if (!result?.file_base64 || !dateRange?.from || !dateRange?.to) return
    const byteCharacters = atob(result.file_base64)
    const byteNumbers = new Array(byteCharacters.length)
    for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i)
    const blob = new Blob([new Uint8Array(byteNumbers)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `DiscountReport_${formatDateStr(dateRange.from)}_${formatDateStr(dateRange.to)}.xlsx`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const areaChartConfig = {
    discount: { label: 'Discount', color: 'var(--chart-1)' },
  } satisfies ChartConfig

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-6 p-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Discount Report</h1>
          <p className="text-muted-foreground">Analysis of discounts applied to sales transactions</p>
        </div>

        <div className="flex items-center gap-3 flex-wrap justify-between">
          {/* Date Presets - left side */}
          <div className="flex items-center gap-1.5">
            {Object.entries(datePresets).map(([key, preset]) => (
              <Button
                key={key}
                variant={activePreset === key ? "default" : "outline"}
                size="sm"
                onClick={() => applyPreset(key)}
                className="h-8 px-3 text-xs"
              >
                {preset.label}
              </Button>
            ))}
          </div>

          {/* Filters - right side */}
          <div className="flex items-center gap-3 flex-wrap">
          <DateRangePicker
            value={dateRange}
            onChange={handleDateRangeChange}
            className="w-[280px]"
          />

          {outlets.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-[250px] justify-between">
                  <span className="truncate text-sm">{selectedOutlets.length === 0 ? 'All Outlets' : `${selectedOutlets.length} outlet${selectedOutlets.length > 1 ? 's' : ''} selected`}</span>
                  <ChevronDown className="w-4 h-4 ml-2 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[300px]">
                {outlets.map((o: any) => (
                  <DropdownMenuCheckboxItem key={o.id} checked={selectedOutlets.includes(o.id)} onCheckedChange={(checked) => { const n = checked ? [...selectedOutlets, o.id] : selectedOutlets.filter(x => x !== o.id); setSelectedOutlets(n); if (dateRange?.from && dateRange?.to) fetchData(formatDateStr(dateRange.from), formatDateStr(dateRange.to), n) }} onSelect={(e) => e.preventDefault()}>{o.label}</DropdownMenuCheckboxItem>
                ))}
                {selectedOutlets.length > 0 && (<><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => { setSelectedOutlets([]); if (dateRange?.from && dateRange?.to) fetchData(formatDateStr(dateRange.from), formatDateStr(dateRange.to), []) }} className="text-muted-foreground justify-center">Clear all</DropdownMenuItem></>)}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {result && (
            <Button onClick={handleDownload} variant="default" size="default" className="shadow-md rounded-xl font-bold">
              <Download className="w-4 h-4 mr-2" /> Download (.xlsx)
            </Button>
          )}
          {loading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
          </div>
        </div>

        {error && <div className="p-4 bg-destructive/10 text-destructive font-bold rounded-lg">{error}</div>}

        {result && result.metrics && (
          <div className="flex flex-col gap-6 animate-in fade-in zoom-in-95 duration-500">
            <div className="flex items-center gap-2 pt-2">
              <div className="h-8 w-1 rounded-full bg-rose-500" />
              <h2 className="text-xl font-semibold tracking-tight">Discount Overview</h2>
            </div>

            <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-br *:data-[slot=card]:from-rose-50 *:data-[slot=card]:to-pink-50/50 *:data-[slot=card]:shadow-sm dark:*:data-[slot=card]:from-rose-950/30 dark:*:data-[slot=card]:to-pink-950/20">
              <Card className="@container/card" data-slot="card">
                <CardHeader>
                  <CardDescription className="flex items-center"><Tag className="w-4 h-4 mr-2" />Total Discount<InfoTooltip text="SUM(discount) dari semua transaksi yang memiliki diskon" /></CardDescription>
                  <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">{formatRp(result.metrics.total_discount)}</CardTitle>
                  <CardAction><Badge variant="outline" className="text-rose-600 border-rose-200"><TrendingDown className="size-3 mr-1" />{result.metrics.discount_rate}% of gross</Badge></CardAction>
                </CardHeader>
                <CardFooter className="text-sm text-muted-foreground">{result.metrics.total_transactions.toLocaleString()} transactions with discount</CardFooter>
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-3 *:data-[slot=card]:bg-gradient-to-br *:data-[slot=card]:from-rose-50 *:data-[slot=card]:to-pink-50/50 *:data-[slot=card]:shadow-sm dark:*:data-[slot=card]:from-rose-950/30 dark:*:data-[slot=card]:to-pink-950/20">
              <Card className="@container/card" data-slot="card">
                <CardHeader>
                  <CardDescription className="flex items-center">Total Gross (Discounted)<InfoTooltip text="SUM(gross_amount_excl) dari transaksi dengan diskon" /></CardDescription>
                  <CardTitle className="text-2xl font-semibold tabular-nums">{formatRp(result.metrics.total_gross)}</CardTitle>
                </CardHeader>
                <CardFooter className="text-sm text-muted-foreground">Before discount applied</CardFooter>
              </Card>
              <Card className="@container/card" data-slot="card">
                <CardHeader>
                  <CardDescription className="flex items-center"><Percent className="w-4 h-4 mr-2" />Discount Rate<InfoTooltip text="(Total Discount / Total Gross) * 100" /></CardDescription>
                  <CardTitle className="text-2xl font-semibold tabular-nums">{result.metrics.discount_rate}%</CardTitle>
                </CardHeader>
                <CardFooter className="text-sm text-muted-foreground">Overall discount percentage</CardFooter>
              </Card>
              <Card className="@container/card" data-slot="card">
                <CardHeader>
                  <CardDescription className="flex items-center">Average Discount<InfoTooltip text="Total Discount / Total Transactions" /></CardDescription>
                  <CardTitle className="text-2xl font-semibold tabular-nums">{formatRp(result.metrics.avg_discount)}</CardTitle>
                </CardHeader>
                <CardFooter className="text-sm text-muted-foreground">Per transaction</CardFooter>
              </Card>
            </div>

            {result.chart_daily && result.chart_daily.length > 1 && (
              <>
                <Separator />
                <AnimatedChart className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold">Daily Discount Trend</h3>
                    <InfoTooltip text="SUM(discount) per Business Date" />
                  </div>
                  <p className="text-sm text-muted-foreground">Discount amount over time</p>
                  <ChartContainer config={areaChartConfig} className="aspect-auto h-[300px] w-full">
                    <AreaChart data={result.chart_daily}>
                      <defs>
                        <linearGradient id="fillDiscount" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--color-discount)" stopOpacity={0.8} />
                          <stop offset="95%" stopColor="var(--color-discount)" stopOpacity={0.1} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} tickFormatter={(v) => new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric" })} />
                      <YAxis tickFormatter={(val) => formatRpCompact(val)} tickLine={false} axisLine={false} />
                      <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={(v) => new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric" })} indicator="dot" />} />
                      <Area dataKey="discount" type="natural" fill="url(#fillDiscount)" stroke="var(--color-discount)" isAnimationActive={true} animationDuration={1500} animationEasing="ease-out" />
                    </AreaChart>
                  </ChartContainer>
                </AnimatedChart>
              </>
            )}

            <Separator />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {result.chart_category && result.chart_category.length > 0 && (
                <AnimatedChart className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-muted-foreground" />
                    <h3 className="text-base font-semibold">Discount by Category</h3>
                    <InfoTooltip text="SUM(discount) GROUP BY category" />
                  </div>
                  <p className="text-sm text-muted-foreground">Top 15 categories by discount amount</p>
                  <ChartContainer config={{ discount: { label: 'Discount', color: 'var(--chart-2)' } }} className="h-[350px] w-full">
                    <BarChart data={result.chart_category} margin={{ top: 10, right: 10, bottom: 20, left: 0 }} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tickFormatter={(val) => formatRpCompact(val)} />
                      <YAxis dataKey="category" type="category" width={180} tick={{ fontSize: 11 }} tickFormatter={(v) => v.length > 25 ? v.slice(0, 25) + '…' : v} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="discount" fill="var(--color-discount)" radius={[0, 4, 4, 0]} isAnimationActive={true} animationDuration={800} animationEasing="ease-out" />
                    </BarChart>
                  </ChartContainer>
                </AnimatedChart>
              )}

              {result.chart_outlet && result.chart_outlet.length > 0 && (
                <AnimatedChart className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Store className="w-4 h-4 text-muted-foreground" />
                    <h3 className="text-base font-semibold">Discount by Outlet</h3>
                    <InfoTooltip text="SUM(discount) GROUP BY outlet" />
                  </div>
                  <p className="text-sm text-muted-foreground">Discount distribution across outlets</p>
                  <ChartContainer config={{ discount: { label: 'Discount', color: 'var(--chart-3)' } }} className="h-[350px] w-full">
                    <BarChart data={result.chart_outlet} margin={{ top: 10, right: 10, bottom: 20, left: 0 }} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tickFormatter={(val) => formatRpCompact(val)} />
                      <YAxis dataKey="outlet" type="category" width={200} tick={{ fontSize: 11 }} tickFormatter={(v) => v.length > 30 ? v.slice(0, 30) + '…' : v} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="discount" fill="var(--color-discount)" radius={[0, 4, 4, 0]} isAnimationActive={true} animationDuration={800} animationEasing="ease-out" />
                    </BarChart>
                  </ChartContainer>
                </AnimatedChart>
              )}
            </div>

            {result.top_discounted_items && result.top_discounted_items.length > 0 && (
              <>
                <Separator />
                <AnimatedChart className="space-y-3">
                  <div className="flex items-center gap-2">
                    <ShoppingBag className="w-4 h-4 text-muted-foreground" />
                    <h3 className="text-base font-semibold">Top 20 Discounted Items</h3>
                    <InfoTooltip text="SUM(discount) GROUP BY item, TOP 20 DESC" />
                  </div>
                  <p className="text-sm text-muted-foreground">Items with highest discount amount</p>
                  <ChartContainer config={{ discount: { label: 'Discount', color: 'var(--chart-4)' } }} className="h-[500px] w-full">
                    <BarChart data={result.top_discounted_items} layout="vertical" margin={{ top: 0, right: 10, bottom: 0, left: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tickFormatter={(val) => formatRpCompact(val)} />
                      <YAxis dataKey="item" type="category" width={200} tick={{ fontSize: 11 }} tickFormatter={(v) => v.length > 30 ? v.slice(0, 30) + '…' : v} />
                      <ChartTooltip content={<ChartTooltipContent formatter={(value, name) => { if (name === 'discount') return [formatRp(value as number), 'Discount']; return [value, name] }} />} />
                      <Bar dataKey="discount" fill="var(--color-discount)" radius={[0, 4, 4, 0]} isAnimationActive={true} animationDuration={800} animationEasing="ease-out" />
                    </BarChart>
                  </ChartContainer>
                  <div className="space-y-1.5 mt-4">
                    {result.top_discounted_items.slice(0, 5).map((item, i) => (
                      <div key={item.item} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <Badge variant={i === 0 ? 'default' : 'secondary'} className="text-xs">#{i + 1}</Badge>
                          <span className="font-medium truncate max-w-[250px]">{item.item}</span>
                        </div>
                        <div className="text-right">
                          <span className="font-semibold">{formatRp(item.discount)}</span>
                          <span className="text-muted-foreground text-xs ml-2">({item.rate}%)</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </AnimatedChart>
              </>
            )}
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
