"use client"
import React, { useState, useMemo, useCallback } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { UploadCloud, Download, Wand2, Loader2, Info, ChevronDown, ChevronUp, Gamepad2, Coins, Ticket, Gauge, Hash } from "lucide-react"

// Number formatter
const formatNum = (val: number) => {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`
  return val.toFixed(0)
}
const formatNumFull = (val: number) => val.toLocaleString('id-ID')

interface MachineMetrics {
  total_ticket_out: number
  total_coin_in: number
  overall_rate: number
  unique_machines: number
  total_records: number
}

interface GroupedRow {
  'Machine Name': string
  'Player Side': string
  'Ticket Out': number
  'Coin In': number
  Rate: number
}

interface TransformResult {
  all_data: Record<string, unknown>[]
  grouped_data: GroupedRow[]
  metrics: MachineMetrics
  available_months: string[]
  available_stores: string[]
  chart_top_machines: { 'Machine Name': string; 'Ticket Out': number; 'Coin In': number; Rate: number }[]
  chart_daily: { date: string; 'Ticket Out': number; 'Coin In': number; Rate: number }[]
  file_base64: string
  total_rows: number
}

export default function MachineRateTrackerPage() {
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<TransformResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedMonth, setSelectedMonth] = useState<string>('all')
  const [selectedStore, setSelectedStore] = useState<string>('all')
  const [uploadCollapsed, setUploadCollapsed] = useState(false)
  const [sortColumn, setSortColumn] = useState<'Ticket Out' | 'Coin In' | 'Rate'>('Rate')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'

  const handleTransform = useCallback(async () => {
    if (!file) return
    setLoading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`${BACKEND}/api/transform/machine-rate`, { method: 'POST', body: formData })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Transformation failed')
      }
      const data: TransformResult = await res.json()
      setResult(data)
      setUploadCollapsed(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Transformation failed')
    } finally {
      setLoading(false)
    }
  }, [file, BACKEND])

  const handleDownload = useCallback(() => {
    if (!result?.file_base64) return
    const blob = new Blob(
      [Uint8Array.from(atob(result.file_base64), c => c.charCodeAt(0))],
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'Machine_Rate_Summary.xlsx'
    a.click()
    URL.revokeObjectURL(url)
  }, [result])

  // Filter data by month and store
  const filteredGrouped = useMemo(() => {
    if (!result) return []

    const filtered = result.all_data.filter((r) => {
      const d = String(r['Billing Period'] || '')
      const s = String(r['Store'] || '')
      const matchMonth = selectedMonth === 'all' || d.startsWith(selectedMonth)
      const matchStore = selectedStore === 'all' || s === selectedStore
      return matchMonth && matchStore
    })

    const map = new Map<string, { ticketOut: number; coinIn: number }>()
    filtered.forEach((r) => {
      const key = `${r['Machine Name']}|||${r['Player Side']}`
      const existing = map.get(key) || { ticketOut: 0, coinIn: 0 }
      existing.ticketOut += Number(r['Total ticket out'] || 0)
      existing.coinIn += Number(r['Total Coin Input'] || 0)
      map.set(key, existing)
    })
    const rows: GroupedRow[] = []
    map.forEach((v, k) => {
      const [name, side] = k.split('|||')
      rows.push({
        'Machine Name': name,
        'Player Side': side,
        'Ticket Out': v.ticketOut,
        'Coin In': v.coinIn,
        Rate: v.coinIn > 0 ? Math.round((v.ticketOut / v.coinIn) * 10000) / 10000 : 0,
      })
    })
    return rows
  }, [result, selectedMonth, selectedStore])

  // Sorted grouped data
  const sortedGrouped = useMemo(() => {
    const data = [...filteredGrouped]
    data.sort((a, b) => {
      const aVal = a[sortColumn]
      const bVal = b[sortColumn]
      return sortDir === 'desc' ? bVal - aVal : aVal - bVal
    })
    return data
  }, [filteredGrouped, sortColumn, sortDir])

  // Filtered metrics
  const filteredMetrics = useMemo(() => {
    if (!result) return null
    
    const data = result.all_data.filter((r) => {
      const d = String(r['Billing Period'] || '')
      const s = String(r['Store'] || '')
      const matchMonth = selectedMonth === 'all' || d.startsWith(selectedMonth)
      const matchStore = selectedStore === 'all' || s === selectedStore
      return matchMonth && matchStore
    })
    
    const totalTicketOut = data.reduce((sum, r) => sum + Number(r['Total ticket out'] || 0), 0)
    const totalCoinIn = data.reduce((sum, r) => sum + Number(r['Total Coin Input'] || 0), 0)
    const uniqueMachines = new Set(data.map(r => r['Machine Name'])).size
    return {
      total_ticket_out: totalTicketOut,
      total_coin_in: totalCoinIn,
      overall_rate: totalCoinIn > 0 ? Math.round((totalTicketOut / totalCoinIn) * 10000) / 10000 : 0,
      unique_machines: uniqueMachines,
      total_records: data.length,
    }
  }, [result, selectedMonth, selectedStore])

  // Filtered daily chart
  const filteredDaily = useMemo(() => {
    if (!result) return []

    const data = result.all_data.filter((r) => {
      const d = String(r['Billing Period'] || '')
      const s = String(r['Store'] || '')
      const matchMonth = selectedMonth === 'all' || d.startsWith(selectedMonth)
      const matchStore = selectedStore === 'all' || s === selectedStore
      return matchMonth && matchStore
    })

    const map = new Map<string, { ticketOut: number; coinIn: number }>()
    data.forEach(r => {
      const date = String(r['Billing Period'] || '')
      const existing = map.get(date) || { ticketOut: 0, coinIn: 0 }
      existing.ticketOut += Number(r['Total ticket out'] || 0)
      existing.coinIn += Number(r['Total Coin Input'] || 0)
      map.set(date, existing)
    })

    const rows: { date: string; 'Ticket Out': number; 'Coin In': number; Rate: number }[] = []
    map.forEach((v, k) => {
      rows.push({
        date: k,
        'Ticket Out': v.ticketOut,
        'Coin In': v.coinIn,
        Rate: v.coinIn > 0 ? Math.round((v.ticketOut / v.coinIn) * 10000) / 10000 : 0,
      })
    })
    rows.sort((a, b) => a.date.localeCompare(b.date))
    return rows
  }, [result, selectedMonth, selectedStore])

  // Filtered top machines chart
  const filteredTopMachines = useMemo(() => {
    if (!result) return []

    const data = result.all_data.filter((r) => {
      const d = String(r['Billing Period'] || '')
      const s = String(r['Store'] || '')
      const matchMonth = selectedMonth === 'all' || d.startsWith(selectedMonth)
      const matchStore = selectedStore === 'all' || s === selectedStore
      return matchMonth && matchStore
    })

    const map = new Map<string, { ticketOut: number; coinIn: number }>()
    data.forEach((r) => {
      const name = String(r['Machine Name'] || '')
      const existing = map.get(name) || { ticketOut: 0, coinIn: 0 }
      existing.ticketOut += Number(r['Total ticket out'] || 0)
      existing.coinIn += Number(r['Total Coin Input'] || 0)
      map.set(name, existing)
    })
    const rows: { 'Machine Name': string; 'Ticket Out': number; 'Coin In': number; Rate: number }[] = []
    map.forEach((v, k) => {
      rows.push({
        'Machine Name': k,
        'Ticket Out': v.ticketOut,
        'Coin In': v.coinIn,
        Rate: v.coinIn > 0 ? Math.round((v.ticketOut / v.coinIn) * 10000) / 10000 : 0,
      })
    })
    rows.sort((a, b) => b['Ticket Out'] - a['Ticket Out'])
    return rows.slice(0, 15)
  }, [result, selectedMonth, selectedStore])

  const handleSort = (col: 'Ticket Out' | 'Coin In' | 'Rate') => {
    if (sortColumn === col) {
      setSortDir(sortDir === 'desc' ? 'asc' : 'desc')
    } else {
      setSortColumn(col)
      setSortDir('desc')
    }
  }

  const SortIcon = ({ col }: { col: string }) => {
    if (sortColumn !== col) return null
    return sortDir === 'desc' ? <ChevronDown className="h-3 w-3 inline ml-1" /> : <ChevronUp className="h-3 w-3 inline ml-1" />
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-6 p-6 max-w-[1400px] mx-auto">
        <h1 className="text-2xl font-bold">Machine Rate Tracker</h1>

        {/* Upload Section */}
        <Card>
          <CardHeader className="cursor-pointer" onClick={() => result && setUploadCollapsed(!uploadCollapsed)}>
            <div className="flex items-center justify-between w-full">
              <div>
                <CardTitle>Upload Machine Data</CardTitle>
                <CardDescription>Test</CardDescription>
              </div>
              {result && (uploadCollapsed ? <ChevronDown className="h-5 w-5 text-muted-foreground" /> : <ChevronUp className="h-5 w-5 text-muted-foreground" />)}
            </div>
          </CardHeader>
          {!uploadCollapsed && (
            <CardContent>
              <div className="flex items-end gap-4">
                <div className="flex-1">
                  <Label htmlFor="mrt-file">Excel File (.xlsx)</Label>
                  <Input id="mrt-file" type="file" accept=".xlsx,.xls" onChange={e => setFile(e.target.files?.[0] || null)} className="mt-1.5" />
                </div>
                <Button onClick={handleTransform} disabled={!file || loading}>
                  {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing...</> : <><Wand2 className="mr-2 h-4 w-4" />Transform Data</>}
                </Button>
              </div>
              {error && <p className="text-sm text-destructive mt-2">{error}</p>}
            </CardContent>
          )}
        </Card>

        {/* Results */}
        {result && filteredMetrics && (
          <>
            {/* Filter + Download Row */}
            <div className="flex flex-wrap items-center gap-3">
              <Select value={selectedStore} onValueChange={setSelectedStore}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Filter Store" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Stores</SelectItem>
                  {result.available_stores?.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Filter Month" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Months</SelectItem>
                  {result.available_months.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={handleDownload}><Download className="mr-2 h-4 w-4" />Download XLSX</Button>
            </div>

            {/* Metric Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              {/* Total Ticket Out */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardDescription className="flex items-center gap-1">
                      <Ticket className="h-3.5 w-3.5" /> Total Ticket Out
                      <Tooltip><TooltipTrigger><Info className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                        <TooltipContent>Sum of &quot;Total ticket out&quot; column</TooltipContent></Tooltip>
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent><p className="text-2xl font-bold">{formatNumFull(filteredMetrics.total_ticket_out)}</p></CardContent>
              </Card>
              {/* Total Coin In */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardDescription className="flex items-center gap-1">
                      <Coins className="h-3.5 w-3.5" /> Total Coin In
                      <Tooltip><TooltipTrigger><Info className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                        <TooltipContent>Sum of &quot;Total Coin Input&quot; column</TooltipContent></Tooltip>
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent><p className="text-2xl font-bold">{formatNumFull(filteredMetrics.total_coin_in)}</p></CardContent>
              </Card>
              {/* Overall Rate */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardDescription className="flex items-center gap-1">
                      <Gauge className="h-3.5 w-3.5" /> Overall Rate
                      <Tooltip><TooltipTrigger><Info className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                        <TooltipContent>Total Ticket Out ÷ Total Coin In</TooltipContent></Tooltip>
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent><p className="text-2xl font-bold">{filteredMetrics.overall_rate.toFixed(4)}</p></CardContent>
              </Card>
              {/* Unique Machines */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardDescription className="flex items-center gap-1">
                      <Gamepad2 className="h-3.5 w-3.5" /> Unique Machines
                      <Tooltip><TooltipTrigger><Info className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                        <TooltipContent>Distinct count of Machine Name</TooltipContent></Tooltip>
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent><p className="text-2xl font-bold">{filteredMetrics.unique_machines}</p></CardContent>
              </Card>
              {/* Total Records */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardDescription className="flex items-center gap-1">
                      <Hash className="h-3.5 w-3.5" /> Total Records
                      <Tooltip><TooltipTrigger><Info className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                        <TooltipContent>Total rows in the uploaded file</TooltipContent></Tooltip>
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent><p className="text-2xl font-bold">{formatNumFull(filteredMetrics.total_records)}</p></CardContent>
              </Card>
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Daily Trend Area Chart */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-1">
                    Daily Rate Trend
                    <Tooltip><TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger>
                      <TooltipContent>Daily Rate = Total Ticket Out ÷ Total Coin In per day</TooltipContent></Tooltip>
                  </CardTitle>
                  <CardDescription>Rate over time</CardDescription>
                </CardHeader>
                <CardContent>
                  <ChartContainer
                    config={{ rate: { label: 'Rate', color: 'var(--chart-1)' } }}
                    className="h-[300px] w-full"
                  >
                    <AreaChart data={filteredDaily} margin={{ top: 10, right: 10, bottom: 20, left: 20 }}>
                      <defs>
                        <linearGradient id="rateGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--color-rate)" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="var(--color-rate)" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={60} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Area type="natural" dataKey="Rate" stroke="var(--color-rate)" fill="url(#rateGradient)" strokeWidth={2} />
                    </AreaChart>
                  </ChartContainer>
                </CardContent>
              </Card>

              {/* Daily Coin In + Ticket Out Area Chart */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-1">
                    Daily Volume
                    <Tooltip><TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger>
                      <TooltipContent>Sum of Coin In and Ticket Out per day</TooltipContent></Tooltip>
                  </CardTitle>
                  <CardDescription>Coin In vs Ticket Out</CardDescription>
                </CardHeader>
                <CardContent>
                  <ChartContainer
                    config={{
                      coinIn: { label: 'Coin In', color: 'var(--chart-2)' },
                      ticketOut: { label: 'Ticket Out', color: 'var(--chart-3)' },
                    }}
                    className="h-[300px] w-full"
                  >
                    <AreaChart data={filteredDaily} margin={{ top: 10, right: 10, bottom: 20, left: 20 }}>
                      <defs>
                        <linearGradient id="coinInGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--color-coinIn)" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="var(--color-coinIn)" stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="ticketOutGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--color-ticketOut)" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="var(--color-ticketOut)" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={60} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatNum(v)} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Area type="natural" dataKey="Coin In" stroke="var(--color-coinIn)" fill="url(#coinInGrad)" strokeWidth={2} />
                      <Area type="natural" dataKey="Ticket Out" stroke="var(--color-ticketOut)" fill="url(#ticketOutGrad)" strokeWidth={2} />
                    </AreaChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            </div>

            {/* Top Machines Bar Chart */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1">
                  Top 15 Machines by Ticket Out
                  <Tooltip><TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger>
                    <TooltipContent>Ranked by total Ticket Out, showing Coin In alongside</TooltipContent></Tooltip>
                </CardTitle>
                <CardDescription>Machine performance comparison</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer
                  config={{
                    ticketOut: { label: 'Ticket Out', color: '#ef4444' },
                    coinIn: { label: 'Coin In', color: '#f97316' },
                  }}
                  className="h-[500px] w-full"
                >
                  <BarChart data={filteredTopMachines} margin={{ top: 10, right: 10, bottom: 20, left: 20 }} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tickFormatter={(v) => formatNum(v)} />
                    <YAxis dataKey="Machine Name" type="category" width={180} tick={{ fontSize: 10 }} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="Ticket Out" fill="var(--color-ticketOut)" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="Coin In" fill="var(--color-coinIn)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>

            {/* Grouped Tables by Rate */}
            {[
              { title: "High Rate (> 40)", data: sortedGrouped.filter(r => r.Rate > 40) },
              { title: "Medium Rate (30 - 40)", data: sortedGrouped.filter(r => r.Rate >= 30 && r.Rate <= 40) },
              { title: "Low Rate (< 30)", data: sortedGrouped.filter(r => r.Rate < 30) },
            ].map((section, idx) => (
              <Card key={idx}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-1">
                    {section.title}
                    <Tooltip><TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger>
                      <TooltipContent>Grouped by Machine Name + Player Side. Rate = Ticket Out ÷ Coin In</TooltipContent></Tooltip>
                  </CardTitle>
                  <CardDescription>Click rate col to Sort</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="max-h-[600px] overflow-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="sticky top-0 bg-background">#</TableHead>
                          <TableHead className="sticky top-0 bg-background">Machine Name</TableHead>
                          <TableHead className="sticky top-0 bg-background">Player Side</TableHead>
                          <TableHead className="sticky top-0 bg-background cursor-pointer select-none text-right" onClick={() => handleSort('Ticket Out')}>
                            Ticket Out<SortIcon col="Ticket Out" />
                          </TableHead>
                          <TableHead className="sticky top-0 bg-background cursor-pointer select-none text-right" onClick={() => handleSort('Coin In')}>
                            Coin In<SortIcon col="Coin In" />
                          </TableHead>
                          <TableHead className="sticky top-0 bg-background cursor-pointer select-none text-right" onClick={() => handleSort('Rate')}>
                            Rate<SortIcon col="Rate" />
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {section.data.map((row, i) => (
                          <TableRow key={`${row['Machine Name']}-${row['Player Side']}-${i}`}>
                            <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                            <TableCell className="font-medium">{row['Machine Name']}</TableCell>
                            <TableCell>{row['Player Side']}</TableCell>
                            <TableCell className="text-right">{formatNumFull(row['Ticket Out'])}</TableCell>
                            <TableCell className="text-right">{formatNumFull(row['Coin In'])}</TableCell>
                            <TableCell className="text-right font-mono">{row.Rate.toFixed(4)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">{section.data.length} rows</p>
                </CardContent>
              </Card>
            ))}
          </>
        )}
      </div>
    </TooltipProvider>
  )
}
