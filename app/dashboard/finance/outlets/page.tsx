"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Plus, Pencil, Trash2 } from "lucide-react"

interface Outlet {
  id: number
  outlet_code: string
  outlet_name: string
  address: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export default function OutletsPage() {
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Outlet | null>(null)
  const [form, setForm] = useState({ outlet_code: "", outlet_name: "", address: "", is_active: true })
  const [submitting, setSubmitting] = useState(false)

  const fetchOutlets = () => {
    setLoading(true)
    fetch("/api/finance/outlets")
      .then((res) => res.json())
      .then((d) => setOutlets(d))
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchOutlets() }, [])

  const openCreate = () => {
    setEditing(null)
    setForm({ outlet_code: "", outlet_name: "", address: "", is_active: true })
    setDialogOpen(true)
  }

  const openEdit = (outlet: Outlet) => {
    setEditing(outlet)
    setForm({ outlet_code: outlet.outlet_code, outlet_name: outlet.outlet_name, address: outlet.address, is_active: outlet.is_active })
    setDialogOpen(true)
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      if (editing) {
        await fetch(`/api/finance/outlets/${editing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        })
      } else {
        await fetch("/api/finance/outlets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        })
      }
      setDialogOpen(false)
      fetchOutlets()
    } catch (e) {
      console.error(e)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm("Hapus outlet ini?")) return
    await fetch(`/api/finance/outlets/${id}`, { method: "DELETE" })
    fetchOutlets()
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Outlets</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage outlet locations</p>
        </div>
        <Button onClick={openCreate} size="sm">
          <Plus className="h-4 w-4 mr-1" /> Add Outlet
        </Button>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">All Outlets</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-10 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {outlets.map((outlet) => (
                  <TableRow key={outlet.id}>
                    <TableCell className="font-mono text-sm">{outlet.outlet_code}</TableCell>
                    <TableCell className="font-medium">{outlet.outlet_name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[300px] truncate">{outlet.address}</TableCell>
                    <TableCell>
                      <Badge variant={outlet.is_active ? "default" : "secondary"}>
                        {outlet.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(outlet)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(outlet.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {outlets.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      No outlets found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Outlet" : "Add Outlet"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="outlet_code">Outlet Code</Label>
              <Input
                id="outlet_code"
                value={form.outlet_code}
                onChange={(e) => setForm({ ...form, outlet_code: e.target.value })}
                placeholder="e.g. OTL-001"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="outlet_name">Outlet Name</Label>
              <Input
                id="outlet_name"
                value={form.outlet_name}
                onChange={(e) => setForm({ ...form, outlet_name: e.target.value })}
                placeholder="e.g. Cpp Nickelodeon"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="address">Address</Label>
              <Input
                id="address"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Full address"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_active"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                className="rounded border-gray-300"
              />
              <Label htmlFor="is_active">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Saving..." : editing ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
