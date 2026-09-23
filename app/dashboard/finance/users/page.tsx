"use client"

import { UsersSection } from "../components/users-section"

export default function FinanceUsersPage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">User Management</h1>
        <p className="text-muted-foreground text-sm mt-1">Manage finance system users and access</p>
      </div>

      <UsersSection />
    </div>
  )
}
