"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Plus, Pencil, Trash2 } from "lucide-react"

interface Product {
  id: number
  code: string
  category: string
  item: string
  uom: string
  created_by: string
  created_date: string
}

export function ProductsSection() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [form, setForm] = useState({ code: "", category: "", item: "", uom: "" })
  const [submitting, setSubmitting] = useState(false)

  const fetchProducts = () => {
    setLoading(true)
    fetch("/api/finance/products")
      .then((r) => r.json())
      .then((d) => setProducts(Array.isArray(d) ? d : []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchProducts() }, [])

  const openCreate = () => {
    setEditing(null)
    setForm({ code: "", category: "", item: "", uom: "" })
    setDialogOpen(true)
  }

  const openEdit = (p: Product) => {
    setEditing(p)
    setForm({ code: p.code, category: p.category, item: p.item, uom: p.uom })
    setDialogOpen(true)
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      if (editing) {
        await fetch(`/api/finance/products/${editing.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, lastmodified_by: "admin" }) })
      } else {
        await fetch("/api/finance/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, created_by: "admin" }) })
      }
      setDialogOpen(false)
      fetchProducts()
    } catch (e) { console.error(e) } finally { setSubmitting(false) }
  }

  const handleDelete = async (id: number) => {
    if (!confirm("Hapus product ini?")) return
    await fetch(`/api/finance/products/${id}`, { method: "DELETE" })
    fetchProducts()
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Products</h2>
        <Button onClick={openCreate} size="sm">
          <Plus className="h-4 w-4 mr-1" /> Add Product
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
                  <TableHead>Created By</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-sm">{p.code}</TableCell>
                    <TableCell className="font-medium">{p.item}</TableCell>
                    <TableCell className="text-sm">{p.category}</TableCell>
                    <TableCell className="text-sm">{p.uom}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.created_by}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(p)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(p.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {products.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No products found</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Product" : "Add Product"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="p_code">Code</Label>
              <Input id="p_code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. FODY-DRFD-0022" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="p_item">Item Name</Label>
              <Input id="p_item" value={form.item} onChange={(e) => setForm({ ...form, item: e.target.value })} placeholder="e.g. FF Fries Finest 10MM" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="p_category">Category</Label>
                <Input id="p_category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. BVRG" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="p_uom">UOM</Label>
                <Input id="p_uom" value={form.uom} onChange={(e) => setForm({ ...form, uom: e.target.value })} placeholder="e.g. GR" />
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
