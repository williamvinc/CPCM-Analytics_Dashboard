"use client"

import React, { useState, useEffect, useMemo } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, CardAction } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis, Pie, PieChart, Cell } from "recharts"
import { Download, Loader2, Info, Building2, CreditCard, Percent, Banknote, Clock, TrendingUp } from "lucide-react"
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

interface MerchantBankResult {
  success: boolean
  metrics: {
    total_gross: number
    total_mdr: number
    total_nett: number
    mdr_rate: number
    total_transactions: number
    bca_total: number
    bri_total: number
    bni_total: number
  }
  chart_daily: Array<{ date: string; gross: number; mdr: number; nett: number }>
  chart_by_bank: Array<{ bank: string; gross_amount: number; mdr_amount: number; nett_amount: number; mdr_rate: number }>
  chart_by_card_type: Array<{ card_type: string; gross_amount: number; mdr_amount: number; mdr_rate: number }>
  chart_settlement: Array<{ days: number; amount: number }>
  all_data: any[]
  file_base64: string
  total_rows: number
}

const BANK_COLORS = {
  BCA: 'var(--chart-1)',
  BRI: 'var(--chart-2)',
  BNI: 'var(--chart-3)',
}

export default function MerchantBankReportPage() {
  const today = new Date()
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)

  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: firstOfMonth,
    to: today,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<MerchantBankResult | null>(null)
  const [bankFilter, setBankFilter] = useState<string>("all")
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
      fetchData(preset.start, preset.end, bankFilter)
    }
  }

  const handleDateRangeChange = (range: DateRange | undefined) => {
    setDateRange(range)
    setActivePreset(null)
    if (range?.from && range?.to) {
      fetchData(formatDateStr(range.from), formatDateStr(range.to), bankFilter)
    }
  }

  const fetchData = async (start: string, end: string, bank?: string) => {
    setLoading(true)
    setError(null)
    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000"
      const bankParam = bank && bank !== "all" ? `&bank=${bank}` : ""
      const res = await fetch(`${backendUrl}/api/merchant-bank-report?start_date=${start}&end_date=${end}${bankParam}`)
      if (!res.ok) throw new Error((await res.json()).detail || "Failed to fetch data")
      setResult(await res.json())
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
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
    a.download = `MerchantBankReport_${formatDateStr(dateRange.from)}_${formatDateStr(dateRange.to)}.xlsx`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const areaChartConfig = {
    gross: { label: 'Gross', color: 'var(--chart-1)' },
    nett: { label: 'Nett', color: 'var(--chart-2)' },
  } satisfies ChartConfig

  const bankPieData = useMemo(() => {
    if (!result?.metrics) return []
    return [
      { name: 'BCA', value: result.metrics.bca_total, fill: BANK_COLORS.BCA },
      { name: 'BRI', value: result.metrics.bri_total, fill: BANK_COLORS.BRI },
      { name: 'BNI', value: result.metrics.bni_total, fill: BANK_COLORS.BNI },
    ].filter(d => d.value > 0)
  }, [result])

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-6 p-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Merchant Bank Report</h1>
          <p className="text-muted-foreground">BCA, BRI & BNI transaction details with settlement and MDR analysis</p>
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

          <Select value={bankFilter} onValueChange={(v) => { setBankFilter(v); if (dateRange?.from && dateRange?.to) fetchData(formatDateStr(dateRange.from), formatDateStr(dateRange.to), v !== "all" ? v : undefined) }}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Filter by bank" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Banks</SelectItem>
              <SelectItem value="bca">BCA Only</SelectItem>
              <SelectItem value="bri">BRI Only</SelectItem>
              <SelectItem value="bni">BNI Only</SelectItem>
            </SelectContent>
          </Select>

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
              <div className="h-8 w-1 rounded-full bg-blue-500" />
              <h2 className="text-xl font-semibold tracking-tight">Transaction Overview</h2>
            </div>

            <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-br *:data-[slot=card]:from-blue-50 *:data-[slot=card]:to-indigo-50/50 *:data-[slot=card]:shadow-sm dark:*:data-[slot=card]:from-blue-950/30 dark:*:data-[slot=card]:to-indigo-950/20">
              <Card className="@container/card" data-slot="card">
                <CardHeader>
                  <CardDescription className="flex items-center"><Banknote className="w-4 h-4 mr-2" />Total Gross Amount<InfoTooltip text="SUM(gross_amount) dari BCA + BRI + BNI transactions" /></CardDescription>
                  <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">{formatRp(result.metrics.total_gross)}</CardTitle>
                  <CardAction><Badge variant="outline" className="text-blue-600 border-blue-200"><TrendingUp className="size-3 mr-1" />{result.metrics.total_transactions.toLocaleString()} txn</Badge></CardAction>
                </CardHeader>
                <CardFooter className="text-sm text-muted-foreground">Before MDR deduction</CardFooter>
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-4 *:data-[slot=card]:bg-gradient-to-br *:data-[slot=card]:from-blue-50 *:data-[slot=card]:to-indigo-50/50 *:data-[slot=card]:shadow-sm dark:*:data-[slot=card]:from-blue-950/30 dark:*:data-[slot=card]:to-indigo-950/20">
              <Card className="@container/card" data-slot="card">
                <CardHeader>
                  <CardDescription className="flex items-center"><Percent className="w-4 h-4 mr-2" />Total MDR (BCA + BRI + BNI)<InfoTooltip text="SUM(mdr_amount) dari transaksi BCA, BRI dan BNI, Merchant Discount Rate fee yang dipotong bank" /></CardDescription>
                  <CardTitle className="text-2xl font-semibold tabular-nums">{formatRp(result.metrics.total_mdr)}</CardTitle>
                </CardHeader>
                <CardFooter className="text-sm text-muted-foreground">{result.metrics.mdr_rate}% average rate</CardFooter>
              </Card>
              <Card className="@container/card" data-slot="card">
                <CardHeader>
                  <CardDescription className="flex items-center">Nett Amount<InfoTooltip text="SUM(nett_amount) dari BCA, BRI dan BNI setelah dipotong MDR" /></CardDescription>
                  <CardTitle className="text-2xl font-semibold tabular-nums">{formatRp(result.metrics.total_nett)}</CardTitle>
                </CardHeader>
                <CardFooter className="text-sm text-muted-foreground">Amount received</CardFooter>
              </Card>
              <Card className="@container/card bg-sky-50!" data-slot="card">
                <CardHeader>
                  <CardDescription className="flex items-center"><Building2 className="w-4 h-4 mr-2" />BCA Total<InfoTooltip text="SUM(gross_amount) BCA transactions" /></CardDescription>
                  <CardTitle className="text-2xl font-semibold tabular-nums">{formatRp(result.metrics.bca_total)}</CardTitle>
                </CardHeader>
                <CardFooter className="text-sm text-muted-foreground">{result.metrics.total_gross > 0 ? ((result.metrics.bca_total / result.metrics.total_gross) * 100).toFixed(1) : 0}% of total</CardFooter>
              </Card>
              <Card className="@container/card bg-orange-50!" data-slot="card">
                <CardHeader>
                  <CardDescription className="flex items-center"><Building2 className="w-4 h-4 mr-2" />BRI Total<InfoTooltip text="SUM(gross_amount) BRI transactions" /></CardDescription>
                  <CardTitle className="text-2xl font-semibold tabular-nums">{formatRp(result.metrics.bri_total)}</CardTitle>
                </CardHeader>
                <CardFooter className="text-sm text-muted-foreground">{result.metrics.total_gross > 0 ? ((result.metrics.bri_total / result.metrics.total_gross) * 100).toFixed(1) : 0}% of total</CardFooter>
              </Card>
              <Card className="@container/card bg-emerald-50!" data-slot="card">
                <CardHeader>
                  <CardDescription className="flex items-center"><Building2 className="w-4 h-4 mr-2" />BNI Total<InfoTooltip text="SUM(gross_amount) BNI transactions" /></CardDescription>
                  <CardTitle className="text-2xl font-semibold tabular-nums">{formatRp(result.metrics.bni_total || 0)}</CardTitle>
                </CardHeader>
                <CardFooter className="text-sm text-muted-foreground">{result.metrics.total_gross > 0 ? (((result.metrics.bni_total || 0) / result.metrics.total_gross) * 100).toFixed(1) : 0}% of total</CardFooter>
              </Card>
            </div>

            {result.chart_daily && result.chart_daily.length > 1 && (
              <>
                <Separator />
                <AnimatedChart className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold">Daily Transaction Trend</h3>
                    <InfoTooltip text="SUM(gross_amount) dan SUM(nett_amount) per Transaction Date" />
                  </div>
                  <p className="text-sm text-muted-foreground">Gross vs Nett amount over time</p>
                  <ChartContainer config={areaChartConfig} className="aspect-auto h-[300px] w-full">
                    <AreaChart data={result.chart_daily}>
                      <defs>
                        <linearGradient id="fillGross" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--color-gross)" stopOpacity={0.8} />
                          <stop offset="95%" stopColor="var(--color-gross)" stopOpacity={0.1} />
                        </linearGradient>
                        <linearGradient id="fillNett" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--color-nett)" stopOpacity={0.8} />
                          <stop offset="95%" stopColor="var(--color-nett)" stopOpacity={0.1} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} tickFormatter={(v) => new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric" })} />
                      <YAxis tickFormatter={(val) => formatRpCompact(val)} tickLine={false} axisLine={false} />
                      <ChartTooltip content={<ChartTooltipContent labelFormatter={(v) => new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric" })} />} />
                      <Area dataKey="gross" type="natural" fill="url(#fillGross)" stroke="var(--color-gross)" stackId="1" isAnimationActive={true} animationDuration={1500} animationEasing="ease-out" />
                      <Area dataKey="nett" type="natural" fill="url(#fillNett)" stroke="var(--color-nett)" stackId="2" isAnimationActive={true} animationDuration={1500} animationEasing="ease-out" />
                    </AreaChart>
                  </ChartContainer>
                </AnimatedChart>
              </>
            )}

            <Separator />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {bankPieData.length > 0 && (
                <AnimatedChart className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-muted-foreground" />
                    <h3 className="text-base font-semibold">Transaction by Bank</h3>
                    <InfoTooltip text="SUM(gross_amount) GROUP BY bank" />
                  </div>
                  <p className="text-sm text-muted-foreground">BCA vs BRI vs BNI distribution</p>
                  <ChartContainer config={{ bca: { label: 'BCA', color: 'var(--chart-1)' }, bri: { label: 'BRI', color: 'var(--chart-2)' }, bni: { label: 'BNI', color: 'var(--chart-3)' } }} className="mx-auto aspect-square w-full max-w-[280px]">
                    <PieChart>
                      <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                      <Pie data={bankPieData} dataKey="value" nameKey="name" innerRadius={60} strokeWidth={5} isAnimationActive={true} animationDuration={1000} animationEasing="ease-out">
                        {bankPieData.map((entry) => (
                          <Cell key={entry.name} fill={entry.fill} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ChartContainer>
                  <div className="flex justify-center gap-6 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: BANK_COLORS.BCA }} />
                      <span className="font-medium">BCA</span>
                      <span className="text-muted-foreground">{formatRpCompact(result.metrics.bca_total)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: BANK_COLORS.BRI }} />
                      <span className="font-medium">BRI</span>
                      <span className="text-muted-foreground">{formatRpCompact(result.metrics.bri_total)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: BANK_COLORS.BNI }} />
                      <span className="font-medium">BNI</span>
                      <span className="text-muted-foreground">{formatRpCompact(result.metrics.bni_total || 0)}</span>
                    </div>
                  </div>
                </AnimatedChart>
              )}

              {result.chart_by_card_type && result.chart_by_card_type.length > 0 && (
                <AnimatedChart className="space-y-3">
                  <div className="flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-muted-foreground" />
                    <h3 className="text-base font-semibold">Transaction by Card Type</h3>
                    <InfoTooltip text="SUM(gross_amount) GROUP BY card_type" />
                  </div>
                  <p className="text-sm text-muted-foreground">Top 10 card types by volume</p>
                  <ChartContainer config={{ gross_amount: { label: 'Gross', color: 'var(--chart-3)' } }} className="h-[300px] w-full">
                    <BarChart data={result.chart_by_card_type} margin={{ top: 10, right: 10, bottom: 20, left: 0 }} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tickFormatter={(val) => formatRpCompact(val)} />
                      <YAxis dataKey="card_type" type="category" width={120} tick={{ fontSize: 11 }} tickFormatter={(v) => v.length > 15 ? v.slice(0, 15) + '…' : v} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="gross_amount" fill="var(--color-gross_amount)" radius={[0, 4, 4, 0]} isAnimationActive={true} animationDuration={800} animationEasing="ease-out" />
                    </BarChart>
                  </ChartContainer>
                </AnimatedChart>
              )}
            </div>

            {result.chart_settlement && result.chart_settlement.length > 0 && (
              <>
                <Separator />
                <AnimatedChart className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    <h3 className="text-base font-semibold">Settlement Timeline</h3>
                    <InfoTooltip text="SUM(gross_amount) GROUP BY days between transaction and settlement" />
                  </div>
                  <p className="text-sm text-muted-foreground">Days from transaction to settlement</p>
                  <ChartContainer config={{ amount: { label: 'Amount', color: 'var(--chart-4)' } }} className="aspect-auto h-[250px] w-full">
                    <BarChart data={result.chart_settlement} margin={{ top: 10, right: 10, bottom: 20, left: 0 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="days" tickLine={false} axisLine={false} tickMargin={8} tickFormatter={(v) => `${v}d`} />
                      <YAxis tickFormatter={(val) => formatRpCompact(val)} tickLine={false} axisLine={false} />
                      <ChartTooltip content={<ChartTooltipContent labelFormatter={(v) => `${v} days to settle`} />} />
                      <Bar dataKey="amount" fill="var(--color-amount)" radius={[4, 4, 0, 0]} isAnimationActive={true} animationDuration={800} animationEasing="ease-out" />
                    </BarChart>
                  </ChartContainer>
                </AnimatedChart>
              </>
            )}

            {result.chart_by_bank && result.chart_by_bank.length > 0 && (
              <>
                <Separator />
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Percent className="w-4 h-4 text-muted-foreground" />
                    <h3 className="text-base font-semibold">MDR Comparison by Bank</h3>
                    <InfoTooltip text="MDR rate comparison between BCA, BRI and BNI" />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {result.chart_by_bank.map((bank) => (
                      <Card key={bank.bank} className="shadow-sm">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-lg flex items-center gap-2">
                            <Building2 className="w-5 h-5" />
                            {bank.bank}
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Gross Amount</span>
                              <span className="font-semibold">{formatRp(bank.gross_amount)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">MDR Fee</span>
                              <span className="font-semibold text-red-500">-{formatRp(bank.mdr_amount)}</span>
                            </div>
                            <Separator />
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Nett Amount</span>
                              <span className="font-bold text-green-600">{formatRp(bank.nett_amount)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">MDR Rate</span>
                              <Badge variant="secondary">{bank.mdr_rate}%</Badge>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
