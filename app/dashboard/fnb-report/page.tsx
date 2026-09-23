"use client"

import * as React from "react"
import { useState, useEffect, useMemo, useCallback } from "react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { DateRangePicker } from "@/components/ui/date-range-picker"
import { DateRange } from "react-day-picker"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ChartContainer, ChartStyle, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis, Pie, PieChart, Label as RechartsLabel } from "recharts"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { AnimatedChart } from "@/components/animated-chart"
import { Loader2, Store, UtensilsCrossed, Layers, Trophy, Clock, TrendingUp, TrendingDown, Info } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const FNB_OUTLETS = [
  { id: "OUTLET01-Park Nickelodeon", label: "Garfield Café (SNP)" },
  { id: "OUTLET02-Nickelodeon Theme Park Carstensz Mall", label: "Mr. Porter Café (CPP)" },
]

const formatRp = (val: number) => {
  if (val >= 1_000_000_000) return `Rp${(val / 1_000_000_000).toFixed(1)}B`
  if (val >= 1_000_000) return `Rp${(val / 1_000_000).toFixed(1)}M`
  if (val >= 1_000) return `Rp${(val / 1_000).toFixed(0)}K`
  return `Rp${val.toFixed(0)}`
}

const formatRpFull = (val: number) => `Rp${val.toLocaleString('id-ID')}`

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

function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="rounded-full bg-muted p-3 mb-4">
        <Info className="w-6 h-6 text-muted-foreground" />
      </div>
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
    </div>
  )
}

export default function FnbReportPage() {
  const today = new Date()
  const prevMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  const prevMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0)

  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: prevMonthStart,
    to: prevMonthEnd,
  })
  const [loading, setLoading] = useState(true)
  const [fnbData, setFnbData] = useState<any>(null)
  const [fnbReconciliation, setFnbReconciliation] = useState<any>(null)
  const [selectedOutlet, setSelectedOutlet] = useState<string>("all")

  const formatDateStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  const fetchData = async () => {
    if (!dateRange?.from || !dateRange?.to) return

    setLoading(true)
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000"
    const startDate = formatDateStr(dateRange.from)
    const endDate = formatDateStr(dateRange.to)

    try {
      const outletParam = selectedOutlet !== "all" ? `&outlet=${encodeURIComponent(selectedOutlet)}` : ""

      const [fnbRes, fnbReconRes] = await Promise.all([
        fetch(`${backendUrl}/api/fnb-sales?start_date=${startDate}&end_date=${endDate}${outletParam}`),
        fetch(`${backendUrl}/api/fnb-reconciliation?start_date=${startDate}&end_date=${endDate}${outletParam}`),
      ])

      if (fnbRes.ok) {
        const result = await fnbRes.json()
        setFnbData(result)
      }

      if (fnbReconRes.ok) {
        const reconData = await fnbReconRes.json()
        setFnbReconciliation(reconData)
      }
    } catch (err) {
      console.error("Failed to fetch F&B data:", err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [dateRange, selectedOutlet])

  return (
    <TooltipProvider>
      <div className="flex flex-1 flex-col gap-6 p-6">
        {/* Header */}
        <div className="flex items-center gap-2">
          <div className="h-8 w-1 rounded-full bg-orange-500" />
          <h1 className="text-2xl font-bold">F&B Report</h1>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-4">
          <DateRangePicker value={dateRange} onChange={setDateRange} className="w-auto" />
          <Select value={selectedOutlet} onValueChange={setSelectedOutlet}>
            <SelectTrigger className="w-[250px]">
              <Store className="mr-2 h-4 w-4" />
              <SelectValue placeholder="Select outlet" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Outlets</SelectItem>
              {FNB_OUTLETS.map((outlet) => (
                <SelectItem key={outlet.id} value={outlet.id}>
                  {outlet.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={fetchData} disabled={loading} variant="outline">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Refresh
          </Button>
        </div>

        {/* Loading State */}
        {loading && !fnbData && (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-3">
              <div className="h-28 rounded-xl bg-gradient-to-r from-muted via-muted/50 to-muted bg-[length:200%_100%] animate-[shimmer_1.5s_ease-in-out_infinite]" />
              <div className="h-28 rounded-xl bg-gradient-to-r from-muted via-muted/50 to-muted bg-[length:200%_100%] animate-[shimmer_1.5s_ease-in-out_infinite] [animation-delay:100ms]" />
              <div className="h-28 rounded-xl bg-gradient-to-r from-muted via-muted/50 to-muted bg-[length:200%_100%] animate-[shimmer_1.5s_ease-in-out_infinite] [animation-delay:200ms]" />
            </div>
            <div className="h-[300px] rounded-xl bg-gradient-to-r from-muted via-muted/50 to-muted bg-[length:200%_100%] animate-[shimmer_1.5s_ease-in-out_infinite]" />
          </div>
        )}

        {fnbData && fnbData.success && (
          <div className="flex flex-col gap-6 animate-in fade-in zoom-in-95 duration-500">
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
            {fnbData.peak_hours && fnbData.peak_hours.length > 0 && (
              <>
                <Separator />
                <AnimatedChart className="space-y-3">
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
                      <Bar dataKey="revenue" fill="url(#fillPeakHour)" radius={[4, 4, 0, 0]} isAnimationActive={true} animationDuration={800} animationEasing="ease-out" />
                    </BarChart>
                  </ChartContainer>
                </AnimatedChart>
              </>
            )}

            {/* Food vs Beverages Split Pie */}
            {fnbData.category_split && fnbData.category_split.length > 0 && (
              <>
                <Separator />
                <AnimatedChart className="space-y-3">
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
                          isAnimationActive={true}
                          animationDuration={1000}
                          animationEasing="ease-out"
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
                </AnimatedChart>
              </>
            )}

            {/* Top 10 & Bottom 10 Items */}
            <Separator />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Top 10 */}
              {fnbData.top_10_items && fnbData.top_10_items.length > 0 && (
                <AnimatedChart className="space-y-3">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-green-600" />
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
                      <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[0, 4, 4, 0]} isAnimationActive={true} animationDuration={800} animationEasing="ease-out" />
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
                </AnimatedChart>
              )}

              {/* Bottom 10 */}
              {fnbData.bottom_10_items && fnbData.bottom_10_items.length > 0 && (
                <AnimatedChart className="space-y-3">
                  <div className="flex items-center gap-2">
                    <TrendingDown className="w-4 h-4 text-red-500" />
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
                      <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[0, 4, 4, 0]} isAnimationActive={true} animationDuration={800} animationEasing="ease-out" />
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
                </AnimatedChart>
              )}
            </div>

            {/* F&B Reconciliation Table */}
            {fnbReconciliation?.data && fnbReconciliation.data.length > 0 && (
              <>
                <Separator />
                <Card className="shadow-sm">
                  <CardHeader>
                    <CardTitle>F&B POS vs Bank</CardTitle>
                    <CardDescription>Cafe reconciliation per store</CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <div className="max-h-[480px] overflow-y-auto">
                        <table className="w-full text-sm">
                          <thead className="sticky top-0 bg-background z-10">
                            <tr className="border-b bg-muted/40">
                              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Date</th>
                              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Store</th>
                              <th className="px-4 py-3 text-right font-medium text-muted-foreground">POS</th>
                              <th className="px-4 py-3 text-right font-medium text-muted-foreground">BRI</th>
                              <th className="px-4 py-3 text-right font-medium text-muted-foreground">BCA</th>
                              <th className="px-4 py-3 text-right font-medium text-muted-foreground">BNI</th>
                              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Nusapay</th>
                              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Deposit</th>
                              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Voucher</th>
                              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Total Bank</th>
                              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Difference</th>
                            </tr>
                          </thead>
                          <tbody>
                            {fnbReconciliation.data.map((row: any, i: number) => (
                              <tr key={`${row.date}-${row.store}`} className={i % 2 === 0 ? '' : 'bg-muted/20'}>
                                <td className="px-4 py-2.5 font-medium">{row.date}</td>
                                <td className="px-4 py-2.5">{row.store}</td>
                                <td className="px-4 py-2.5 text-right tabular-nums">{formatRpFull(row.pos)}</td>
                                <td className="px-4 py-2.5 text-right tabular-nums">{formatRpFull(row.bri || 0)}</td>
                                <td className="px-4 py-2.5 text-right tabular-nums">{formatRpFull(row.bca || 0)}</td>
                                <td className="px-4 py-2.5 text-right tabular-nums">{formatRpFull(row.bni || 0)}</td>
                                <td className="px-4 py-2.5 text-right tabular-nums">{formatRpFull(row.nusapay || 0)}</td>
                                <td className="px-4 py-2.5 text-right tabular-nums">{formatRpFull(row.deposit || 0)}</td>
                                <td className="px-4 py-2.5 text-right tabular-nums">{formatRpFull(row.voucher || 0)}</td>
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
                              <td className="px-4 py-3"></td>
                              <td className="px-4 py-3 text-right tabular-nums">{formatRpFull(fnbReconciliation.totals.pos)}</td>
                              <td className="px-4 py-3 text-right tabular-nums">{formatRpFull(fnbReconciliation.totals.bri)}</td>
                              <td className="px-4 py-3 text-right tabular-nums">{formatRpFull(fnbReconciliation.totals.bca)}</td>
                              <td className="px-4 py-3 text-right tabular-nums">{formatRpFull(fnbReconciliation.totals.bni || 0)}</td>
                              <td className="px-4 py-3 text-right tabular-nums">{formatRpFull(fnbReconciliation.totals.nusapay)}</td>
                              <td className="px-4 py-3 text-right tabular-nums">{formatRpFull(fnbReconciliation.totals.deposit)}</td>
                              <td className="px-4 py-3 text-right tabular-nums">{formatRpFull(fnbReconciliation.totals.voucher)}</td>
                              <td className="px-4 py-3 text-right tabular-nums">{formatRpFull(fnbReconciliation.totals.bank_total)}</td>
                              <td className={`px-4 py-3 text-right tabular-nums font-bold ${fnbReconciliation.totals.difference < 0 ? 'text-red-500' : ''}`}>
                                {formatRpFull(fnbReconciliation.totals.difference)}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        )}

        {/* Empty State */}
        {!loading && (!fnbData || !fnbData.success) && (
          <EmptyState
            title="No F&B data available"
            description="No data found for the selected period. Try selecting a different date range."
          />
        )}
      </div>
    </TooltipProvider>
  )
}
