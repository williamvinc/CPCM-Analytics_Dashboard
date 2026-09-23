"use client"

import { UomSection } from "../components/uom-section"

export default function UomManagementPage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">UOM Management</h1>
        <p className="text-muted-foreground text-sm mt-1">Manage units of measure, categories, and conversions</p>
      </div>

      <UomSection />
    </div>
  )
}
