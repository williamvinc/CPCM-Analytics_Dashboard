import { financeApiFetch } from "@/lib/finance-api"
import { NextResponse } from "next/server"

export async function GET() {
  try {
    const res = await financeApiFetch("/recipes/with-netto")
    const json = await res.json()
    return NextResponse.json(json.data ?? json, { status: res.status })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
