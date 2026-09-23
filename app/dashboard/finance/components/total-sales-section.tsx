"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

interface TotalSale {
  id: number
  business_date: string
  total_sales: number
  outlet_name: string
}

export function TotalSalesSection() {
  const [sales, setSales] = useState<TotalSale[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/finance/total-sales")
      .then((r) => r.json())
      .then((d) => setSales(Array.isArray(d) ? d : []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Total Sales</h2>
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="pt-4">
          {loading ? (
            <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-muted animate-pulse rounded" />)}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Business Date</TableHead>
                  <TableHead>Total Sales</TableHead>
                  <TableHead>Outlet</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.map((s, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="text-sm">{s.business_date ? new Date(s.business_date).toLocaleDateString("id-ID") : "-"}</TableCell>
                    <TableCell className="font-medium">{(s.total_sales ?? 0).toLocaleString("id-ID")}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{s.outlet_name}</TableCell>
                  </TableRow>
                ))}
                {sales.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">No sales data found</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  )
}
