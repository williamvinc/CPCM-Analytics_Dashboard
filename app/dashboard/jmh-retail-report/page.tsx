"use client"

import * as React from "react"
import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { DateRangePicker } from "@/components/ui/date-range-picker"
import { DateRange } from "react-day-picker"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Loader2, Store, ShoppingBag, CreditCard, TrendingUp, Info } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const JMH_OUTLETS = [
  { id: "SNP", label: "SNP (Nickelodeon Spark)" },
  { id: "CPP", label: "CPP (Carstensz Mall)" },
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

export default function JmhRetailReportPage() {
  const today = new Date()
  const prevMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  const prevMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0)

  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: prevMonthStart,
    to: prevMonthEnd,
  })
  const [loading, setLoading] = useState(true)
  const [jmhReconciliation, setJmhReconciliation] = useState<any>(null)
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
      const res = await fetch(`${backendUrl}/api/jmh-reconciliation?start_date=${startDate}&end_date=${endDate}${outletParam}`)

      if (res.ok) {
        const data = await res.json()
        setJmhReconciliation(data)
      }
    } catch (err) {
      console.error("Failed to fetch JMH Retail data:", err)
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
          <div className="h-8 w-1 rounded-full bg-emerald-500" />
          <h1 className="text-2xl font-bold">JMH Retail Report</h1>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-4">
          <DateRangePicker value={dateRange} onChange={setDateRange} className="w-auto" />
          <Select value={selectedOutlet} onValueChange={setSelectedOutlet}>
            <SelectTrigger className="w-[200px]">
              <Store className="mr-2 h-4 w-4" />
              <SelectValue placeholder="Select outlet" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Outlets</SelectItem>
              {JMH_OUTLETS.map((outlet) => (
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
        {loading && !jmhReconciliation && (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-3">
              <div className="h-28 rounded-xl bg-gradient-to-r from-muted via-muted/50 to-muted bg-[length:200%_100%] animate-[shimmer_1.5s_ease-in-out_infinite]" />
              <div className="h-28 rounded-xl bg-gradient-to-r from-muted via-muted/50 to-muted bg-[length:200%_100%] animate-[shimmer_1.5s_ease-in-out_infinite] [animation-delay:100ms]" />
              <div className="h-28 rounded-xl bg-gradient-to-r from-muted via-muted/50 to-muted bg-[length:200%_100%] animate-[shimmer_1.5s_ease-in-out_infinite] [animation-delay:200ms]" />
            </div>
            <div className="h-[300px] rounded-xl bg-gradient-to-r from-muted via-muted/50 to-muted bg-[length:200%_100%] animate-[shimmer_1.5s_ease-in-out_infinite]" />
          </div>
        )}

        {jmhReconciliation?.data && jmhReconciliation.data.length > 0 && (
          <div className="flex flex-col gap-6 animate-in fade-in zoom-in-95 duration-500">
            {/* JMH Metric Cards */}
            <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-3 *:data-[slot=card]:bg-gradient-to-br *:data-[slot=card]:from-emerald-50 *:data-[slot=card]:to-teal-50/50 *:data-[slot=card]:shadow-sm dark:*:data-[slot=card]:from-emerald-950/30 dark:*:data-[slot=card]:to-teal-950/20">
              <Card className="border-0" data-slot="card">
                <CardHeader>
                  <CardDescription className="flex items-center gap-2">
                    <ShoppingBag className="w-4 h-4 text-muted-foreground" />
                    Total POS Retail
                    <InfoTooltip text="SUM(Gross Amount) untuk kategori: 02-Retail" />
                  </CardDescription>
                  <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                    {formatRpFull(jmhReconciliation.totals.pos)}
                  </CardTitle>
                </CardHeader>
                <CardFooter className="text-sm text-muted-foreground">
                  Category: 02-Retail
                </CardFooter>
              </Card>

              <Card className="border-0" data-slot="card">
                <CardHeader>
                  <CardDescription className="flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-muted-foreground" />
                    Total Bank (BCA + BRI + BNI)
                    <InfoTooltip text="SUM(BCA JMH) + SUM(BRI JMH) + SUM(BNI JMH)" />
                  </CardDescription>
                  <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                    {formatRpFull(jmhReconciliation.totals.bank_total)}
                  </CardTitle>
                </CardHeader>
                <CardFooter className="text-sm text-muted-foreground">
                  BCA: {formatRpFull(jmhReconciliation.totals.bca)} | BRI: {formatRpFull(jmhReconciliation.totals.bri)} | BNI: {formatRpFull(jmhReconciliation.totals.bni ?? 0)}
                </CardFooter>
              </Card>

              <Card className="border-0" data-slot="card">
                <CardHeader>
                  <CardDescription className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-muted-foreground" />
                    Difference (Bank - POS)
                    <InfoTooltip text="Total Bank - Total POS" />
                  </CardDescription>
                  <CardTitle className={`text-2xl font-semibold tabular-nums @[250px]/card:text-3xl ${jmhReconciliation.totals.difference < 0 ? 'text-red-500' : ''}`}>
                    {formatRpFull(jmhReconciliation.totals.difference)}
                  </CardTitle>
                </CardHeader>
              </Card>
            </div>

            {/* JMH Reconciliation Table */}
            <Separator />
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle>JMH Retail POS vs Bank</CardTitle>
                <CardDescription>Daily reconciliation BCA JMH + BRI JMH + BNI JMH vs POS Retail</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <div className="max-h-[480px] overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-background z-10">
                        <tr className="border-b bg-muted/40">
                          <th className="px-4 py-3 text-left font-medium text-muted-foreground">Date</th>
                          <th className="px-4 py-3 text-right font-medium text-muted-foreground">POS Retail</th>
                          <th className="px-4 py-3 text-right font-medium text-muted-foreground">BCA JMH</th>
                          <th className="px-4 py-3 text-right font-medium text-muted-foreground">BRI JMH</th>
                          <th className="px-4 py-3 text-right font-medium text-muted-foreground">BNI JMH</th>
                          <th className="px-4 py-3 text-right font-medium text-muted-foreground">Total Bank</th>
                          <th className="px-4 py-3 text-right font-medium text-muted-foreground">Difference</th>
                        </tr>
                      </thead>
                      <tbody>
                        {jmhReconciliation.data.map((row: any, i: number) => (
                          <tr key={row.date} className={i % 2 === 0 ? '' : 'bg-muted/20'}>
                            <td className="px-4 py-2.5 font-medium">{row.date}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{formatRpFull(row.pos)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{formatRpFull(row.bca)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{formatRpFull(row.bri)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{formatRpFull(row.bni)}</td>
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
                          <td className="px-4 py-3 text-right tabular-nums">{formatRpFull(jmhReconciliation.totals.pos)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatRpFull(jmhReconciliation.totals.bca)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatRpFull(jmhReconciliation.totals.bri)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatRpFull(jmhReconciliation.totals.bni ?? 0)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatRpFull(jmhReconciliation.totals.bank_total)}</td>
                          <td className={`px-4 py-3 text-right tabular-nums font-bold ${jmhReconciliation.totals.difference < 0 ? 'text-red-500' : ''}`}>
                            {formatRpFull(jmhReconciliation.totals.difference)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Empty State */}
        {!loading && (!jmhReconciliation?.data || jmhReconciliation.data.length === 0) && (
          <EmptyState
            title="No JMH Retail data available"
            description="No data found for the selected period. Try selecting a different date range."
          />
        )}
      </div>
    </TooltipProvider>
  )
}
