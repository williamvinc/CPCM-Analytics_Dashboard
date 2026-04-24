"use client"
import React, { useState, useMemo, useCallback } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis, Legend } from "recharts"
import { UploadCloud, Download, Wand2, Loader2, Info, ChevronDown, ChevronUp, Gamepad2, Coins, Ticket, Gauge, Hash, Filter, AlertTriangle } from "lucide-react"
import { Badge } from "@/components/ui/badge"

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
  'Game Type': string
  'Ticket Out': number
  'Coin In': number
  Rate: number
}

interface CombinedRow {
  'Machine Name': string
  'Game Type': string
  'Ticket Out': number
  'Coin In': number
  Rate: number
}

interface CardRow {
  'Machine Name': string
  'Player Side': string
  'Coin In': number
  'Ticket Out': number
  'Ticket Leak': number
  Rate: number
}

interface CardCombinedRow {
  'Machine Name': string
  'Coin In': number
  'Ticket Out': number
  'Ticket Leak': number
  Rate: number
}

interface TransformResult {
  all_data: Record<string, unknown>[]
  grouped_data: GroupedRow[]
  metrics: MachineMetrics
  available_months: string[]
  available_stores: string[]
  available_game_types: string[]
  has_store_column: boolean
  chart_top_machines: { 'Machine Name': string; 'Ticket Out': number; 'Coin In': number; Rate: number }[]
  chart_daily: { date: string; 'Ticket Out': number; 'Coin In': number; Rate: number }[]
  file_base64: string
  total_rows: number
}

interface CardData {
  'Machine Name': string
  'Player Side': string
  'Ticket Leak': number
}

export default function MachineRateTrackerPage() {
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<TransformResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedMonth, setSelectedMonth] = useState<string>('all')
  const [selectedStore, setSelectedStore] = useState<string>('all')
  const [selectedGameTypes, setSelectedGameTypes] = useState<Set<string>>(new Set())
  const [uploadCollapsed, setUploadCollapsed] = useState(false)
  const [sortColumn, setSortColumn] = useState<'Ticket Out' | 'Coin In' | 'Rate'>('Rate')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [manualStoreName, setManualStoreName] = useState<string>('')
  const [storeConfirmed, setStoreConfirmed] = useState(false)

  // Card file state
  const [cardFile, setCardFile] = useState<File | null>(null)
  const [cardLoading, setCardLoading] = useState(false)
  const [cardError, setCardError] = useState<string | null>(null)
  const [cardData, setCardData] = useState<CardData[] | null>(null)

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
      // Reset manual store name when new file is uploaded
      setManualStoreName('')
      setStoreConfirmed(false)
      // Reset game type filter
      setSelectedGameTypes(new Set())
      // Reset card data
      setCardData(null)
      setCardFile(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Transformation failed')
    } finally {
      setLoading(false)
    }
  }, [file, BACKEND])

  // Upload card file (second Excel)
  const handleCardUpload = useCallback(async () => {
    if (!cardFile) return
    setCardLoading(true)
    setCardError(null)
    try {
      const formData = new FormData()
      formData.append('file', cardFile)
      const res = await fetch(`${BACKEND}/api/transform/machine-rate-card`, { method: 'POST', body: formData })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Card file processing failed')
      }
      const data = await res.json()
      setCardData(data.card_data)
    } catch (e: unknown) {
      setCardError(e instanceof Error ? e.message : 'Card file processing failed')
    } finally {
      setCardLoading(false)
    }
  }, [cardFile, BACKEND])

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

  // Determine the header title
  const headerTitle = useMemo(() => {
    if (result && !result.has_store_column && manualStoreName.trim()) {
      return `Machine Rate Tracker for ${manualStoreName.trim()}`
    }
    if (result && result.has_store_column && selectedStore !== 'all') {
      return `Machine Rate Tracker for ${selectedStore}`
    }
    return 'Machine Rate Tracker'
  }, [result, manualStoreName, selectedStore])

  // Game type filter helper
  const gameTypeFilterActive = selectedGameTypes.size > 0
  const matchGameType = (g: string) => !gameTypeFilterActive || selectedGameTypes.has(g)

  const toggleGameType = (gt: string) => {
    setSelectedGameTypes(prev => {
      const next = new Set(prev)
      if (next.has(gt)) next.delete(gt)
      else next.add(gt)
      return next
    })
  }

  // Filter data by month, store, and game type
  const filteredGrouped = useMemo(() => {
    if (!result) return []

    const filtered = result.all_data.filter((r) => {
      const d = String(r['Billing Period'] || '')
      const s = String(r['Store'] || '')
      const g = String(r['Game Type'] || '')
      const matchMonth = selectedMonth === 'all' || d.startsWith(selectedMonth)
      const matchStore = selectedStore === 'all' || s === selectedStore
      return matchMonth && matchStore && matchGameType(g)
    })

    const map = new Map<string, { ticketOut: number; coinIn: number; gameType: string }>()
    filtered.forEach((r) => {
      const key = `${r['Machine Name']}|||${r['Player Side']}`
      const existing = map.get(key) || { ticketOut: 0, coinIn: 0, gameType: String(r['Game Type'] || '') }
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
        'Game Type': v.gameType,
        'Ticket Out': v.ticketOut,
        'Coin In': v.coinIn,
        Rate: v.coinIn > 0 ? Math.round((v.ticketOut / v.coinIn) * 10000) / 10000 : 0,
      })
    })
    return rows
  }, [result, selectedMonth, selectedStore, selectedGameTypes])

  // Combined player data (grouped by Machine Name only, no Player Side)
  const combinedGrouped = useMemo(() => {
    if (!result) return []

    const filtered = result.all_data.filter((r) => {
      const d = String(r['Billing Period'] || '')
      const s = String(r['Store'] || '')
      const g = String(r['Game Type'] || '')
      const matchMonth = selectedMonth === 'all' || d.startsWith(selectedMonth)
      const matchStore = selectedStore === 'all' || s === selectedStore
      return matchMonth && matchStore && matchGameType(g)
    })

    const map = new Map<string, { ticketOut: number; coinIn: number; gameType: string }>()
    filtered.forEach((r) => {
      const key = String(r['Machine Name'] || '')
      const existing = map.get(key) || { ticketOut: 0, coinIn: 0, gameType: String(r['Game Type'] || '') }
      existing.ticketOut += Number(r['Total ticket out'] || 0)
      existing.coinIn += Number(r['Total Coin Input'] || 0)
      map.set(key, existing)
    })
    const rows: CombinedRow[] = []
    map.forEach((v, k) => {
      rows.push({
        'Machine Name': k,
        'Game Type': v.gameType,
        'Ticket Out': v.ticketOut,
        'Coin In': v.coinIn,
        Rate: v.coinIn > 0 ? Math.round((v.ticketOut / v.coinIn) * 10000) / 10000 : 0,
      })
    })
    return rows
  }, [result, selectedMonth, selectedStore, selectedGameTypes])

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

  // Sorted combined data
  const sortedCombined = useMemo(() => {
    const data = [...combinedGrouped]
    data.sort((a, b) => {
      const aVal = a[sortColumn]
      const bVal = b[sortColumn]
      return sortDir === 'desc' ? bVal - aVal : aVal - bVal
    })
    return data
  }, [combinedGrouped, sortColumn, sortDir])

  // ==========================================
  // CARD DATA: Right join Excel2 with Excel1
  // ==========================================
  const cardJoinedData = useMemo((): CardRow[] => {
    if (!cardData || !result) return []

    // Aggregate Excel1 data by Machine Name (sum across all player sides and dates)
    const filtered = result.all_data.filter((r) => {
      const d = String(r['Billing Period'] || '')
      const s = String(r['Store'] || '')
      const g = String(r['Game Type'] || '')
      const mMonth = selectedMonth === 'all' || d.startsWith(selectedMonth)
      const mStore = selectedStore === 'all' || s === selectedStore
      return mMonth && mStore && matchGameType(g)
    })

    const excel1Map = new Map<string, { ticketOut: number; coinIn: number }>()
    filtered.forEach((r) => {
      const name = String(r['Machine Name'] || '').trim()
      if (!name) return
      const existing = excel1Map.get(name) || { ticketOut: 0, coinIn: 0 }
      existing.ticketOut += Number(r['Total ticket out'] || 0)
      existing.coinIn += Number(r['Total Coin Input'] || 0)
      excel1Map.set(name, existing)
    })

    // Right join: baseline is Excel2 (card_data)
    const rows: CardRow[] = cardData.map((card) => {
      const machineName = String(card['Machine Name'] || '').trim()
      const playerSide = String(card['Player Side'] || '').trim()
      const ticketLeak = Number(card['Ticket Leak'] || 0)

      const excel1 = excel1Map.get(machineName) || { ticketOut: 0, coinIn: 0 }

      const rate = excel1.coinIn > 0 ? Math.round(((excel1.ticketOut + ticketLeak) / excel1.coinIn) * 10000) / 10000 : 0

      return {
        'Machine Name': machineName,
        'Player Side': playerSide,
        'Coin In': excel1.coinIn,
        'Ticket Out': excel1.ticketOut,
        'Ticket Leak': ticketLeak,
        Rate: rate,
      }
    })

    return rows
  }, [cardData, result, selectedMonth, selectedStore, selectedGameTypes])

  // Card combined data (grouped by Machine Name only)
  const cardCombinedData = useMemo((): CardCombinedRow[] => {
    if (!cardJoinedData.length) return []

    const map = new Map<string, { coinIn: number; ticketOut: number; ticketLeak: number }>()
    cardJoinedData.forEach((r) => {
      const existing = map.get(r['Machine Name']) || { coinIn: 0, ticketOut: 0, ticketLeak: 0 }
      existing.coinIn = r['Coin In'] // same per machine since Excel1 is aggregated by machine name
      existing.ticketOut = r['Ticket Out']
      existing.ticketLeak += r['Ticket Leak']
      map.set(r['Machine Name'], existing)
    })

    const rows: CardCombinedRow[] = []
    map.forEach((v, k) => {
      const rate = v.coinIn > 0 ? Math.round(((v.ticketOut + v.ticketLeak) / v.coinIn) * 10000) / 10000 : 0
      rows.push({
        'Machine Name': k,
        'Coin In': v.coinIn,
        'Ticket Out': v.ticketOut,
        'Ticket Leak': v.ticketLeak,
        Rate: rate,
      })
    })
    return rows
  }, [cardJoinedData])

  // Sort card data
  const sortedCardData = useMemo(() => {
    const data = [...cardJoinedData]
    data.sort((a, b) => {
      const aVal = a[sortColumn] ?? 0
      const bVal = b[sortColumn] ?? 0
      return sortDir === 'desc' ? bVal - aVal : aVal - bVal
    })
    return data
  }, [cardJoinedData, sortColumn, sortDir])

  const sortedCardCombined = useMemo(() => {
    const data = [...cardCombinedData]
    data.sort((a, b) => {
      const aVal = a[sortColumn] ?? 0
      const bVal = b[sortColumn] ?? 0
      return sortDir === 'desc' ? bVal - aVal : aVal - bVal
    })
    return data
  }, [cardCombinedData, sortColumn, sortDir])

  // ==========================================
  // URGENT MACHINES: Top 15 highest rate machines from both sources
  // ==========================================
  const urgentMachines = useMemo(() => {
    interface UrgentRow {
      'Machine Name': string
      'Player Side'?: string
      'Game Type': string
      'Rate (Game)': number
      'Rate (Card)': number
      'Max Rate': number
      source: 'game' | 'card' | 'both'
    }

    // 1) Combined Grouped
    const combinedMap = new Map<string, UrgentRow>()
    combinedGrouped.forEach((r) => {
      const name = r['Machine Name']
      combinedMap.set(name, {
        'Machine Name': name,
        'Game Type': r['Game Type'],
        'Rate (Game)': r.Rate,
        'Rate (Card)': 0,
        'Max Rate': r.Rate,
        source: 'game',
      })
    })
    cardCombinedData.forEach((r) => {
      const name = r['Machine Name']
      const existing = combinedMap.get(name)
      if (existing) {
        existing['Rate (Card)'] = r.Rate
        existing['Max Rate'] = Math.max(existing['Max Rate'], r.Rate)
        if (existing.source === 'game') existing.source = 'both'
      } else {
        combinedMap.set(name, {
          'Machine Name': name,
          'Game Type': '',
          'Rate (Game)': 0,
          'Rate (Card)': r.Rate,
          'Max Rate': r.Rate,
          source: 'card',
        })
      }
    })
    const combined = Array.from(combinedMap.values()).sort((a, b) => b['Max Rate'] - a['Max Rate']).slice(0, 15)

    // 2) Player Side Grouped
    const playerSideMap = new Map<string, UrgentRow>()
    filteredGrouped.forEach((r) => {
      const key = `${r['Machine Name']}|||${r['Player Side']}`
      playerSideMap.set(key, {
        'Machine Name': r['Machine Name'],
        'Player Side': r['Player Side'],
        'Game Type': r['Game Type'],
        'Rate (Game)': r.Rate,
        'Rate (Card)': 0,
        'Max Rate': r.Rate,
        source: 'game',
      })
    })
    cardJoinedData.forEach((r) => {
      const key = `${r['Machine Name']}|||${r['Player Side']}`
      const existing = playerSideMap.get(key)
      if (existing) {
        existing['Rate (Card)'] = r.Rate
        existing['Max Rate'] = Math.max(existing['Max Rate'], r.Rate)
        if (existing.source === 'game') existing.source = 'both'
      } else {
        playerSideMap.set(key, {
          'Machine Name': r['Machine Name'],
          'Player Side': r['Player Side'],
          'Game Type': '',
          'Rate (Game)': 0,
          'Rate (Card)': r.Rate,
          'Max Rate': r.Rate,
          source: 'card',
        })
      }
    })
    const playerSide = Array.from(playerSideMap.values()).sort((a, b) => b['Max Rate'] - a['Max Rate']).slice(0, 15)

    return { combined, playerSide }
  }, [combinedGrouped, cardCombinedData, filteredGrouped, cardJoinedData])

  // Filtered metrics
  const filteredMetrics = useMemo(() => {
    if (!result) return null
    
    const data = result.all_data.filter((r) => {
      const d = String(r['Billing Period'] || '')
      const s = String(r['Store'] || '')
      const g = String(r['Game Type'] || '')
      const mMonth = selectedMonth === 'all' || d.startsWith(selectedMonth)
      const mStore = selectedStore === 'all' || s === selectedStore
      return mMonth && mStore && matchGameType(g)
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
  }, [result, selectedMonth, selectedStore, selectedGameTypes])

  // Filtered daily chart
  const filteredDaily = useMemo(() => {
    if (!result) return []

    const data = result.all_data.filter((r) => {
      const d = String(r['Billing Period'] || '')
      const s = String(r['Store'] || '')
      const g = String(r['Game Type'] || '')
      const mMonth = selectedMonth === 'all' || d.startsWith(selectedMonth)
      const mStore = selectedStore === 'all' || s === selectedStore
      return mMonth && mStore && matchGameType(g)
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
  }, [result, selectedMonth, selectedStore, selectedGameTypes])

  // Filtered top machines chart
  const filteredTopMachines = useMemo(() => {
    if (!result) return []

    const data = result.all_data.filter((r) => {
      const d = String(r['Billing Period'] || '')
      const s = String(r['Store'] || '')
      const g = String(r['Game Type'] || '')
      const mMonth = selectedMonth === 'all' || d.startsWith(selectedMonth)
      const mStore = selectedStore === 'all' || s === selectedStore
      return mMonth && mStore && matchGameType(g)
    })

    const map = new Map<string, { ticketOut: number; coinIn: number }>()
    data.forEach((r) => {
      const name = String(r['Machine Name'] || '').trim()
      if (!name) return
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
  }, [result, selectedMonth, selectedStore, selectedGameTypes])

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

  // Custom tooltip for bar chart that includes Rate
  const CustomBarTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string; payload: Record<string, unknown> }>; label?: string }) => {
    if (!active || !payload || payload.length === 0) return null
    return (
      <div className="rounded-lg border bg-background p-2.5 shadow-xl text-sm">
        <p className="font-medium mb-1.5">{label}</p>
        {payload.map((entry, idx) => (
          <div key={idx} className="flex items-center gap-2 mt-0.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
            <span className="text-muted-foreground">{entry.name}:</span>
            <span className="font-medium">{entry.name === 'Rate' ? Number(entry.value).toFixed(4) : formatNumFull(entry.value)}</span>
          </div>
        ))}
      </div>
    )
  }

  // Game type filter label
  const gameTypeLabel = selectedGameTypes.size === 0
    ? 'All Game Types'
    : selectedGameTypes.size === 1
      ? [...selectedGameTypes][0]
      : `${selectedGameTypes.size} Game Types`

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-6 p-6 max-w-[1400px] mx-auto">
        <h1 className="text-2xl font-bold">{headerTitle}</h1>

        {/* Upload Section */}
        <Card>
          <CardHeader className="cursor-pointer" onClick={() => result && setUploadCollapsed(!uploadCollapsed)}>
            <div className="flex items-center justify-between w-full">
              <div>
                <CardTitle>Upload Machine Data</CardTitle>
                <CardDescription>Upload your Excel file with machine rate data</CardDescription>
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

        {/* Store Name Input - shown when Store column is missing and not yet confirmed */}
        {result && !result.has_store_column && !storeConfirmed && (
          <Card className="border-amber-500/50 bg-amber-500/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Info className="h-4 w-4 text-amber-500" />
                Store Information Required
              </CardTitle>
              <CardDescription>Please specify the store name.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-3">
                <div className="flex-1 max-w-sm">
                  <Label htmlFor="store-name">For what store?</Label>
                  <Input
                    id="store-name"
                    placeholder="e.g. Cartenz..."
                    value={manualStoreName}
                    onChange={e => setManualStoreName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && manualStoreName.trim()) {
                        setStoreConfirmed(true)
                      }
                    }}
                    className="mt-1.5"
                  />
                </div>
                <Button
                  size="sm"
                  onClick={() => { if (manualStoreName.trim()) setStoreConfirmed(true) }}
                  disabled={!manualStoreName.trim()}
                >
                  Confirm
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Results */}
        {result && filteredMetrics && (
          <>
            {/* Filter + Download Row */}
            <div className="flex flex-wrap items-center gap-3">
              {result.has_store_column && (
                <Select value={selectedStore} onValueChange={setSelectedStore}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Filter Store" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Stores</SelectItem>
                    {result.available_stores?.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Filter Month" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Months</SelectItem>
                  {result.available_months.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
              {result.available_game_types.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="w-[200px] justify-between">
                      <span className="flex items-center gap-1.5 truncate">
                        <Filter className="h-3.5 w-3.5 shrink-0" />
                        {gameTypeLabel}
                      </span>
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-[200px]">
                    <DropdownMenuLabel>Game Types</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuCheckboxItem
                      checked={selectedGameTypes.size === 0}
                      onCheckedChange={() => setSelectedGameTypes(new Set())}
                    >
                      All Game Types
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuSeparator />
                    {result.available_game_types.map(g => (
                      <DropdownMenuCheckboxItem
                        key={g}
                        checked={selectedGameTypes.has(g)}
                        onCheckedChange={() => toggleGameType(g)}
                      >
                        {g}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
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

            {/* Machines Urgently Need Attention */}
            <Card className="border-red-500/30">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-red-500" />
                  Machines Urgently Need Attention
                  <Tooltip><TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger>
                    <TooltipContent>Top 15 machines with highest rates across Ticket Game and Ticket Machine &amp; Card. High rate may indicate a machine needs inspection.</TooltipContent></Tooltip>
                </CardTitle>
                <CardDescription>Top 15 highest-rate machines from both data sources — combined player view</CardDescription>
              </CardHeader>
              <CardContent>
                {(urgentMachines.combined.length > 0) ? (
                  <Tabs defaultValue="combined" className="w-full">
                    <TabsList className="mb-2">
                      <TabsTrigger value="combined">Combined Player</TabsTrigger>
                      <TabsTrigger value="detail">By Player Side</TabsTrigger>
                    </TabsList>
                    
                    {/* Combined View */}
                    <TabsContent value="combined">
                      <div className="max-h-[500px] overflow-auto rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="sticky top-0 bg-background">#</TableHead>
                              <TableHead className="sticky top-0 bg-background">Machine Name</TableHead>
                              <TableHead className="sticky top-0 bg-background">Game Type</TableHead>
                              <TableHead className="sticky top-0 bg-background text-right">Rate (Game)</TableHead>
                              <TableHead className="sticky top-0 bg-background text-right">Rate (Card)</TableHead>
                              <TableHead className="sticky top-0 bg-background text-right">Max Rate</TableHead>
                              <TableHead className="sticky top-0 bg-background text-center">Source</TableHead>
                              <TableHead className="sticky top-0 bg-background text-center">Severity</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {urgentMachines.combined.map((row, i) => (
                              <TableRow key={`urgent-combined-${row['Machine Name']}-${i}`} className={row['Max Rate'] > 55 ? 'bg-red-500/5' : row['Max Rate'] > 40 ? 'bg-amber-500/5' : ''}>
                                <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                                <TableCell className="font-medium">{row['Machine Name']}</TableCell>
                                <TableCell>{row['Game Type'] || '—'}</TableCell>
                                <TableCell className="text-right font-mono">{row['Rate (Game)'] > 0 ? row['Rate (Game)'].toFixed(4) : '—'}</TableCell>
                                <TableCell className="text-right font-mono">{row['Rate (Card)'] > 0 ? row['Rate (Card)'].toFixed(4) : '—'}</TableCell>
                                <TableCell className="text-right font-mono font-bold">{row['Max Rate'].toFixed(4)}</TableCell>
                                <TableCell className="text-center">
                                  <Badge variant={row.source === 'both' ? 'default' : 'outline'} className="text-[10px] px-1.5">
                                    {row.source === 'both' ? 'Both' : row.source === 'game' ? 'Game' : 'Card'}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-center">
                                  {row['Max Rate'] > 55 ? (
                                    <Badge className="bg-red-500 hover:bg-red-600 text-white text-[10px] px-1.5">Critical</Badge>
                                  ) : row['Max Rate'] > 40 ? (
                                    <Badge className="bg-amber-500 hover:bg-amber-600 text-white text-[10px] px-1.5">High</Badge>
                                  ) : row['Max Rate'] > 30 ? (
                                    <Badge className="bg-yellow-500 hover:bg-yellow-600 text-white text-[10px] px-1.5">Medium</Badge>
                                  ) : (
                                    <Badge variant="outline" className="text-[10px] px-1.5">Normal</Badge>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </TabsContent>

                    {/* Detail View */}
                    <TabsContent value="detail">
                      <div className="max-h-[500px] overflow-auto rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="sticky top-0 bg-background">#</TableHead>
                              <TableHead className="sticky top-0 bg-background">Machine Name</TableHead>
                              <TableHead className="sticky top-0 bg-background">Player Side</TableHead>
                              <TableHead className="sticky top-0 bg-background text-right">Rate (Game)</TableHead>
                              <TableHead className="sticky top-0 bg-background text-right">Rate (Card)</TableHead>
                              <TableHead className="sticky top-0 bg-background text-right">Max Rate</TableHead>
                              <TableHead className="sticky top-0 bg-background text-center">Source</TableHead>
                              <TableHead className="sticky top-0 bg-background text-center">Severity</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {urgentMachines.playerSide.map((row, i) => (
                              <TableRow key={`urgent-detail-${row['Machine Name']}-${row['Player Side']}-${i}`} className={row['Max Rate'] > 55 ? 'bg-red-500/5' : row['Max Rate'] > 40 ? 'bg-amber-500/5' : ''}>
                                <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                                <TableCell className="font-medium">{row['Machine Name']}</TableCell>
                                <TableCell>{row['Player Side'] || '—'}</TableCell>
                                <TableCell className="text-right font-mono">{row['Rate (Game)'] > 0 ? row['Rate (Game)'].toFixed(4) : '—'}</TableCell>
                                <TableCell className="text-right font-mono">{row['Rate (Card)'] > 0 ? row['Rate (Card)'].toFixed(4) : '—'}</TableCell>
                                <TableCell className="text-right font-mono font-bold">{row['Max Rate'].toFixed(4)}</TableCell>
                                <TableCell className="text-center">
                                  <Badge variant={row.source === 'both' ? 'default' : 'outline'} className="text-[10px] px-1.5">
                                    {row.source === 'both' ? 'Both' : row.source === 'game' ? 'Game' : 'Card'}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-center">
                                  {row['Max Rate'] > 55 ? (
                                    <Badge className="bg-red-500 hover:bg-red-600 text-white text-[10px] px-1.5">Critical</Badge>
                                  ) : row['Max Rate'] > 40 ? (
                                    <Badge className="bg-amber-500 hover:bg-amber-600 text-white text-[10px] px-1.5">High</Badge>
                                  ) : row['Max Rate'] > 30 ? (
                                    <Badge className="bg-yellow-500 hover:bg-yellow-600 text-white text-[10px] px-1.5">Medium</Badge>
                                  ) : (
                                    <Badge variant="outline" className="text-[10px] px-1.5">Normal</Badge>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </TabsContent>
                  </Tabs>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">Upload data to see machines that need attention</p>
                )}
              </CardContent>
            </Card>

            {/* Top Machines Bar Chart */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1">
                  Top 15 Machines by Ticket Out
                  <Tooltip><TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger>
                    <TooltipContent>Ranked by total Ticket Out, Coin In, and Rate</TooltipContent></Tooltip>
                </CardTitle>
                <CardDescription>Machine performance comparison — Rate shown on secondary axis (blue)</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer
                  config={{
                    ticketOut: { label: 'Ticket Out', color: '#ef4444' },
                    coinIn: { label: 'Coin In', color: '#f97316' },
                    rate: { label: 'Rate', color: '#3b82f6' },
                  }}
                  className="h-[500px] w-full"
                >
                  <BarChart data={filteredTopMachines} margin={{ top: 10, right: 20, bottom: 20, left: 20 }} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis xAxisId="volume" type="number" tickFormatter={(v) => formatNum(v)} orientation="bottom" />
                    <XAxis xAxisId="rate" type="number" orientation="top" tickFormatter={(v) => `${v}`} label={{ value: 'Rate', position: 'insideTopRight', fontSize: 10, fill: '#3b82f6' }} />
                    <YAxis dataKey="Machine Name" type="category" width={180} tick={{ fontSize: 10 }} />
                    <ChartTooltip content={<CustomBarTooltip />} />
                    <Legend verticalAlign="top" wrapperStyle={{ paddingBottom: '10px' }} />
                    <Bar xAxisId="volume" dataKey="Ticket Out" fill="var(--color-ticketOut)" radius={[0, 4, 4, 0]} />
                    <Bar xAxisId="volume" dataKey="Coin In" fill="var(--color-coinIn)" radius={[0, 4, 4, 0]} />
                    <Bar xAxisId="rate" dataKey="Rate" fill="var(--color-rate)" radius={[0, 4, 4, 0]}>
                      <LabelList
                        dataKey="Rate"
                        position="right"
                        formatter={((v: unknown) => v != null ? Number(v).toFixed(2) : '') as never}
                        className="fill-muted-foreground text-[10px]"
                      />
                    </Bar>
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>

            {/* Outer Tabs: Ticket Game vs Ticket Machine */}
            <Tabs defaultValue="ticket-game" className="w-full">
              <TabsList className="mb-4">
                <TabsTrigger value="ticket-game">Ticket Game (No Card)</TabsTrigger>
                <TabsTrigger value="ticket-machine">Ticket Machine &amp; Card</TabsTrigger>
              </TabsList>

              {/* Tab 1: Ticket Game (No Card) */}
              <TabsContent value="ticket-game" className="flex flex-col gap-4">
                {[
                  { title: "High Rate (> 40)", data: sortedGrouped.filter(r => r.Rate > 40), combinedData: sortedCombined.filter(r => r.Rate > 40) },
                  { title: "Medium Rate (30 - 40)", data: sortedGrouped.filter(r => r.Rate >= 30 && r.Rate <= 40), combinedData: sortedCombined.filter(r => r.Rate >= 30 && r.Rate <= 40) },
                  { title: "Low Rate (< 30)", data: sortedGrouped.filter(r => r.Rate < 30), combinedData: sortedCombined.filter(r => r.Rate < 30) },
                ].map((section, idx) => (
                  <Card key={idx}>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-1">
                        {section.title}
                        <Tooltip><TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger>
                          <TooltipContent>Grouped by Machine Name + Player Side. Rate = Ticket Out ÷ Coin In</TooltipContent></Tooltip>
                      </CardTitle>
                      <CardDescription>Click column header to sort</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Tabs defaultValue="detail" className="w-full">
                        <TabsList>
                          <TabsTrigger value="detail">By Player Side</TabsTrigger>
                          <TabsTrigger value="combined">Combined Player</TabsTrigger>
                        </TabsList>
                        <TabsContent value="detail">
                          <div className="max-h-[600px] overflow-auto rounded-md border">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="sticky top-0 bg-background">#</TableHead>
                                  <TableHead className="sticky top-0 bg-background">Machine Name</TableHead>
                                  <TableHead className="sticky top-0 bg-background">Player Side</TableHead>
                                  <TableHead className="sticky top-0 bg-background">Game Type</TableHead>
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
                                    <TableCell>{row['Game Type']}</TableCell>
                                    <TableCell className="text-right">{formatNumFull(row['Ticket Out'])}</TableCell>
                                    <TableCell className="text-right">{formatNumFull(row['Coin In'])}</TableCell>
                                    <TableCell className="text-right font-mono">{row.Rate.toFixed(4)}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                          <p className="text-xs text-muted-foreground mt-2">{section.data.length} rows</p>
                        </TabsContent>
                        <TabsContent value="combined">
                          <div className="max-h-[600px] overflow-auto rounded-md border">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="sticky top-0 bg-background">#</TableHead>
                                  <TableHead className="sticky top-0 bg-background">Machine Name</TableHead>
                                  <TableHead className="sticky top-0 bg-background">Game Type</TableHead>
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
                                {section.combinedData.map((row, i) => (
                                  <TableRow key={`combined-${row['Machine Name']}-${i}`}>
                                    <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                                    <TableCell className="font-medium">{row['Machine Name']}</TableCell>
                                    <TableCell>{row['Game Type']}</TableCell>
                                    <TableCell className="text-right">{formatNumFull(row['Ticket Out'])}</TableCell>
                                    <TableCell className="text-right">{formatNumFull(row['Coin In'])}</TableCell>
                                    <TableCell className="text-right font-mono">{row.Rate.toFixed(4)}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                          <p className="text-xs text-muted-foreground mt-2">{section.combinedData.length} rows</p>
                        </TabsContent>
                      </Tabs>
                    </CardContent>
                  </Card>
                ))}
              </TabsContent>

              {/* Tab 2: Ticket Machine & Card */}
              <TabsContent value="ticket-machine" className="flex flex-col gap-4">
                {/* Upload second Excel file */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Upload Card Data</CardTitle>
                    <CardDescription>Upload Excel with Machine Name, Player Side, Ticket Leak (no header required)</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-end gap-4">
                      <div className="flex-1 max-w-md">
                        <Label htmlFor="card-file">Card Excel File (.xlsx)</Label>
                        <Input id="card-file" type="file" accept=".xlsx,.xls" onChange={e => setCardFile(e.target.files?.[0] || null)} className="mt-1.5" />
                      </div>
                      <Button onClick={handleCardUpload} disabled={!cardFile || cardLoading} size="sm">
                        {cardLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing...</> : <><UploadCloud className="mr-2 h-4 w-4" />Upload &amp; Join</>}
                      </Button>
                    </div>
                    {cardError && <p className="text-sm text-destructive mt-2">{cardError}</p>}
                    {cardData && <p className="text-sm text-green-600 mt-2">✓ Card data loaded ({cardData.length} rows). Joined with main data below.</p>}
                  </CardContent>
                </Card>

                {/* Card rate tables */}
                {cardData ? (
                  [
                    { title: "High Rate (> 55)", data: sortedCardData.filter(r => r.Rate > 55), combinedData: sortedCardCombined.filter(r => r.Rate > 55) },
                    { title: "Medium Rate (30 - 40)", data: sortedCardData.filter(r => r.Rate >= 30 && r.Rate <= 40), combinedData: sortedCardCombined.filter(r => r.Rate >= 30 && r.Rate <= 40) },
                    { title: "Low Rate (< 30)", data: sortedCardData.filter(r => r.Rate < 30), combinedData: sortedCardCombined.filter(r => r.Rate < 30) },
                  ].map((section, idx) => (
                    <Card key={`card-${idx}`}>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-1">
                          {section.title}
                          <Tooltip><TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger>
                            <TooltipContent>Rate = (Ticket Out + Ticket Leak) ÷ Coin In. Right-joined from card data.</TooltipContent></Tooltip>
                        </CardTitle>
                        <CardDescription>Click column header to sort</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <Tabs defaultValue="detail" className="w-full">
                          <TabsList>
                            <TabsTrigger value="detail">By Player Side</TabsTrigger>
                            <TabsTrigger value="combined">Combined Player</TabsTrigger>
                          </TabsList>
                          <TabsContent value="detail">
                            <div className="max-h-[600px] overflow-auto rounded-md border">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="sticky top-0 bg-background">#</TableHead>
                                    <TableHead className="sticky top-0 bg-background">Machine Name</TableHead>
                                    <TableHead className="sticky top-0 bg-background">Player Side</TableHead>
                                    <TableHead className="sticky top-0 bg-background cursor-pointer select-none text-right" onClick={() => handleSort('Coin In')}>
                                      Coin In<SortIcon col="Coin In" />
                                    </TableHead>
                                    <TableHead className="sticky top-0 bg-background cursor-pointer select-none text-right" onClick={() => handleSort('Ticket Out')}>
                                      Ticket Out<SortIcon col="Ticket Out" />
                                    </TableHead>
                                    <TableHead className="sticky top-0 bg-background text-right">Ticket Leak</TableHead>
                                    <TableHead className="sticky top-0 bg-background cursor-pointer select-none text-right" onClick={() => handleSort('Rate')}>
                                      Rate<SortIcon col="Rate" />
                                    </TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {section.data.map((row, i) => (
                                    <TableRow key={`card-detail-${row['Machine Name']}-${row['Player Side']}-${i}`}>
                                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                                      <TableCell className="font-medium">{row['Machine Name']}</TableCell>
                                      <TableCell>{row['Player Side']}</TableCell>
                                      <TableCell className="text-right">{formatNumFull(row['Coin In'])}</TableCell>
                                      <TableCell className="text-right">{formatNumFull(row['Ticket Out'])}</TableCell>
                                      <TableCell className="text-right">{formatNumFull(row['Ticket Leak'])}</TableCell>
                                      <TableCell className="text-right font-mono">{row.Rate.toFixed(4)}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                            <p className="text-xs text-muted-foreground mt-2">{section.data.length} rows</p>
                          </TabsContent>
                          <TabsContent value="combined">
                            <div className="max-h-[600px] overflow-auto rounded-md border">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="sticky top-0 bg-background">#</TableHead>
                                    <TableHead className="sticky top-0 bg-background">Machine Name</TableHead>
                                    <TableHead className="sticky top-0 bg-background cursor-pointer select-none text-right" onClick={() => handleSort('Coin In')}>
                                      Coin In<SortIcon col="Coin In" />
                                    </TableHead>
                                    <TableHead className="sticky top-0 bg-background cursor-pointer select-none text-right" onClick={() => handleSort('Ticket Out')}>
                                      Ticket Out<SortIcon col="Ticket Out" />
                                    </TableHead>
                                    <TableHead className="sticky top-0 bg-background text-right">Ticket Leak</TableHead>
                                    <TableHead className="sticky top-0 bg-background cursor-pointer select-none text-right" onClick={() => handleSort('Rate')}>
                                      Rate<SortIcon col="Rate" />
                                    </TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {section.combinedData.map((row, i) => (
                                    <TableRow key={`card-combined-${row['Machine Name']}-${i}`}>
                                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                                      <TableCell className="font-medium">{row['Machine Name']}</TableCell>
                                      <TableCell className="text-right">{formatNumFull(row['Coin In'])}</TableCell>
                                      <TableCell className="text-right">{formatNumFull(row['Ticket Out'])}</TableCell>
                                      <TableCell className="text-right">{formatNumFull(row['Ticket Leak'])}</TableCell>
                                      <TableCell className="text-right font-mono">{row.Rate.toFixed(4)}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                            <p className="text-xs text-muted-foreground mt-2">{section.combinedData.length} rows</p>
                          </TabsContent>
                        </Tabs>
                      </CardContent>
                    </Card>
                  ))
                ) : (
                  [
                    { title: "High Rate (> 55)" },
                    { title: "Medium Rate (30 - 40)" },
                    { title: "Low Rate (< 30)" },
                  ].map((section, idx) => (
                    <Card key={`mc-empty-${idx}`}>
                      <CardHeader>
                        <CardTitle>{section.title}</CardTitle>
                        <CardDescription>Upload card data above to populate</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="rounded-md border">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>#</TableHead>
                                <TableHead>Machine Name</TableHead>
                                <TableHead>Player Side</TableHead>
                                <TableHead className="text-right">Coin In</TableHead>
                                <TableHead className="text-right">Ticket Out</TableHead>
                                <TableHead className="text-right">Ticket Leak</TableHead>
                                <TableHead className="text-right">Rate</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              <TableRow>
                                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">Upload card Excel file to see data</TableCell>
                              </TableRow>
                            </TableBody>
                          </Table>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </TooltipProvider>
  )
}
