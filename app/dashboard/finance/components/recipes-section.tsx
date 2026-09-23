"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight } from "lucide-react"

interface Recipe {
  id: number
  sku: string
  bom_name: string
  code_item: string
  item_name: string
  unit_recipe: string
  qty_recipe: number
  standart_netto: number
  created_by: string
  created_at: string
}

interface BomGroup {
  sku: string
  bom_name: string
  items: Recipe[]
}

export function RecipesSection() {
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Recipe | null>(null)
  const [form, setForm] = useState({ sku: "", bom_name: "", code_item: "", item_name: "", unit_recipe: "", qty_recipe: 0, standart_netto: 0 })
  const [submitting, setSubmitting] = useState(false)

  const fetchData = () => {
    setLoading(true)
    fetch("/api/finance/recipes")
      .then((r) => r.json())
      .then((d) => setRecipes(Array.isArray(d) ? d : []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchData() }, [])

  const groups: BomGroup[] = recipes.reduce((acc, r) => {
    const key = `${r.sku}::${r.bom_name}`
    const existing = acc.find((g) => `${g.sku}::${g.bom_name}` === key)
    if (existing) { existing.items.push(r) }
    else { acc.push({ sku: r.sku, bom_name: r.bom_name, items: [r] }) }
    return acc
  }, [] as BomGroup[])

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const openCreate = () => {
    setEditing(null)
    setForm({ sku: "", bom_name: "", code_item: "", item_name: "", unit_recipe: "", qty_recipe: 0, standart_netto: 0 })
    setDialogOpen(true)
  }

  const openEdit = (r: Recipe) => {
    setEditing(r)
    setForm({ sku: r.sku, bom_name: r.bom_name, code_item: r.code_item, item_name: r.item_name, unit_recipe: r.unit_recipe, qty_recipe: r.qty_recipe, standart_netto: r.standart_netto })
    setDialogOpen(true)
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      if (editing) {
        await fetch(`/api/finance/recipes/${editing.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, updated_by: "admin" }) })
      } else {
        await fetch("/api/finance/recipes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, created_by: "admin" }) })
      }
      setDialogOpen(false)
      fetchData()
    } catch (e) { console.error(e) } finally { setSubmitting(false) }
  }

  const handleDelete = async (id: number) => {
    if (!confirm("Hapus recipe item ini?")) return
    await fetch(`/api/finance/recipes/${id}`, { method: "DELETE" })
    fetchData()
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Recipes (BOM)</h2>
        <Button onClick={openCreate} size="sm">
          <Plus className="h-4 w-4 mr-1" /> Add Recipe
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
                  <TableHead className="w-[40px]"></TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>BOM Name</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((group) => {
                  const key = `${group.sku}::${group.bom_name}`
                  const isExpanded = expandedGroups.has(key)
                  return (
                    <>
                      <TableRow key={key} className="cursor-pointer hover:bg-muted/50" onClick={() => toggleGroup(key)}>
                        <TableCell className="py-3">
                          {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        </TableCell>
                        <TableCell className="font-mono text-sm font-medium">{group.sku}</TableCell>
                        <TableCell className="font-medium">{group.bom_name}</TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">{group.items.length} items</TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow key={`${key}-detail`}>
                          <TableCell colSpan={4} className="p-0">
                            <div className="bg-muted/30 border-y">
                              <Table>
                                <TableHeader>
                                  <TableRow className="text-xs">
                                    <TableHead className="pl-12">Code Item</TableHead>
                                    <TableHead>Item Name</TableHead>
                                    <TableHead>Qty</TableHead>
                                    <TableHead>Unit</TableHead>
                                    <TableHead>Std Netto</TableHead>
                                    <TableHead className="w-[80px]">Actions</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {group.items.map((item) => (
                                    <TableRow key={item.id} className="text-sm">
                                      <TableCell className="pl-12 font-mono text-xs">{item.code_item}</TableCell>
                                      <TableCell>{item.item_name}</TableCell>
                                      <TableCell>{item.qty_recipe}</TableCell>
                                      <TableCell>{item.unit_recipe}</TableCell>
                                      <TableCell>{item.standart_netto}</TableCell>
                                      <TableCell>
                                        <div className="flex gap-1">
                                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); openEdit(item) }}><Pencil className="h-3.5 w-3.5" /></Button>
                                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); handleDelete(item.id) }}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                                        </div>
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  )
                })}
                {groups.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No recipes found</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Recipe Item" : "Add Recipe Item"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="r_sku">SKU</Label>
                <Input id="r_sku" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="e.g. KIDS-FINN-0002" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="r_bom">BOM Name</Label>
                <Input id="r_bom" value={form.bom_name} onChange={(e) => setForm({ ...form, bom_name: e.target.value })} placeholder="e.g. Chicken Cotoletta" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="r_code">Code Item</Label>
                <Input id="r_code" value={form.code_item} onChange={(e) => setForm({ ...form, code_item: e.target.value })} placeholder="e.g. FODY-DRFD-0022" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="r_item">Item Name</Label>
                <Input id="r_item" value={form.item_name} onChange={(e) => setForm({ ...form, item_name: e.target.value })} placeholder="e.g. FF Fries Finest 10MM" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="r_qty">Qty Recipe</Label>
                <Input id="r_qty" type="number" value={form.qty_recipe} onChange={(e) => setForm({ ...form, qty_recipe: parseFloat(e.target.value) || 0 })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="r_unit">Unit Recipe</Label>
                <Input id="r_unit" value={form.unit_recipe} onChange={(e) => setForm({ ...form, unit_recipe: e.target.value })} placeholder="e.g. GR" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="r_netto">Std Netto</Label>
                <Input id="r_netto" type="number" value={form.standart_netto} onChange={(e) => setForm({ ...form, standart_netto: parseFloat(e.target.value) || 0 })} />
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
