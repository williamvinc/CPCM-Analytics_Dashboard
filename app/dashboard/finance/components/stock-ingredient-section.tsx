"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Search } from "lucide-react"

interface StockIngredient {
  id: number
  code: string
  item: string
  category: string
  uom: string
  stock: number
  outlet_name: string
}

export function StockIngredientSection() {
  const [items, setItems] = useState<StockIngredient[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")

  const fetchData = (q?: string) => {
    setLoading(true)
    const path = q ? `/api/finance/stock-ingredient?q=${encodeURIComponent(q)}` : "/api/finance/stock-ingredient"
    fetch(path)
      .then((r) => r.json())
      .then((d) => setItems(Array.isArray(d) ? d : []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchData() }, [])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    fetchData(search)
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Stock Ingredient</h2>
        <form onSubmit={handleSearch} className="flex gap-2">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search ingredient..." className="w-[200px] h-8 text-sm" />
          <button type="submit" className="p-1.5 rounded hover:bg-muted"><Search className="h-4 w-4" /></button>
        </form>
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="pt-4">
          {loading ? (
            <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-muted animate-pulse rounded" />)}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>UOM</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>Outlet</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="font-mono text-sm">{item.code}</TableCell>
                    <TableCell className="font-medium">{item.item}</TableCell>
                    <TableCell className="text-sm">{item.category}</TableCell>
                    <TableCell className="text-sm">{item.uom}</TableCell>
                    <TableCell className="text-sm">{item.stock}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{item.outlet_name}</TableCell>
                  </TableRow>
                ))}
                {items.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No stock data found</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  )
}
