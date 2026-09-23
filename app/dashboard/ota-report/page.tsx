"use client"

import * as React from "react"
import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { DateRangePicker } from "@/components/ui/date-range-picker"
import { DateRange } from "react-day-picker"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Loader2, Store, Plane, CreditCard, TrendingUp, Info, Globe, Download, Ticket } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"

const OUTLETS = [
  { id: "OUTLET01-Park Nickelodeon", label: "SNP (Park Nickelodeon)" },
  { id: "OUTLET02-Nickelodeon Theme Park Carstensz Mall", label: "CPP (Carstensz Mall)" },
]

const PLATFORMS = [
  { id: "tiketcom", label: "Tiket.com", color: "bg-blue-500" },
  { id: "blibli", label: "Blibli", color: "bg-orange-500" },
  { id: "website", label: "Website", color: "bg-green-500" },
]

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

export default function OtaReportPage() {
  const today = new Date()
  const prevMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  const prevMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0)

  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: prevMonthStart,
    to: prevMonthEnd,
  })
  const [loading, setLoading] = useState(true)
  const [otaData, setOtaData] = useState<any>(null)
  const [selectedOutlet, setSelectedOutlet] = useState<string>("all")
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(["tiketcom", "blibli", "website"])

  const formatDateStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  const fetchData = async () => {
    if (!dateRange?.from || !dateRange?.to) return

    setLoading(true)
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000"
    const startDate = formatDateStr(dateRange.from)
    const endDate = formatDateStr(dateRange.to)

    try {
      const outletParam = selectedOutlet !== "all" ? `&outlet=${encodeURIComponent(selectedOutlet)}` : ""
      const platformParams = selectedPlatforms.map(p => `&platform=${encodeURIComponent(p)}`).join('')

      const res = await fetch(`${backendUrl}/api/ota-report?start_date=${startDate}&end_date=${endDate}${outletParam}${platformParams}`)

      if (res.ok) {
        const result = await res.json()
        setOtaData(result)
      }
    } catch (err) {
      console.error("Failed to fetch OTA data:", err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [dateRange, selectedOutlet, selectedPlatforms])

  const handlePlatformToggle = (platformId: string) => {
    setSelectedPlatforms(prev => {
      if (prev.includes(platformId)) {
        if (prev.length === 1) return prev
        return prev.filter(p => p !== platformId)
      }
      return [...prev, platformId]
    })
  }

  const downloadExcel = () => {
    if (!otaData?.detail_data || otaData.detail_data.length === 0) return

    const headers = ['Date', 'Store', 'Platform', 'Order ID', 'Item', 'Qty', 'Gross Excl', 'Discount', 'Net Sales', 'Tax', 'Gross All Incl']
    const rows = otaData.detail_data.map((row: any) => [
      row.date,
      row.store,
      row.platform,
      row.order_id,
      row.item,
      row.qty,
      row.gross_excl,
      row.discount,
      row.net_sales,
      row.tax,
      row.gross_all_incl,
    ])

    const csvContent = [headers, ...rows].map(r => r.map((c: any) => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ota-report-${formatDateStr(dateRange?.from || new Date())}-${formatDateStr(dateRange?.to || new Date())}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <TooltipProvider>
      <div className="flex flex-1 flex-col gap-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-1 rounded-full bg-blue-500" />
            <h1 className="text-2xl font-bold">OTA Report</h1>
            <Badge variant="secondary" className="ml-2">Online Travel Agent</Badge>
          </div>
          {otaData?.detail_data && otaData.detail_data.length > 0 && (
            <Button variant="outline" size="sm" onClick={downloadExcel}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-4">
          <DateRangePicker value={dateRange} onChange={setDateRange} className="w-auto" />
          <Select value={selectedOutlet} onValueChange={setSelectedOutlet}>
            <SelectTrigger className="w-[280px]">
              <Store className="mr-2 h-4 w-4" />
              <SelectValue placeholder="Select outlet" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Outlets</SelectItem>
              {OUTLETS.map((outlet) => (
                <SelectItem key={outlet.id} value={outlet.id}>
                  {outlet.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Platform Filter */}
          <div className="flex items-center gap-3 border rounded-md px-3 py-2">
            <Globe className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Platform:</span>
            {PLATFORMS.map((platform) => (
              <label key={platform.id} className="flex items-center gap-1.5 cursor-pointer">
                <Checkbox
                  checked={selectedPlatforms.includes(platform.id)}
                  onCheckedChange={() => handlePlatformToggle(platform.id)}
                />
                <span className="text-sm">{platform.label}</span>
              </label>
            ))}
          </div>

          <Button onClick={fetchData} disabled={loading} variant="outline">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Refresh
          </Button>
        </div>

        {/* Loading State */}
        {loading && !otaData && (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className={`h-28 rounded-xl bg-gradient-to-r from-muted via-muted/50 to-muted bg-[length:200%_100%] animate-[shimmer_1.5s_ease-in-out_infinite] [animation-delay:${i * 100}ms]`} />
              ))}
            </div>
            <div className="h-[300px] rounded-xl bg-gradient-to-r from-muted via-muted/50 to-muted bg-[length:200%_100%] animate-[shimmer_1.5s_ease-in-out_infinite]" />
          </div>
        )}

        {otaData?.success && (
          <div className="flex flex-col gap-6 animate-in fade-in zoom-in-95 duration-500">
            {/* Metric Cards */}
            <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-4 *:data-[slot=card]:bg-gradient-to-br *:data-[slot=card]:from-blue-50 *:data-[slot=card]:to-indigo-50/50 *:data-[slot=card]:shadow-sm dark:*:data-[slot=card]:from-blue-950/30 dark:*:data-[slot=card]:to-indigo-950/20">
              <Card className="border-0" data-slot="card">
                <CardHeader>
                  <CardDescription className="flex items-center gap-2">
                    <Ticket className="w-4 h-4 text-muted-foreground" />
                    Total Transactions
                  </CardDescription>
                  <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                    {otaData.metrics.total_transactions.toLocaleString('id-ID')}
                  </CardTitle>
                </CardHeader>
                <CardFooter className="text-sm text-muted-foreground">
                  {otaData.metrics.total_qty} tickets sold
                </CardFooter>
              </Card>

              <Card className="border-0" data-slot="card">
                <CardHeader>
                  <CardDescription className="flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-muted-foreground" />
                    Gross Amount (Excl.)
                    <InfoTooltip text="Total gross amount before discount, excluding tax" />
                  </CardDescription>
                  <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                    {formatRpFull(otaData.metrics.total_gross_excl)}
                  </CardTitle>
                </CardHeader>
              </Card>

              <Card className="border-0" data-slot="card">
                <CardHeader>
                  <CardDescription className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-muted-foreground" />
                    Net Sales
                    <InfoTooltip text="Gross Amount - Discount" />
                  </CardDescription>
                  <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                    {formatRpFull(otaData.metrics.total_net_sales)}
                  </CardTitle>
                </CardHeader>
                <CardFooter className="text-sm text-muted-foreground">
                  Discount: {formatRpFull(otaData.metrics.total_discount)}
                </CardFooter>
              </Card>

              <Card className="border-0" data-slot="card">
                <CardHeader>
                  <CardDescription className="flex items-center gap-2">
                    <Plane className="w-4 h-4 text-muted-foreground" />
                    Gross All Incl.
                    <InfoTooltip text="Net Sales + Tax (10%)" />
                  </CardDescription>
                  <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                    {formatRpFull(otaData.metrics.total_gross_all_incl)}
                  </CardTitle>
                </CardHeader>
                <CardFooter className="text-sm text-muted-foreground">
                  Tax: {formatRpFull(otaData.metrics.total_tax)}
                </CardFooter>
              </Card>
            </div>

            {/* Platform Breakdown */}
            {otaData.platform_breakdown && otaData.platform_breakdown.length > 0 && (
              <>
                <Separator />
                <div className="space-y-3">
                  <h3 className="text-base font-semibold flex items-center gap-2">
                    <Globe className="w-4 h-4 text-muted-foreground" />
                    Platform Breakdown
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {otaData.platform_breakdown.map((plat: any) => {
                      const platformConfig = PLATFORMS.find(p => p.label === plat.platform)
                      return (
                        <Card key={plat.platform} className="shadow-sm">
                          <CardHeader className="pb-2">
                            <CardDescription className="flex items-center gap-2">
                              <span className={`w-2 h-2 rounded-full ${platformConfig?.color || 'bg-gray-500'}`} />
                              {plat.platform}
                            </CardDescription>
                            <CardTitle className="text-xl font-semibold tabular-nums">
                              {formatRpFull(plat.gross_all_incl)}
                            </CardTitle>
                          </CardHeader>
                          <CardFooter className="text-sm text-muted-foreground pt-0">
                            {plat.qty} tickets
                          </CardFooter>
                        </Card>
                      )
                    })}
                  </div>
                </div>
              </>
            )}

            {/* Summary Table */}
            {otaData.summary_data && otaData.summary_data.length > 0 && (
              <>
                <Separator />
                <Card className="shadow-sm">
                  <CardHeader>
                    <CardTitle>Summary by Date & Store</CardTitle>
                    <CardDescription>Aggregated OTA sales per day, store, and platform</CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <div className="max-h-[400px] overflow-y-auto">
                        <table className="w-full text-sm">
                          <thead className="sticky top-0 bg-background z-10">
                            <tr className="border-b bg-muted/40">
                              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Date</th>
                              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Store</th>
                              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Platform</th>
                              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Qty</th>
                              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Gross Excl.</th>
                              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Discount</th>
                              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Net Sales</th>
                              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Tax</th>
                              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Gross All Incl.</th>
                            </tr>
                          </thead>
                          <tbody>
                            {otaData.summary_data.map((row: any, i: number) => {
                              const platformConfig = PLATFORMS.find(p => p.label === row.platform)
                              return (
                                <tr key={`${row.date}-${row.store}-${row.platform}`} className={i % 2 === 0 ? '' : 'bg-muted/20'}>
                                  <td className="px-4 py-2.5 font-medium">{row.date}</td>
                                  <td className="px-4 py-2.5">{row.store.replace('OUTLET01-', '').replace('OUTLET02-', '').substring(0, 30)}</td>
                                  <td className="px-4 py-2.5">
                                    <Badge variant="outline" className="text-xs">
                                      <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${platformConfig?.color || 'bg-gray-500'}`} />
                                      {row.platform}
                                    </Badge>
                                  </td>
                                  <td className="px-4 py-2.5 text-right tabular-nums">{row.qty}</td>
                                  <td className="px-4 py-2.5 text-right tabular-nums">{formatRpFull(row.gross_excl)}</td>
                                  <td className="px-4 py-2.5 text-right tabular-nums">{formatRpFull(row.discount)}</td>
                                  <td className="px-4 py-2.5 text-right tabular-nums">{formatRpFull(row.net_sales)}</td>
                                  <td className="px-4 py-2.5 text-right tabular-nums">{formatRpFull(row.tax)}</td>
                                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{formatRpFull(row.gross_all_incl)}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                          <tfoot>
                            <tr className="border-t-2 font-semibold bg-muted/40">
                              <td className="px-4 py-3" colSpan={3}>Total</td>
                              <td className="px-4 py-3 text-right tabular-nums">{otaData.metrics.total_qty}</td>
                              <td className="px-4 py-3 text-right tabular-nums">{formatRpFull(otaData.metrics.total_gross_excl)}</td>
                              <td className="px-4 py-3 text-right tabular-nums">{formatRpFull(otaData.metrics.total_discount)}</td>
                              <td className="px-4 py-3 text-right tabular-nums">{formatRpFull(otaData.metrics.total_net_sales)}</td>
                              <td className="px-4 py-3 text-right tabular-nums">{formatRpFull(otaData.metrics.total_tax)}</td>
                              <td className="px-4 py-3 text-right tabular-nums font-bold">{formatRpFull(otaData.metrics.total_gross_all_incl)}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}

            {/* Detail Table */}
            {otaData.detail_data && otaData.detail_data.length > 0 && (
              <>
                <Separator />
                <Card className="shadow-sm">
                  <CardHeader>
                    <CardTitle>Transaction Details</CardTitle>
                    <CardDescription>All individual OTA transactions ({otaData.detail_data.length} rows)</CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <div className="max-h-[500px] overflow-y-auto">
                        <table className="w-full text-sm">
                          <thead className="sticky top-0 bg-background z-10">
                            <tr className="border-b bg-muted/40">
                              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Date</th>
                              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Store</th>
                              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Platform</th>
                              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Order ID</th>
                              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Item</th>
                              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Qty</th>
                              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Gross Excl.</th>
                              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Discount</th>
                              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Net Sales</th>
                              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Tax</th>
                              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Gross All Incl.</th>
                            </tr>
                          </thead>
                          <tbody>
                            {otaData.detail_data.map((row: any, i: number) => {
                              const platformConfig = PLATFORMS.find(p => p.label === row.platform)
                              return (
                                <tr key={`${row.date}-${row.order_id}-${row.item}-${i}`} className={i % 2 === 0 ? '' : 'bg-muted/20'}>
                                  <td className="px-4 py-2 font-medium">{row.date}</td>
                                  <td className="px-4 py-2 text-xs">{row.store.replace('OUTLET01-', '').replace('OUTLET02-', '').substring(0, 20)}</td>
                                  <td className="px-4 py-2">
                                    <Badge variant="outline" className="text-xs">
                                      <span className={`w-1.5 h-1.5 rounded-full mr-1 ${platformConfig?.color || 'bg-gray-500'}`} />
                                      {row.platform}
                                    </Badge>
                                  </td>
                                  <td className="px-4 py-2 font-mono text-xs">{row.order_id}</td>
                                  <td className="px-4 py-2 text-xs max-w-[200px] truncate" title={row.item}>{row.item}</td>
                                  <td className="px-4 py-2 text-right tabular-nums">{row.qty}</td>
                                  <td className="px-4 py-2 text-right tabular-nums">{formatRpFull(row.gross_excl)}</td>
                                  <td className="px-4 py-2 text-right tabular-nums">{row.discount > 0 ? formatRpFull(row.discount) : '-'}</td>
                                  <td className="px-4 py-2 text-right tabular-nums">{formatRpFull(row.net_sales)}</td>
                                  <td className="px-4 py-2 text-right tabular-nums">{formatRpFull(row.tax)}</td>
                                  <td className="px-4 py-2 text-right tabular-nums font-semibold">{formatRpFull(row.gross_all_incl)}</td>
                                </tr>
                              )
                            })}
                          </tbody>
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
        {!loading && (!otaData?.success || otaData?.metrics?.total_transactions === 0) && (
          <EmptyState
            title="No OTA data available"
            description="No data found for the selected period and filters. Try selecting a different date range or platform."
          />
        )}
      </div>
    </TooltipProvider>
  )
}
