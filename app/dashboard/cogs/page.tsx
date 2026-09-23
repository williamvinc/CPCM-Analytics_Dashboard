"use client"

import * as React from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Plus, Pencil, Trash2, Loader2, Package, Layers, UtensilsCrossed, Calculator, ChevronDown, ChevronRight, ShoppingCart, Archive } from "lucide-react"
import { toast } from "sonner"

interface RawMaterial {
  id: number
  sku: string
  name: string
  unit: string
  price_per_unit: number
  stock_qty: number
  category: string | null
}

interface Wip {
  id: number
  sku: string
  name: string
  unit: string
  yield_qty: number
  stock_qty: number
  category: string | null
}

interface WipRecipe {
  id: number
  wip_sku: string
  wip_name: string
  rm_sku: string
  rm_name: string
  unit: string
  qty: number
  price_per_unit: number
  yield_qty: number
}

interface Menu {
  id: number
  sku: string
  name: string
  category: string | null
  selling_price: number
}

interface MenuRecipe {
  id: number
  menu_sku: string
  ingredient_type: 'raw_material' | 'wip'
  ingredient_sku: string
  qty: number
}

interface Purchase {
  id: number
  purchase_date: string
  rm_sku: string
  rm_name: string
  unit: string
  qty: number
  price_total: number
  supplier: string | null
  notes: string | null
}

interface Production {
  id: number
  production_date: string
  wip_sku: string
  wip_name: string
  unit: string
  batch_qty: number
  output_qty: number
  notes: string | null
}

interface CostResult {
  wip_costs: { sku: string; batch_cost: number; yield_qty: number; unit_cost: number }[]
  menu_costs: { sku: string; name: string; selling_price: number; cost: number; margin: number; margin_pct: number }[]
}

const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000"

export default function COGSPage() {
  const [activeTab, setActiveTab] = React.useState("raw-materials")
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  const [rawMaterials, setRawMaterials] = React.useState<RawMaterial[]>([])
  const [wips, setWips] = React.useState<Wip[]>([])
  const [wipRecipes, setWipRecipes] = React.useState<WipRecipe[]>([])
  const [menus, setMenus] = React.useState<Menu[]>([])
  const [menuRecipes, setMenuRecipes] = React.useState<MenuRecipe[]>([])
  const [purchases, setPurchases] = React.useState<Purchase[]>([])
  const [productions, setProductions] = React.useState<Production[]>([])
  const [costs, setCosts] = React.useState<CostResult | null>(null)

  const [rmDialog, setRmDialog] = React.useState(false)
  const [wipDialog, setWipDialog] = React.useState(false)
  const [wipRecipeDialog, setWipRecipeDialog] = React.useState(false)
  const [menuDialog, setMenuDialog] = React.useState(false)
  const [menuRecipeDialog, setMenuRecipeDialog] = React.useState(false)
  const [purchaseDialog, setPurchaseDialog] = React.useState(false)
  const [productionDialog, setProductionDialog] = React.useState(false)
  const [deleteDialog, setDeleteDialog] = React.useState(false)

  const [editingRm, setEditingRm] = React.useState<RawMaterial | null>(null)
  const [editingWip, setEditingWip] = React.useState<Wip | null>(null)
  const [editingWipRecipe, setEditingWipRecipe] = React.useState<WipRecipe | null>(null)
  const [editingMenu, setEditingMenu] = React.useState<Menu | null>(null)
  const [editingMenuRecipe, setEditingMenuRecipe] = React.useState<MenuRecipe | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<{ type: string; id: number } | null>(null)

  const [expandedWips, setExpandedWips] = React.useState<Set<string>>(new Set())
  const [expandedMenus, setExpandedMenus] = React.useState<Set<string>>(new Set())

  const [rmForm, setRmForm] = React.useState({ sku: '', name: '', unit: 'gram', price_per_unit: 0, stock_qty: 0, category: '' })
  const [wipForm, setWipForm] = React.useState({ sku: '', name: '', unit: 'pcs', yield_qty: 1, category: '' })
  const [wipRecipeForm, setWipRecipeForm] = React.useState({ wip_sku: '', rm_sku: '', qty: 0 })
  const [menuForm, setMenuForm] = React.useState({ sku: '', name: '', category: '', selling_price: 0 })
  const [menuRecipeForm, setMenuRecipeForm] = React.useState({ menu_sku: '', ingredient_type: 'raw_material' as 'raw_material' | 'wip', ingredient_sku: '', qty: 0 })
  const [purchaseForm, setPurchaseForm] = React.useState({ purchase_date: new Date().toISOString().split('T')[0], rm_sku: '', qty: 0, price_total: 0, supplier: '', notes: '' })
  const [productionForm, setProductionForm] = React.useState({ production_date: new Date().toISOString().split('T')[0], wip_sku: '', batch_qty: 1, notes: '' })

  const fetchAll = async () => {
    setLoading(true)
    try {
      const [rmRes, wipRes, wipRecRes, menuRes, menuRecRes, purchaseRes, productionRes, costRes] = await Promise.all([
        fetch(`${backendUrl}/api/cogs/raw-materials`),
        fetch(`${backendUrl}/api/cogs/wip`),
        fetch(`${backendUrl}/api/cogs/wip-recipes`),
        fetch(`${backendUrl}/api/cogs/menus`),
        fetch(`${backendUrl}/api/cogs/menu-recipes`),
        fetch(`${backendUrl}/api/cogs/purchases`),
        fetch(`${backendUrl}/api/cogs/productions`),
        fetch(`${backendUrl}/api/cogs/calculate`),
      ])
      if (rmRes.ok) setRawMaterials(await rmRes.json())
      if (wipRes.ok) setWips(await wipRes.json())
      if (wipRecRes.ok) setWipRecipes(await wipRecRes.json())
      if (menuRes.ok) setMenus(await menuRes.json())
      if (menuRecRes.ok) setMenuRecipes(await menuRecRes.json())
      if (purchaseRes.ok) setPurchases(await purchaseRes.json())
      if (productionRes.ok) setProductions(await productionRes.json())
      if (costRes.ok) setCosts(await costRes.json())
    } catch (err) {
      console.error(err)
      toast.error('Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => { fetchAll() }, [])

  const toggleWipExpand = (sku: string) => {
    setExpandedWips(prev => {
      const next = new Set(prev)
      if (next.has(sku)) next.delete(sku)
      else next.add(sku)
      return next
    })
  }

  const toggleMenuExpand = (sku: string) => {
    setExpandedMenus(prev => {
      const next = new Set(prev)
      if (next.has(sku)) next.delete(sku)
      else next.add(sku)
      return next
    })
  }

  const getWipUnitCost = (sku: string) => costs?.wip_costs.find(w => w.sku === sku)?.unit_cost || 0
  const getMenuCost = (sku: string) => costs?.menu_costs.find(m => m.sku === sku)

  // Raw Material CRUD
  const openRmDialog = (rm?: RawMaterial) => {
    if (rm) {
      setEditingRm(rm)
      setRmForm({ sku: rm.sku, name: rm.name, unit: rm.unit, price_per_unit: rm.price_per_unit, stock_qty: rm.stock_qty, category: rm.category || '' })
    } else {
      setEditingRm(null)
      const nextNum = rawMaterials.length + 1
      setRmForm({ sku: `RM-${String(nextNum).padStart(4, '0')}`, name: '', unit: 'gram', price_per_unit: 0, stock_qty: 0, category: '' })
    }
    setRmDialog(true)
  }

  const saveRm = async () => {
    if (!rmForm.sku.trim()) {
      toast.error('SKU is required')
      return
    }
    if (!rmForm.name.trim()) {
      toast.error('Name is required')
      return
    }
    setSaving(true)
    try {
      const method = editingRm ? 'PUT' : 'POST'
      const url = editingRm ? `${backendUrl}/api/cogs/raw-materials/${editingRm.id}` : `${backendUrl}/api/cogs/raw-materials`
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rmForm) })
      if (res.ok) {
        toast.success(editingRm ? 'Updated' : 'Created')
        setRmDialog(false)
        fetchAll()
      } else {
        const err = await res.json()
        toast.error(err.detail || 'Failed')
      }
    } catch { toast.error('Failed') }
    finally { setSaving(false) }
  }

  // WIP CRUD
  const openWipDialog = (wip?: Wip) => {
    if (wip) {
      setEditingWip(wip)
      setWipForm({ sku: wip.sku, name: wip.name, unit: wip.unit, yield_qty: wip.yield_qty, category: wip.category || '' })
    } else {
      setEditingWip(null)
      setWipForm({ sku: '', name: '', unit: 'pcs', yield_qty: 1, category: '' })
    }
    setWipDialog(true)
  }

  const saveWip = async () => {
    if (!wipForm.sku.trim()) {
      toast.error('SKU is required')
      return
    }
    if (!wipForm.name.trim()) {
      toast.error('Name is required')
      return
    }
    setSaving(true)
    try {
      const method = editingWip ? 'PUT' : 'POST'
      const url = editingWip ? `${backendUrl}/api/cogs/wip/${editingWip.id}` : `${backendUrl}/api/cogs/wip`
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(wipForm) })
      if (res.ok) {
        toast.success(editingWip ? 'Updated' : 'Created')
        setWipDialog(false)
        fetchAll()
      } else {
        const err = await res.json()
        toast.error(err.detail || 'Failed')
      }
    } catch { toast.error('Failed') }
    finally { setSaving(false) }
  }

  // WIP Recipe CRUD
  const openWipRecipeDialog = (wipSku: string, recipe?: WipRecipe) => {
    if (recipe) {
      setEditingWipRecipe(recipe)
      setWipRecipeForm({ wip_sku: recipe.wip_sku, rm_sku: recipe.rm_sku, qty: recipe.qty })
    } else {
      setEditingWipRecipe(null)
      setWipRecipeForm({ wip_sku: wipSku, rm_sku: '', qty: 0 })
    }
    setWipRecipeDialog(true)
  }

  const saveWipRecipe = async () => {
    setSaving(true)
    try {
      const method = editingWipRecipe ? 'PUT' : 'POST'
      const url = editingWipRecipe ? `${backendUrl}/api/cogs/wip-recipes/${editingWipRecipe.id}` : `${backendUrl}/api/cogs/wip-recipes`
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(wipRecipeForm) })
      if (res.ok) {
        toast.success(editingWipRecipe ? 'Updated' : 'Added')
        setWipRecipeDialog(false)
        fetchAll()
      } else {
        const err = await res.json()
        toast.error(err.detail || 'Failed')
      }
    } catch { toast.error('Failed') }
    finally { setSaving(false) }
  }

  // Menu CRUD
  const openMenuDialog = (menu?: Menu) => {
    if (menu) {
      setEditingMenu(menu)
      setMenuForm({ sku: menu.sku, name: menu.name, category: menu.category || '', selling_price: menu.selling_price })
    } else {
      setEditingMenu(null)
      setMenuForm({ sku: '', name: '', category: '', selling_price: 0 })
    }
    setMenuDialog(true)
  }

  const saveMenu = async () => {
    if (!menuForm.sku.trim()) {
      toast.error('SKU is required')
      return
    }
    if (!menuForm.name.trim()) {
      toast.error('Name is required')
      return
    }
    setSaving(true)
    try {
      const method = editingMenu ? 'PUT' : 'POST'
      const url = editingMenu ? `${backendUrl}/api/cogs/menus/${editingMenu.id}` : `${backendUrl}/api/cogs/menus`
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(menuForm) })
      if (res.ok) {
        toast.success(editingMenu ? 'Updated' : 'Created')
        setMenuDialog(false)
        fetchAll()
      } else {
        const err = await res.json()
        toast.error(err.detail || 'Failed')
      }
    } catch { toast.error('Failed') }
    finally { setSaving(false) }
  }

  // Menu Recipe CRUD
  const openMenuRecipeDialog = (menuSku: string, recipe?: MenuRecipe) => {
    if (recipe) {
      setEditingMenuRecipe(recipe)
      setMenuRecipeForm({ menu_sku: recipe.menu_sku, ingredient_type: recipe.ingredient_type, ingredient_sku: recipe.ingredient_sku, qty: recipe.qty })
    } else {
      setEditingMenuRecipe(null)
      setMenuRecipeForm({ menu_sku: menuSku, ingredient_type: 'raw_material', ingredient_sku: '', qty: 0 })
    }
    setMenuRecipeDialog(true)
  }

  const saveMenuRecipe = async () => {
    setSaving(true)
    try {
      const method = editingMenuRecipe ? 'PUT' : 'POST'
      const url = editingMenuRecipe ? `${backendUrl}/api/cogs/menu-recipes/${editingMenuRecipe.id}` : `${backendUrl}/api/cogs/menu-recipes`
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(menuRecipeForm) })
      if (res.ok) {
        toast.success(editingMenuRecipe ? 'Updated' : 'Added')
        setMenuRecipeDialog(false)
        fetchAll()
      } else {
        const err = await res.json()
        toast.error(err.detail || 'Failed')
      }
    } catch { toast.error('Failed') }
    finally { setSaving(false) }
  }

  // Purchase CRUD
  const openPurchaseDialog = () => {
    setPurchaseForm({ purchase_date: new Date().toISOString().split('T')[0], rm_sku: '', qty: 0, price_total: 0, supplier: '', notes: '' })
    setPurchaseDialog(true)
  }

  const savePurchase = async () => {
    if (!purchaseForm.rm_sku) {
      toast.error('Select a raw material')
      return
    }
    if (purchaseForm.qty <= 0) {
      toast.error('Quantity must be greater than 0')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`${backendUrl}/api/cogs/purchases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(purchaseForm)
      })
      if (res.ok) {
        toast.success('Purchase recorded')
        setPurchaseDialog(false)
        fetchAll()
      } else {
        const err = await res.json()
        toast.error(err.detail || 'Failed')
      }
    } catch { toast.error('Failed') }
    finally { setSaving(false) }
  }

  // Production CRUD
  const openProductionDialog = () => {
    setProductionForm({ production_date: new Date().toISOString().split('T')[0], wip_sku: '', batch_qty: 1, notes: '' })
    setProductionDialog(true)
  }

  const saveProduction = async () => {
    if (!productionForm.wip_sku) {
      toast.error('Select a WIP')
      return
    }
    if (productionForm.batch_qty <= 0) {
      toast.error('Batch quantity must be greater than 0')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`${backendUrl}/api/cogs/productions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(productionForm)
      })
      if (res.ok) {
        const data = await res.json()
        toast.success(`Production recorded: ${data.output_qty} units produced`)
        setProductionDialog(false)
        fetchAll()
      } else {
        const err = await res.json()
        toast.error(err.detail || 'Failed')
      }
    } catch { toast.error('Failed') }
    finally { setSaving(false) }
  }

  // Delete
  const confirmDelete = (type: string, id: number) => {
    setDeleteTarget({ type, id })
    setDeleteDialog(true)
  }

  const executeDelete = async () => {
    if (!deleteTarget) return
    setSaving(true)
    try {
      const res = await fetch(`${backendUrl}/api/cogs/${deleteTarget.type}/${deleteTarget.id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Deleted')
        setDeleteDialog(false)
        setDeleteTarget(null)
        fetchAll()
      } else {
        const err = await res.json()
        toast.error(err.detail || 'Failed to delete')
      }
    } catch { toast.error('Failed') }
    finally { setSaving(false) }
  }

  const formatRp = (n: number) => `Rp ${n.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`

  const getSelectedWipInfo = () => {
    if (!productionForm.wip_sku) return null
    const wip = wips.find(w => w.sku === productionForm.wip_sku)
    const recipes = wipRecipes.filter(r => r.wip_sku === productionForm.wip_sku)
    return { wip, recipes }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">COGS Management</h1>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="raw-materials" className="gap-2">
            <Package className="h-4 w-4" />
            Master Product
          </TabsTrigger>
          <TabsTrigger value="stock" className="gap-2">
            <Archive className="h-4 w-4" />
            Stock
          </TabsTrigger>
          <TabsTrigger value="wip" className="gap-2">
            <Layers className="h-4 w-4" />
            WIP
          </TabsTrigger>
          <TabsTrigger value="menus" className="gap-2">
            <UtensilsCrossed className="h-4 w-4" />
            Menus
          </TabsTrigger>
          <TabsTrigger value="purchases" className="gap-2">
            <ShoppingCart className="h-4 w-4" />
            Purchases
          </TabsTrigger>
          <TabsTrigger value="summary" className="gap-2">
            <Calculator className="h-4 w-4" />
            Cost Summary
          </TabsTrigger>
        </TabsList>

        {/* RAW MATERIALS TAB - Now called Master Product */}
        <TabsContent value="raw-materials">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Master Product (Bahan Baku)</CardTitle>
                <CardDescription>All items in the system. SKU format: RM-0001</CardDescription>
              </div>
              <Button onClick={() => openRmDialog()}>
                <Plus className="h-4 w-4 mr-2" />
                Add Product
              </Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Price/Unit</TableHead>
                    <TableHead className="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rawMaterials.map(rm => (
                    <TableRow key={rm.id}>
                      <TableCell className="font-mono text-sm">{rm.sku}</TableCell>
                      <TableCell>{rm.name}</TableCell>
                      <TableCell>{rm.category || '-'}</TableCell>
                      <TableCell>{rm.unit}</TableCell>
                      <TableCell className="text-right">{formatRp(rm.price_per_unit)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openRmDialog(rm)}><Pencil className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => confirmDelete('raw-materials', rm.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {rawMaterials.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No products yet</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* STOCK TAB - Only items with stock > 0 */}
        <TabsContent value="stock">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Stock (Persediaan)</CardTitle>
                <CardDescription>Only items with physical stock available</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Price/Unit</TableHead>
                    <TableHead className="text-right">Stock Qty</TableHead>
                    <TableHead className="text-right">Stock Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rawMaterials.filter(rm => rm.stock_qty > 0).map(rm => (
                    <TableRow key={rm.id}>
                      <TableCell className="font-mono text-sm">{rm.sku}</TableCell>
                      <TableCell>{rm.name}</TableCell>
                      <TableCell>{rm.category || '-'}</TableCell>
                      <TableCell>{rm.unit}</TableCell>
                      <TableCell className="text-right">{formatRp(rm.price_per_unit)}</TableCell>
                      <TableCell className="text-right font-semibold">{rm.stock_qty.toLocaleString()}</TableCell>
                      <TableCell className="text-right text-green-600 font-semibold">{formatRp(rm.stock_qty * rm.price_per_unit)}</TableCell>
                    </TableRow>
                  ))}
                  {rawMaterials.filter(rm => rm.stock_qty > 0).length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No items with stock</TableCell></TableRow>
                  )}
                </TableBody>
                {rawMaterials.filter(rm => rm.stock_qty > 0).length > 0 && (
                  <tfoot>
                    <TableRow className="border-t-2 font-semibold bg-muted/40">
                      <TableCell colSpan={5}>Total Stock Value</TableCell>
                      <TableCell className="text-right">
                        {rawMaterials.filter(rm => rm.stock_qty > 0).reduce((sum, rm) => sum + rm.stock_qty, 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right text-green-600">
                        {formatRp(rawMaterials.filter(rm => rm.stock_qty > 0).reduce((sum, rm) => sum + (rm.stock_qty * rm.price_per_unit), 0))}
                      </TableCell>
                    </TableRow>
                  </tfoot>
                )}
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* WIP TAB */}
        <TabsContent value="wip">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>WIP (Work In Progress)</CardTitle>
                <CardDescription>Intermediate items for cost calculation. Menu will automatically break down to raw materials through WIP recipes.</CardDescription>
              </div>
              <Button onClick={() => openWipDialog()}>
                <Plus className="h-4 w-4 mr-2" />
                Add WIP
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {wips.map(wip => {
                const recipes = wipRecipes.filter(r => r.wip_sku === wip.sku)
                const batchCost = recipes.reduce((sum, r) => sum + r.qty * r.price_per_unit, 0)
                const unitCost = batchCost / wip.yield_qty
                const isExpanded = expandedWips.has(wip.sku)

                return (
                  <div key={wip.id} className="border rounded-lg">
                    <div
                      className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50"
                      onClick={() => toggleWipExpand(wip.sku)}
                    >
                      <div className="flex items-center gap-3">
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        <div>
                          <div className="font-semibold">{wip.name}</div>
                          <div className="text-sm text-muted-foreground font-mono">{wip.sku} • {wip.category || 'No category'}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-6">
                        <div className="text-right">
                          <div className="text-sm text-muted-foreground">Stock</div>
                          <div className="font-medium">{wip.stock_qty || 0} {wip.unit}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm text-muted-foreground">Yield/Batch</div>
                          <div className="font-medium">{wip.yield_qty} {wip.unit}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm text-muted-foreground">Cost/{wip.unit}</div>
                          <div className="font-semibold text-rose-600">{formatRp(unitCost)}</div>
                        </div>
                        <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" onClick={() => openWipDialog(wip)}><Pencil className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => confirmDelete('wip', wip.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t p-4 bg-muted/20">
                        <div className="flex items-center justify-between mb-3">
                          <Label className="text-sm font-medium">Recipe (Raw Materials per Batch)</Label>
                          <Button size="sm" variant="outline" onClick={() => openWipRecipeDialog(wip.sku)}>
                            <Plus className="h-3 w-3 mr-1" /> Add Ingredient
                          </Button>
                        </div>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>SKU</TableHead>
                              <TableHead>Raw Material</TableHead>
                              <TableHead className="text-right">Qty</TableHead>
                              <TableHead>Unit</TableHead>
                              <TableHead className="text-right">Price/Unit</TableHead>
                              <TableHead className="text-right">Subtotal</TableHead>
                              <TableHead className="w-[80px]"></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {recipes.map(r => (
                              <TableRow key={r.id}>
                                <TableCell className="font-mono text-sm">{r.rm_sku}</TableCell>
                                <TableCell>{r.rm_name}</TableCell>
                                <TableCell className="text-right">{r.qty}</TableCell>
                                <TableCell>{r.unit}</TableCell>
                                <TableCell className="text-right">{formatRp(r.price_per_unit)}</TableCell>
                                <TableCell className="text-right">{formatRp(r.qty * r.price_per_unit)}</TableCell>
                                <TableCell>
                                  <div className="flex gap-1">
                                    <Button variant="ghost" size="icon" onClick={() => openWipRecipeDialog(wip.sku, r)}><Pencil className="h-3 w-3" /></Button>
                                    <Button variant="ghost" size="icon" onClick={() => confirmDelete('wip-recipes', r.id)}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                            {recipes.length === 0 && (
                              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-4">No ingredients yet</TableCell></TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                )
              })}
              {wips.length === 0 && (
                <div className="text-center text-muted-foreground py-8">No WIP items yet</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* MENUS TAB */}
        <TabsContent value="menus">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Menus (Produk Jual)</CardTitle>
                <CardDescription>Final products made from Raw Materials and/or WIP</CardDescription>
              </div>
              <Button onClick={() => openMenuDialog()}>
                <Plus className="h-4 w-4 mr-2" />
                Add Menu
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {menus.map(menu => {
                const recipes = menuRecipes.filter(r => r.menu_sku === menu.sku)
                const costData = getMenuCost(menu.sku)
                const isExpanded = expandedMenus.has(menu.sku)

                return (
                  <div key={menu.id} className="border rounded-lg">
                    <div
                      className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50"
                      onClick={() => toggleMenuExpand(menu.sku)}
                    >
                      <div className="flex items-center gap-3">
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        <div>
                          <div className="font-semibold">{menu.name}</div>
                          <div className="text-sm text-muted-foreground font-mono">{menu.sku} • {menu.category || 'No category'}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-6">
                        <div className="text-right">
                          <div className="text-sm text-muted-foreground">Selling Price</div>
                          <div className="font-medium">{formatRp(menu.selling_price)}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm text-muted-foreground">COGS</div>
                          <div className="font-medium text-rose-600">{formatRp(costData?.cost || 0)}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm text-muted-foreground">Margin</div>
                          <div className={`font-semibold ${(costData?.margin_pct || 0) >= 50 ? 'text-green-600' : 'text-amber-600'}`}>
                            {costData?.margin_pct || 0}%
                          </div>
                        </div>
                        <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" onClick={() => openMenuDialog(menu)}><Pencil className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => confirmDelete('menus', menu.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t p-4 bg-muted/20">
                        <div className="flex items-center justify-between mb-3">
                          <Label className="text-sm font-medium">Recipe</Label>
                          <Button size="sm" variant="outline" onClick={() => openMenuRecipeDialog(menu.sku)}>
                            <Plus className="h-3 w-3 mr-1" /> Add Ingredient
                          </Button>
                        </div>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Type</TableHead>
                              <TableHead>SKU</TableHead>
                              <TableHead>Name</TableHead>
                              <TableHead className="text-right">Qty</TableHead>
                              <TableHead className="text-right">Unit Cost</TableHead>
                              <TableHead className="text-right">Subtotal</TableHead>
                              <TableHead className="w-[80px]"></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {recipes.map(r => {
                              const isWip = r.ingredient_type === 'wip'
                              const ing = isWip
                                ? wips.find(w => w.sku === r.ingredient_sku)
                                : rawMaterials.find(rm => rm.sku === r.ingredient_sku)
                              const unitCost = isWip ? getWipUnitCost(r.ingredient_sku) : (ing as RawMaterial)?.price_per_unit || 0
                              const subtotal = r.qty * unitCost

                              return (
                                <TableRow key={r.id}>
                                  <TableCell>
                                    <span className={`px-2 py-0.5 rounded text-xs ${isWip ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'}`}>
                                      {isWip ? 'WIP' : 'RM'}
                                    </span>
                                  </TableCell>
                                  <TableCell className="font-mono text-sm">{r.ingredient_sku}</TableCell>
                                  <TableCell>{ing?.name || r.ingredient_sku}</TableCell>
                                  <TableCell className="text-right">{r.qty}</TableCell>
                                  <TableCell className="text-right">{formatRp(unitCost)}</TableCell>
                                  <TableCell className="text-right">{formatRp(subtotal)}</TableCell>
                                  <TableCell>
                                    <div className="flex gap-1">
                                      <Button variant="ghost" size="icon" onClick={() => openMenuRecipeDialog(menu.sku, r)}><Pencil className="h-3 w-3" /></Button>
                                      <Button variant="ghost" size="icon" onClick={() => confirmDelete('menu-recipes', r.id)}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              )
                            })}
                            {recipes.length === 0 && (
                              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-4">No ingredients yet</TableCell></TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                )
              })}
              {menus.length === 0 && (
                <div className="text-center text-muted-foreground py-8">No menus yet</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* PURCHASES TAB */}
        <TabsContent value="purchases">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Purchases (Pembelian Bahan)</CardTitle>
                <CardDescription>Record purchases to increase raw material stock</CardDescription>
              </div>
              <Button onClick={openPurchaseDialog}>
                <Plus className="h-4 w-4 mr-2" />
                Add Purchase
              </Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Raw Material</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Total Price</TableHead>
                    <TableHead className="text-right">Price/Unit</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead className="w-[60px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {purchases.map(p => (
                    <TableRow key={p.id}>
                      <TableCell>{p.purchase_date}</TableCell>
                      <TableCell className="font-mono text-sm">{p.rm_sku}</TableCell>
                      <TableCell>{p.rm_name}</TableCell>
                      <TableCell className="text-right">{p.qty.toLocaleString()}</TableCell>
                      <TableCell>{p.unit}</TableCell>
                      <TableCell className="text-right">{formatRp(p.price_total)}</TableCell>
                      <TableCell className="text-right">{formatRp(p.price_total / p.qty)}</TableCell>
                      <TableCell>{p.supplier || '-'}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => confirmDelete('purchases', p.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {purchases.length === 0 && (
                    <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No purchases yet</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* COST SUMMARY TAB */}
        <TabsContent value="summary">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>WIP Costs</CardTitle>
                <CardDescription>Cost per unit for semi-finished products</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-right">Batch Cost</TableHead>
                      <TableHead className="text-right">Yield</TableHead>
                      <TableHead className="text-right">Unit Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {costs?.wip_costs.map(w => (
                      <TableRow key={w.sku}>
                        <TableCell className="font-mono">{w.sku}</TableCell>
                        <TableCell className="text-right">{formatRp(w.batch_cost)}</TableCell>
                        <TableCell className="text-right">{w.yield_qty}</TableCell>
                        <TableCell className="text-right font-semibold">{formatRp(w.unit_cost)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Menu Costs & Margins</CardTitle>
                <CardDescription>Profitability analysis</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Menu</TableHead>
                      <TableHead className="text-right">Sell</TableHead>
                      <TableHead className="text-right">COGS</TableHead>
                      <TableHead className="text-right">Margin</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {costs?.menu_costs.map(m => (
                      <TableRow key={m.sku}>
                        <TableCell>{m.name}</TableCell>
                        <TableCell className="text-right">{formatRp(m.selling_price)}</TableCell>
                        <TableCell className="text-right text-rose-600">{formatRp(m.cost)}</TableCell>
                        <TableCell className={`text-right font-semibold ${m.margin_pct >= 50 ? 'text-green-600' : 'text-amber-600'}`}>
                          {m.margin_pct}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* RAW MATERIAL DIALOG */}
      <Dialog open={rmDialog} onOpenChange={setRmDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingRm ? 'Edit' : 'Add'} Raw Material</DialogTitle>
            <DialogDescription>Purchased ingredients (RM-xxxx)</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>SKU *</Label>
                <Input value={rmForm.sku} onChange={e => setRmForm(p => ({ ...p, sku: e.target.value }))} placeholder="RM-0001" />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Input value={rmForm.category} onChange={e => setRmForm(p => ({ ...p, category: e.target.value }))} placeholder="Protein, Vegetable..." />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input value={rmForm.name} onChange={e => setRmForm(p => ({ ...p, name: e.target.value }))} placeholder="Tepung Terigu" />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Unit</Label>
                <Select value={rmForm.unit} onValueChange={v => setRmForm(p => ({ ...p, unit: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gram">gram</SelectItem>
                    <SelectItem value="kg">kg</SelectItem>
                    <SelectItem value="ml">ml</SelectItem>
                    <SelectItem value="liter">liter</SelectItem>
                    <SelectItem value="pcs">pcs</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Price per Unit (Rp)</Label>
                <Input type="number" step="0.0001" value={rmForm.price_per_unit} onChange={e => setRmForm(p => ({ ...p, price_per_unit: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-2">
                <Label>Stock Qty</Label>
                <Input type="number" value={rmForm.stock_qty} onChange={e => setRmForm(p => ({ ...p, stock_qty: parseFloat(e.target.value) || 0 }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRmDialog(false)}>Cancel</Button>
            <Button onClick={saveRm} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* WIP DIALOG */}
      <Dialog open={wipDialog} onOpenChange={setWipDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingWip ? 'Edit' : 'Add'} WIP</DialogTitle>
            <DialogDescription>Semi-finished product with batch yield</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>SKU *</Label>
                <Input value={wipForm.sku} onChange={e => setWipForm(p => ({ ...p, sku: e.target.value }))} placeholder="01-BSPT" />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Input value={wipForm.category} onChange={e => setWipForm(p => ({ ...p, category: e.target.value }))} placeholder="Bread, Protein..." />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input value={wipForm.name} onChange={e => setWipForm(p => ({ ...p, name: e.target.value }))} placeholder="Roti Burger" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Output Unit</Label>
                <Select value={wipForm.unit} onValueChange={v => setWipForm(p => ({ ...p, unit: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pcs">pcs</SelectItem>
                    <SelectItem value="portion">portion</SelectItem>
                    <SelectItem value="batch">batch</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Yield per Batch</Label>
                <Input type="number" value={wipForm.yield_qty} onChange={e => setWipForm(p => ({ ...p, yield_qty: parseFloat(e.target.value) || 1 }))} />
                <p className="text-xs text-muted-foreground">How many units 1 batch produces</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWipDialog(false)}>Cancel</Button>
            <Button onClick={saveWip} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* WIP RECIPE DIALOG */}
      <Dialog open={wipRecipeDialog} onOpenChange={setWipRecipeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingWipRecipe ? 'Edit' : 'Add'} WIP Ingredient</DialogTitle>
            <DialogDescription>Raw material used in this WIP</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Raw Material</Label>
              <Select value={wipRecipeForm.rm_sku} onValueChange={v => setWipRecipeForm(p => ({ ...p, rm_sku: v }))}>
                <SelectTrigger><SelectValue placeholder="Select raw material" /></SelectTrigger>
                <SelectContent>
                  {rawMaterials.length > 0
                    ? rawMaterials.filter(rm => rm.sku).map(rm => (
                        <SelectItem key={rm.sku} value={rm.sku}>{rm.sku} - {rm.name} ({rm.unit})</SelectItem>
                      ))
                    : <SelectItem value="_empty" disabled>No Raw Materials - create one first</SelectItem>
                  }
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Quantity per Batch</Label>
              <Input type="number" step="0.01" value={wipRecipeForm.qty} onChange={e => setWipRecipeForm(p => ({ ...p, qty: parseFloat(e.target.value) || 0 }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWipRecipeDialog(false)}>Cancel</Button>
            <Button onClick={saveWipRecipe} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MENU DIALOG */}
      <Dialog open={menuDialog} onOpenChange={setMenuDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingMenu ? 'Edit' : 'Add'} Menu</DialogTitle>
            <DialogDescription>Final product for sale</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>SKU *</Label>
                <Input value={menuForm.sku} onChange={e => setMenuForm(p => ({ ...p, sku: e.target.value }))} placeholder="MNU-001" />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Input value={menuForm.category} onChange={e => setMenuForm(p => ({ ...p, category: e.target.value }))} placeholder="Main Menu, Drinks..." />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input value={menuForm.name} onChange={e => setMenuForm(p => ({ ...p, name: e.target.value }))} placeholder="Burger Smash Single" />
            </div>
            <div className="space-y-2">
              <Label>Selling Price (Rp)</Label>
              <Input type="number" value={menuForm.selling_price} onChange={e => setMenuForm(p => ({ ...p, selling_price: parseFloat(e.target.value) || 0 }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMenuDialog(false)}>Cancel</Button>
            <Button onClick={saveMenu} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MENU RECIPE DIALOG */}
      <Dialog open={menuRecipeDialog} onOpenChange={setMenuRecipeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingMenuRecipe ? 'Edit' : 'Add'} Menu Ingredient</DialogTitle>
            <DialogDescription>Add Raw Material or WIP to this menu</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Ingredient Type</Label>
              <Select value={menuRecipeForm.ingredient_type} onValueChange={v => setMenuRecipeForm(p => ({ ...p, ingredient_type: v as 'raw_material' | 'wip', ingredient_sku: '' }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="raw_material">Raw Material (RM)</SelectItem>
                  <SelectItem value="wip">WIP (Semi-Finished)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{menuRecipeForm.ingredient_type === 'wip' ? 'WIP' : 'Raw Material'}</Label>
              <Select value={menuRecipeForm.ingredient_sku} onValueChange={v => setMenuRecipeForm(p => ({ ...p, ingredient_sku: v }))}>
                <SelectTrigger><SelectValue placeholder="Select ingredient" /></SelectTrigger>
                <SelectContent>
                  {menuRecipeForm.ingredient_type === 'wip'
                    ? (wips.length > 0
                        ? wips.filter(w => w.sku).map(w => <SelectItem key={w.sku} value={w.sku}>{w.sku} - {w.name}</SelectItem>)
                        : <SelectItem value="_empty" disabled>No WIP available - create one first</SelectItem>)
                    : (rawMaterials.length > 0
                        ? rawMaterials.filter(rm => rm.sku).map(rm => <SelectItem key={rm.sku} value={rm.sku}>{rm.sku} - {rm.name} ({rm.unit})</SelectItem>)
                        : <SelectItem value="_empty" disabled>No Raw Materials - create one first</SelectItem>)
                  }
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Quantity</Label>
              <Input type="number" step="0.01" value={menuRecipeForm.qty} onChange={e => setMenuRecipeForm(p => ({ ...p, qty: parseFloat(e.target.value) || 0 }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMenuRecipeDialog(false)}>Cancel</Button>
            <Button onClick={saveMenuRecipe} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PURCHASE DIALOG */}
      <Dialog open={purchaseDialog} onOpenChange={setPurchaseDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Purchase</DialogTitle>
            <DialogDescription>Record a purchase to increase raw material stock</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Date</Label>
              <Input type="date" value={purchaseForm.purchase_date} onChange={e => setPurchaseForm(p => ({ ...p, purchase_date: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Raw Material</Label>
              <Select value={purchaseForm.rm_sku} onValueChange={v => setPurchaseForm(p => ({ ...p, rm_sku: v }))}>
                <SelectTrigger><SelectValue placeholder="Select raw material" /></SelectTrigger>
                <SelectContent>
                  {rawMaterials.length > 0
                    ? rawMaterials.filter(rm => rm.sku).map(rm => (
                        <SelectItem key={rm.sku} value={rm.sku}>{rm.sku} - {rm.name} ({rm.unit})</SelectItem>
                      ))
                    : <SelectItem value="_empty" disabled>No Raw Materials - create one first</SelectItem>
                  }
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Quantity</Label>
                <Input type="number" step="0.01" value={purchaseForm.qty} onChange={e => setPurchaseForm(p => ({ ...p, qty: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-2">
                <Label>Total Price (Rp)</Label>
                <Input type="number" value={purchaseForm.price_total} onChange={e => setPurchaseForm(p => ({ ...p, price_total: parseFloat(e.target.value) || 0 }))} />
              </div>
            </div>
            {purchaseForm.qty > 0 && purchaseForm.price_total > 0 && (
              <p className="text-sm text-muted-foreground">
                Price per unit: {formatRp(purchaseForm.price_total / purchaseForm.qty)}
              </p>
            )}
            <div className="space-y-2">
              <Label>Supplier (optional)</Label>
              <Input value={purchaseForm.supplier} onChange={e => setPurchaseForm(p => ({ ...p, supplier: e.target.value }))} placeholder="Supplier name" />
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Input value={purchaseForm.notes} onChange={e => setPurchaseForm(p => ({ ...p, notes: e.target.value }))} placeholder="Additional notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPurchaseDialog(false)}>Cancel</Button>
            <Button onClick={savePurchase} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save Purchase</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DELETE DIALOG */}
      <Dialog open={deleteDialog} onOpenChange={setDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Delete</DialogTitle>
            <DialogDescription>Are you sure? This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog(false)}>Cancel</Button>
            <Button variant="destructive" onClick={executeDelete} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
