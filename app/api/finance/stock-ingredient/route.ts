import { financeApiFetch } from "@/lib/finance-api"
import { NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const q = searchParams.get("q")
    const path = q ? `/report/stock-ingredient?q=${encodeURIComponent(q)}` : "/report/stock-ingredient"
    const res = await financeApiFetch(path)
    const json = await res.json()
    return NextResponse.json(json.data ?? json, { status: res.status })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
