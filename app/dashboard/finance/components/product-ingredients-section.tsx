"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Plus, Pencil, Trash2 } from "lucide-react"

interface ProductIngredient {
  id: number
  outlet_id: number
  code: string
  category: string
  item: string
  uom: string
  netto: number
  status_material: string
  created_by: string
  created_date: string | null
}

export function ProductIngredientsSection() {
  const [ingredients, setIngredients] = useState<ProductIngredient[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ProductIngredient | null>(null)
  const [form, setForm] = useState({ code: "", category: "", item: "", uom: "", netto: 0, status_material: "WIP", outlet_id: 1 })
  const [submitting, setSubmitting] = useState(false)

  const fetchData = () => {
    setLoading(true)
    fetch("/api/finance/product-ingredients")
      .then((r) => r.json())
      .then((d) => setIngredients(Array.isArray(d) ? d : []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchData() }, [])

  const openCreate = () => {
    setEditing(null)
    setForm({ code: "", category: "", item: "", uom: "", netto: 0, status_material: "WIP", outlet_id: 1 })
    setDialogOpen(true)
  }

  const openEdit = (p: ProductIngredient) => {
    setEditing(p)
    setForm({ code: p.code, category: p.category, item: p.item, uom: p.uom, netto: p.netto, status_material: p.status_material, outlet_id: p.outlet_id })
    setDialogOpen(true)
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      if (editing) {
        await fetch(`/api/finance/product-ingredients/${editing.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, updated_by: "admin" }) })
      } else {
        await fetch("/api/finance/product-ingredients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, created_by: "admin" }) })
      }
      setDialogOpen(false)
      fetchData()
    } catch (e) { console.error(e) } finally { setSubmitting(false) }
  }

  const handleDelete = async (id: number) => {
    if (!confirm("Hapus ingredient ini?")) return
    await fetch(`/api/finance/product-ingredients/${id}`, { method: "DELETE" })
    fetchData()
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Product Ingredients</h2>
        <Button onClick={openCreate} size="sm">
          <Plus className="h-4 w-4 mr-1" /> Add Ingredient
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
                  <TableHead>Code</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>UOM</TableHead>
                  <TableHead>Netto</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ingredients.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-sm">{p.code}</TableCell>
                    <TableCell className="font-medium">{p.item}</TableCell>
                    <TableCell className="text-sm">{p.category}</TableCell>
                    <TableCell className="text-sm">{p.uom}</TableCell>
                    <TableCell className="text-sm">{p.netto}</TableCell>
                    <TableCell className="text-sm">{p.status_material}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(p)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(p.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {ingredients.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No ingredients found</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Ingredient" : "Add Ingredient"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="i_code">Code</Label>
              <Input id="i_code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. BEVG-BSPT-0001" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="i_item">Item Name</Label>
              <Input id="i_item" value={form.item} onChange={(e) => setForm({ ...form, item: e.target.value })} placeholder="e.g. Esspresso" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="i_category">Category</Label>
                <Input id="i_category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. BVRG" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="i_uom">UOM</Label>
                <Input id="i_uom" value={form.uom} onChange={(e) => setForm({ ...form, uom: e.target.value })} placeholder="e.g. ML" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="i_netto">Netto</Label>
                <Input id="i_netto" type="number" value={form.netto} onChange={(e) => setForm({ ...form, netto: parseFloat(e.target.value) || 0 })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="i_status">Status Material</Label>
                <Input id="i_status" value={form.status_material} onChange={(e) => setForm({ ...form, status_material: e.target.value })} placeholder="e.g. WIP" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={submitting}>{submitting ? "Saving..." : editing ? "Update" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
