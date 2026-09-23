"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Plus, Pencil, Trash2 } from "lucide-react"

interface User {
  id: number
  name: string
  username: string
  email: string
  role_id: number
  outlet_id: number
  outlet_name: string
  is_active: boolean
  created_at: string
}

export function UsersSection() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [form, setForm] = useState({ name: "", username: "", email: "", password: "", role_id: 1, outlet_id: 1 })
  const [submitting, setSubmitting] = useState(false)

  const fetchData = () => {
    setLoading(true)
    fetch("/api/finance/users")
      .then((r) => r.json())
      .then((d) => setUsers(Array.isArray(d) ? d : []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchData() }, [])

  const openCreate = () => {
    setEditing(null)
    setForm({ name: "", username: "", email: "", password: "", role_id: 1, outlet_id: 1 })
    setDialogOpen(true)
  }

  const openEdit = (u: User) => {
    setEditing(u)
    setForm({ name: u.name, username: u.username, email: u.email, password: "", role_id: u.role_id, outlet_id: u.outlet_id })
    setDialogOpen(true)
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      if (editing) {
        const body: Record<string, unknown> = { name: form.name, email: form.email, role_id: form.role_id, outlet_id: form.outlet_id }
        await fetch(`/api/finance/users/${editing.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      } else {
        await fetch("/api/finance/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) })
      }
      setDialogOpen(false)
      fetchData()
    } catch (e) { console.error(e) } finally { setSubmitting(false) }
  }

  const handleDelete = async (id: number) => {
    if (!confirm("Hapus user ini?")) return
    await fetch(`/api/finance/users/${id}`, { method: "DELETE" })
    fetchData()
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Users</h2>
        <Button onClick={openCreate} size="sm"><Plus className="h-4 w-4 mr-1" /> Add User</Button>
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="pt-4">
          {loading ? (
            <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-muted animate-pulse rounded" />)}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Outlet</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.name}</TableCell>
                    <TableCell className="font-mono text-sm">{u.username}</TableCell>
                    <TableCell className="text-sm">{u.email}</TableCell>
                    <TableCell className="text-sm">{u.role_id === 1 ? "Admin" : `Role ${u.role_id}`}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{u.outlet_name || `Outlet ${u.outlet_id}`}</TableCell>
                    <TableCell><Badge variant={u.is_active ? "default" : "secondary"}>{u.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(u)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(u.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {users.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No users found</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit User" : "Add User"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2"><Label htmlFor="u_name">Name</Label><Input id="u_name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" /></div>
            {!editing && (
              <>
                <div className="grid gap-2"><Label htmlFor="u_username">Username</Label><Input id="u_username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="Username" /></div>
                <div className="grid gap-2"><Label htmlFor="u_password">Password</Label><Input id="u_password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Min 6 characters" /></div>
              </>
            )}
            <div className="grid gap-2"><Label htmlFor="u_email">Email</Label><Input id="u_email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email@example.com" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2"><Label htmlFor="u_role">Role ID</Label><Input id="u_role" type="number" value={form.role_id} onChange={(e) => setForm({ ...form, role_id: parseInt(e.target.value) || 1 })} /></div>
              <div className="grid gap-2"><Label htmlFor="u_outlet">Outlet ID</Label><Input id="u_outlet" type="number" value={form.outlet_id} onChange={(e) => setForm({ ...form, outlet_id: parseInt(e.target.value) || 1 })} /></div>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button><Button onClick={handleSubmit} disabled={submitting}>{submitting ? "Saving..." : editing ? "Update" : "Create"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
