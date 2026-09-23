"use client"

import { useEffect, useState } from "react"
import { Separator } from "@/components/ui/separator"
import { Package, Warehouse, Users, Store, ShoppingCart } from "lucide-react"
import { TotalSalesSection } from "./components/total-sales-section"

interface DashboardData {
  total_product: number
  total_stock_ingredient: number
  total_user: number
  total_outlet: number
  total_purchase_ingredient: number
}

export default function FinanceDashboardPage() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/finance/dashboard")
      .then((r) => r.json())
      .then((d) => setDashboard(d))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const cards = [
    { title: "Products", value: dashboard?.total_product, icon: Package, gradient: "from-blue-500 to-indigo-600" },
    { title: "Stock Ingredients", value: dashboard?.total_stock_ingredient, icon: Warehouse, gradient: "from-emerald-500 to-teal-600" },
    { title: "Users", value: dashboard?.total_user, icon: Users, gradient: "from-violet-500 to-purple-600" },
    { title: "Outlets", value: dashboard?.total_outlet, icon: Store, gradient: "from-amber-500 to-orange-600" },
    { title: "Purchase Orders", value: dashboard?.total_purchase_ingredient, icon: ShoppingCart, gradient: "from-rose-500 to-pink-600" },
  ]

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Finance Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Overview of finance system data</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {cards.map((card) => (
          <div key={card.title} className="relative overflow-hidden rounded-xl p-5 text-white shadow-md bg-gradient-to-br transition-transform hover:scale-[1.02]" style={{ backgroundImage: `linear-gradient(to bottom right, var(--tw-gradient-stops))` }}>
            <div className={`absolute inset-0 bg-gradient-to-br ${card.gradient}`} />
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-3">
                <card.icon className="h-5 w-5 opacity-80" />
              </div>
              {loading ? (
                <div className="h-9 w-14 bg-white/20 animate-pulse rounded" />
              ) : (
                <p className="text-3xl font-bold tracking-tight">{card.value ?? 0}</p>
              )}
              <p className="text-sm mt-1 opacity-80 font-medium">{card.title}</p>
            </div>
            <div className="absolute -bottom-4 -right-4 opacity-10">
              <card.icon className="h-24 w-24" />
            </div>
          </div>
        ))}
      </div>

      <Separator />
      <TotalSalesSection />
    </div>
  )
}
