"use client"

import { Separator } from "@/components/ui/separator"
import { ProductIngredientsSection } from "../components/product-ingredients-section"
import { PurchaseIngredientsSection } from "../components/purchase-ingredients-section"
import { RecipesSection } from "../components/recipes-section"
import { StockIngredientSection } from "../components/stock-ingredient-section"

export default function InventoryPage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Inventory</h1>
        <p className="text-muted-foreground text-sm mt-1">Manage ingredients, purchases, recipes, and stock</p>
      </div>

      <ProductIngredientsSection />
      <Separator />
      <PurchaseIngredientsSection />
      <Separator />
      <RecipesSection />
      <Separator />
      <StockIngredientSection />
    </div>
  )
}
