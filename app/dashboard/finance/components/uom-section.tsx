"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Plus, Pencil, Trash2 } from "lucide-react"

interface UomCategory {
  id: number
  code: string
  created_by: string
}

interface UomConversion {
  id: number
  uom: string
  uom_name: string
  uom_category_id: number
  factor: number
  created_by: string
}

export function UomSection() {
  const [categories, setCategories] = useState<UomCategory[]>([])
  const [conversions, setConversions] = useState<UomConversion[]>([])
  const [loading, setLoading] = useState(true)

  const [catDialogOpen, setCatDialogOpen] = useState(false)
  const [editingCat, setEditingCat] = useState<UomCategory | null>(null)
  const [catForm, setCatForm] = useState({ code: "" })
  const [catSubmitting, setCatSubmitting] = useState(false)

  const [convDialogOpen, setConvDialogOpen] = useState(false)
  const [editingConv, setEditingConv] = useState<UomConversion | null>(null)
  const [convForm, setConvForm] = useState({ uom: "", uom_name: "", uom_category_id: 0, factor: 0 })
  const [convSubmitting, setConvSubmitting] = useState(false)

  const fetchData = () => {
    setLoading(true)
    Promise.all([
      fetch("/api/finance/uom-categories").then((r) => r.json()),
      fetch("/api/finance/uom-conversions").then((r) => r.json()),
    ])
      .then(([cats, convs]) => {
        setCategories(Array.isArray(cats) ? cats : [])
        setConversions(Array.isArray(convs) ? convs : [])
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchData() }, [])

  // UOM Category handlers
  const openCreateCat = () => { setEditingCat(null); setCatForm({ code: "" }); setCatDialogOpen(true) }
  const openEditCat = (c: UomCategory) => { setEditingCat(c); setCatForm({ code: c.code }); setCatDialogOpen(true) }
  const submitCat = async () => {
    setCatSubmitting(true)
    try {
      if (editingCat) {
        await fetch(`/api/finance/uom-categories/${editingCat.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...catForm, created_by: "admin" }) })
      } else {
        await fetch("/api/finance/uom-categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...catForm, created_by: "admin" }) })
      }
      setCatDialogOpen(false); fetchData()
    } catch (e) { console.error(e) } finally { setCatSubmitting(false) }
  }
  const deleteCat = async (id: number) => { if (!confirm("Hapus UOM category ini?")) return; await fetch(`/api/finance/uom-categories/${id}`, { method: "DELETE" }); fetchData() }

  // UOM Conversion handlers
  const openCreateConv = () => { setEditingConv(null); setConvForm({ uom: "", uom_name: "", uom_category_id: 0, factor: 0 }); setConvDialogOpen(true) }
  const openEditConv = (c: UomConversion) => { setEditingConv(c); setConvForm({ uom: c.uom, uom_name: c.uom_name, uom_category_id: c.uom_category_id, factor: c.factor }); setConvDialogOpen(true) }
  const submitConv = async () => {
    setConvSubmitting(true)
    try {
      if (editingConv) {
        await fetch(`/api/finance/uom-conversions/${editingConv.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...convForm, updated_by: "admin" }) })
      } else {
        await fetch("/api/finance/uom-conversions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...convForm, created_by: "admin" }) })
      }
      setConvDialogOpen(false); fetchData()
    } catch (e) { console.error(e) } finally { setConvSubmitting(false) }
  }
  const deleteConv = async (id: number) => { if (!confirm("Hapus UOM conversion ini?")) return; await fetch(`/api/finance/uom-conversions/${id}`, { method: "DELETE" }); fetchData() }

  return (
    <>
      {/* UOM Categories */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">UOM Categories</h2>
        <Button onClick={openCreateCat} size="sm"><Plus className="h-4 w-4 mr-1" /> Add Category</Button>
      </div>
      <Card className="border-0 shadow-sm">
        <CardContent className="pt-4">
          {loading ? (
            <div className="space-y-3">{[...Array(2)].map((_, i) => <div key={i} className="h-10 bg-muted animate-pulse rounded" />)}</div>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Created By</TableHead><TableHead className="w-[100px]">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {categories.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono">{c.code}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.created_by}</TableCell>
                    <TableCell><div className="flex gap-1"><Button variant="ghost" size="icon" onClick={() => openEditCat(c)}><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="icon" onClick={() => deleteCat(c.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></div></TableCell>
                  </TableRow>
                ))}
                {categories.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">No UOM categories</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* UOM Conversions */}
      <div className="flex items-center justify-between mt-4">
        <h2 className="text-lg font-semibold">UOM Conversions</h2>
        <Button onClick={openCreateConv} size="sm"><Plus className="h-4 w-4 mr-1" /> Add Conversion</Button>
      </div>
      <Card className="border-0 shadow-sm">
        <CardContent className="pt-4">
          {loading ? (
            <div className="space-y-3">{[...Array(2)].map((_, i) => <div key={i} className="h-10 bg-muted animate-pulse rounded" />)}</div>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>UOM</TableHead><TableHead>UOM Name</TableHead><TableHead>Category ID</TableHead><TableHead>Factor</TableHead><TableHead className="w-[100px]">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {conversions.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-sm">{c.uom}</TableCell>
                    <TableCell className="font-medium">{c.uom_name}</TableCell>
                    <TableCell className="text-sm">{c.uom_category_id}</TableCell>
                    <TableCell className="text-sm">{c.factor}</TableCell>
                    <TableCell><div className="flex gap-1"><Button variant="ghost" size="icon" onClick={() => openEditConv(c)}><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="icon" onClick={() => deleteConv(c.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></div></TableCell>
                  </TableRow>
                ))}
                {conversions.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No UOM conversions</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* UOM Category Dialog */}
      <Dialog open={catDialogOpen} onOpenChange={setCatDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingCat ? "Edit UOM Category" : "Add UOM Category"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2"><Label htmlFor="uom_cat_code">Code</Label><Input id="uom_cat_code" value={catForm.code} onChange={(e) => setCatForm({ code: e.target.value })} placeholder="e.g. WEIGHT" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setCatDialogOpen(false)}>Cancel</Button><Button onClick={submitCat} disabled={catSubmitting}>{catSubmitting ? "Saving..." : editingCat ? "Update" : "Create"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* UOM Conversion Dialog */}
      <Dialog open={convDialogOpen} onOpenChange={setConvDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingConv ? "Edit UOM Conversion" : "Add UOM Conversion"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2"><Label htmlFor="conv_uom">UOM</Label><Input id="conv_uom" value={convForm.uom} onChange={(e) => setConvForm({ ...convForm, uom: e.target.value })} placeholder="e.g. KG" /></div>
              <div className="grid gap-2"><Label htmlFor="conv_name">UOM Name</Label><Input id="conv_name" value={convForm.uom_name} onChange={(e) => setConvForm({ ...convForm, uom_name: e.target.value })} placeholder="e.g. Kilogram" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2"><Label htmlFor="conv_cat">Category ID</Label><Input id="conv_cat" type="number" value={convForm.uom_category_id} onChange={(e) => setConvForm({ ...convForm, uom_category_id: parseInt(e.target.value) || 0 })} /></div>
              <div className="grid gap-2"><Label htmlFor="conv_factor">Factor</Label><Input id="conv_factor" type="number" step="0.001" value={convForm.factor} onChange={(e) => setConvForm({ ...convForm, factor: parseFloat(e.target.value) || 0 })} /></div>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setConvDialogOpen(false)}>Cancel</Button><Button onClick={submitConv} disabled={convSubmitting}>{convSubmitting ? "Saving..." : editingConv ? "Update" : "Create"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
