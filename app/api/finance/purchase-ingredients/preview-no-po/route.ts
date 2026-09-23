import { financeApiFetch } from "@/lib/finance-api"
import { NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const tanggal = searchParams.get("tanggal")
    const path = tanggal ? `/purchase-ingredients/preview-no-po?tanggal=${encodeURIComponent(tanggal)}` : "/purchase-ingredients/preview-no-po"
    const res = await financeApiFetch(path)
    const json = await res.json()
    return NextResponse.json(json, { status: res.status })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
