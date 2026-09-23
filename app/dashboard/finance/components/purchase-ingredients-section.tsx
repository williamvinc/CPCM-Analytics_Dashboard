"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Plus, Trash2, Eye } from "lucide-react"

interface PurchaseIngredient {
  id: number
  no_po: string
  no_ro: string
  tanggal: string
  outlet_id: number
  outlet_name: string
  remarks: string
  created_by: string
  created_date: string
}

interface PurchaseDetail {
  id: number
  code: string
  item: string
  category: string
  qty: number
  uom: string
  price: number
  conv_qty: number
  conv_uom: string
}

export function PurchaseIngredientsSection() {
  const [purchases, setPurchases] = useState<PurchaseIngredient[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [detailDialogOpen, setDetailDialogOpen] = useState(false)
  const [details, setDetails] = useState<PurchaseDetail[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [form, setForm] = useState({ no_po: "", no_ro: "", tanggal: "", outlet_id: 1, remarks: "" })
  const [submitting, setSubmitting] = useState(false)

  const fetchData = () => {
    setLoading(true)
    fetch("/api/finance/purchase-ingredients")
      .then((r) => r.json())
      .then((d) => setPurchases(Array.isArray(d) ? d : []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchData() }, [])

  const openCreate = () => {
    setForm({ no_po: "", no_ro: "", tanggal: "", outlet_id: 1, remarks: "" })
    setDialogOpen(true)
  }

  const viewDetails = async (id: number) => {
    setDetailLoading(true)
    setDetailDialogOpen(true)
    try {
      const res = await fetch(`/api/finance/purchase-ingredients/${id}/details`)
      const json = await res.json()
      setDetails(json.data ?? [])
    } catch (e) { console.error(e) }
    finally { setDetailLoading(false) }
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      await fetch("/api/finance/purchase-ingredients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, created_by: "admin", items: [] }),
      })
      setDialogOpen(false)
      fetchData()
    } catch (e) { console.error(e) } finally { setSubmitting(false) }
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Purchase Ingredients (PO)</h2>
        <Button onClick={openCreate} size="sm">
          <Plus className="h-4 w-4 mr-1" /> Add PO
        </Button>
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="pt-4">
          {loading ? (
            <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-muted animate-pulse rounded" />)}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No PO</TableHead>
                  <TableHead>No RO</TableHead>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Outlet</TableHead>
                  <TableHead>Remarks</TableHead>
                  <TableHead>Created By</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {purchases.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-sm">{p.no_po}</TableCell>
                    <TableCell className="font-mono text-sm">{p.no_ro}</TableCell>
                    <TableCell className="text-sm">{new Date(p.tanggal).toLocaleDateString("id-ID")}</TableCell>
                    <TableCell className="text-sm">{p.outlet_name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{p.remarks}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.created_by}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => viewDetails(p.id)}><Eye className="h-4 w-4" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {purchases.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No purchase orders found</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create PO Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Purchase Order</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="po_no_po">No PO</Label>
                <Input id="po_no_po" value={form.no_po} onChange={(e) => setForm({ ...form, no_po: e.target.value })} placeholder="e.g. PO/20260610/001" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="po_no_ro">No RO</Label>
                <Input id="po_no_ro" value={form.no_ro} onChange={(e) => setForm({ ...form, no_ro: e.target.value })} placeholder="e.g. RO/20260610/001" />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="po_tanggal">Tanggal</Label>
              <Input id="po_tanggal" type="date" value={form.tanggal} onChange={(e) => setForm({ ...form, tanggal: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="po_remarks">Remarks</Label>
              <Input id="po_remarks" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} placeholder="Notes..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={submitting}>{submitting ? "Saving..." : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>PO Detail Items</DialogTitle></DialogHeader>
          {detailLoading ? (
            <div className="space-y-3 py-4">{[...Array(3)].map((_, i) => <div key={i} className="h-8 bg-muted animate-pulse rounded" />)}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>UOM</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Conv Qty</TableHead>
                  <TableHead>Conv UOM</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {details.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-mono text-sm">{d.code}</TableCell>
                    <TableCell>{d.item}</TableCell>
                    <TableCell>{d.qty}</TableCell>
                    <TableCell>{d.uom}</TableCell>
                    <TableCell>{d.price?.toLocaleString("id-ID")}</TableCell>
                    <TableCell>{d.conv_qty}</TableCell>
                    <TableCell>{d.conv_uom}</TableCell>
                  </TableRow>
                ))}
                {details.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-4">No items</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
