"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Plus, Pencil, Trash2 } from "lucide-react"
import { ProductsSection } from "../components/products-section"

interface Outlet {
  id: number
  outlet_code: string
  outlet_name: string
  address: string
  is_active: boolean
  created_at: string
  updated_at: string
}

interface ProductCategory {
  id: number
  code_product_category: string
  name_product_category: string
  createdat: string
  createdby: string
  updateat: string
  updateby: string | null
}

export default function MasterDataPage() {
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [categories, setCategories] = useState<ProductCategory[]>([])
  const [loading, setLoading] = useState(true)

  const [outletDialogOpen, setOutletDialogOpen] = useState(false)
  const [editingOutlet, setEditingOutlet] = useState<Outlet | null>(null)
  const [outletForm, setOutletForm] = useState({ outlet_code: "", outlet_name: "", address: "", is_active: true })
  const [outletSubmitting, setOutletSubmitting] = useState(false)

  const [catDialogOpen, setCatDialogOpen] = useState(false)
  const [editingCat, setEditingCat] = useState<ProductCategory | null>(null)
  const [catForm, setCatForm] = useState({ code_product_category: "", name_product_category: "" })
  const [catSubmitting, setCatSubmitting] = useState(false)

  const fetchAll = () => {
    setLoading(true)
    Promise.all([
      fetch("/api/finance/outlets").then((r) => r.json()),
      fetch("/api/finance/product-categories").then((r) => r.json()),
    ])
      .then(([o, c]) => { setOutlets(o); setCategories(c) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchAll() }, [])

  const openCreateOutlet = () => { setEditingOutlet(null); setOutletForm({ outlet_code: "", outlet_name: "", address: "", is_active: true }); setOutletDialogOpen(true) }
  const openEditOutlet = (o: Outlet) => { setEditingOutlet(o); setOutletForm({ outlet_code: o.outlet_code, outlet_name: o.outlet_name, address: o.address, is_active: o.is_active }); setOutletDialogOpen(true) }
  const submitOutlet = async () => {
    setOutletSubmitting(true)
    try {
      if (editingOutlet) { await fetch(`/api/finance/outlets/${editingOutlet.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(outletForm) }) }
      else { await fetch("/api/finance/outlets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(outletForm) }) }
      setOutletDialogOpen(false); fetchAll()
    } catch (e) { console.error(e) } finally { setOutletSubmitting(false) }
  }
  const deleteOutlet = async (id: number) => { if (!confirm("Hapus outlet ini?")) return; await fetch(`/api/finance/outlets/${id}`, { method: "DELETE" }); fetchAll() }

  const openCreateCat = () => { setEditingCat(null); setCatForm({ code_product_category: "", name_product_category: "" }); setCatDialogOpen(true) }
  const openEditCat = (c: ProductCategory) => { setEditingCat(c); setCatForm({ code_product_category: c.code_product_category, name_product_category: c.name_product_category }); setCatDialogOpen(true) }
  const submitCat = async () => {
    setCatSubmitting(true)
    try {
      if (editingCat) { await fetch(`/api/finance/product-categories/${editingCat.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...catForm, updateby: "admin" }) }) }
      else { await fetch("/api/finance/product-categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...catForm, createdby: "admin" }) }) }
      setCatDialogOpen(false); fetchAll()
    } catch (e) { console.error(e) } finally { setCatSubmitting(false) }
  }
  const deleteCat = async (id: number) => { if (!confirm("Hapus category ini?")) return; await fetch(`/api/finance/product-categories/${id}`, { method: "DELETE" }); fetchAll() }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Master Data</h1>
        <p className="text-muted-foreground text-sm mt-1">Manage outlets, product categories, and products</p>
      </div>

      {/* Outlets */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Outlets</h2>
        <Button onClick={openCreateOutlet} size="sm"><Plus className="h-4 w-4 mr-1" /> Add Outlet</Button>
      </div>
      <Card className="border-0 shadow-sm">
        <CardContent className="pt-4">
          {loading ? (
            <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-muted animate-pulse rounded" />)}</div>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Address</TableHead><TableHead>Status</TableHead><TableHead className="w-[100px]">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {outlets.map((outlet) => (
                  <TableRow key={outlet.id}>
                    <TableCell className="font-mono text-sm">{outlet.outlet_code}</TableCell>
                    <TableCell className="font-medium">{outlet.outlet_name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[300px] truncate">{outlet.address}</TableCell>
                    <TableCell><Badge variant={outlet.is_active ? "default" : "secondary"}>{outlet.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                    <TableCell><div className="flex gap-1"><Button variant="ghost" size="icon" onClick={() => openEditOutlet(outlet)}><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="icon" onClick={() => deleteOutlet(outlet.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></div></TableCell>
                  </TableRow>
                ))}
                {outlets.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No outlets found</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Separator />

      {/* Product Categories */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Product Categories</h2>
        <Button onClick={openCreateCat} size="sm"><Plus className="h-4 w-4 mr-1" /> Add Category</Button>
      </div>
      <Card className="border-0 shadow-sm">
        <CardContent className="pt-4">
          {loading ? (
            <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-muted animate-pulse rounded" />)}</div>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Created By</TableHead><TableHead>Created At</TableHead><TableHead className="w-[100px]">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {categories.map((cat) => (
                  <TableRow key={cat.id}>
                    <TableCell className="font-mono text-sm">{cat.code_product_category}</TableCell>
                    <TableCell className="font-medium">{cat.name_product_category}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{cat.createdby}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{new Date(cat.createdat).toLocaleDateString("id-ID")}</TableCell>
                    <TableCell><div className="flex gap-1"><Button variant="ghost" size="icon" onClick={() => openEditCat(cat)}><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="icon" onClick={() => deleteCat(cat.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></div></TableCell>
                  </TableRow>
                ))}
                {categories.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No categories found</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Separator />
      <ProductsSection />

      {/* Outlet Dialog */}
      <Dialog open={outletDialogOpen} onOpenChange={setOutletDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingOutlet ? "Edit Outlet" : "Add Outlet"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2"><Label htmlFor="outlet_code">Outlet Code</Label><Input id="outlet_code" value={outletForm.outlet_code} onChange={(e) => setOutletForm({ ...outletForm, outlet_code: e.target.value })} placeholder="e.g. OTL-001" /></div>
            <div className="grid gap-2"><Label htmlFor="outlet_name">Outlet Name</Label><Input id="outlet_name" value={outletForm.outlet_name} onChange={(e) => setOutletForm({ ...outletForm, outlet_name: e.target.value })} placeholder="e.g. Cpp Nickelodeon" /></div>
            <div className="grid gap-2"><Label htmlFor="address">Address</Label><Input id="address" value={outletForm.address} onChange={(e) => setOutletForm({ ...outletForm, address: e.target.value })} placeholder="Full address" /></div>
            <div className="flex items-center gap-2"><input type="checkbox" id="is_active" checked={outletForm.is_active} onChange={(e) => setOutletForm({ ...outletForm, is_active: e.target.checked })} className="rounded border-gray-300" /><Label htmlFor="is_active">Active</Label></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOutletDialogOpen(false)}>Cancel</Button><Button onClick={submitOutlet} disabled={outletSubmitting}>{outletSubmitting ? "Saving..." : editingOutlet ? "Update" : "Create"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Category Dialog */}
      <Dialog open={catDialogOpen} onOpenChange={setCatDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingCat ? "Edit Category" : "Add Category"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2"><Label htmlFor="cat_code">Category Code</Label><Input id="cat_code" value={catForm.code_product_category} onChange={(e) => setCatForm({ ...catForm, code_product_category: e.target.value })} placeholder="e.g. FODY" /></div>
            <div className="grid gap-2"><Label htmlFor="cat_name">Category Name</Label><Input id="cat_name" value={catForm.name_product_category} onChange={(e) => setCatForm({ ...catForm, name_product_category: e.target.value })} placeholder="e.g. FOOD-DRY" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setCatDialogOpen(false)}>Cancel</Button><Button onClick={submitCat} disabled={catSubmitting}>{catSubmitting ? "Saving..." : editingCat ? "Update" : "Create"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
