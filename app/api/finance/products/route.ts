import { financeApiFetch } from "@/lib/finance-api"
import { NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const start_date = searchParams.get("start_date")
    const end_date = searchParams.get("end_date")
    let path = "/products"
    const params = new URLSearchParams()
    if (start_date) params.set("start_date", start_date)
    if (end_date) params.set("end_date", end_date)
    if (params.toString()) path += `?${params.toString()}`
    const res = await financeApiFetch(path)
    const json = await res.json()
    return NextResponse.json(json.data ?? json, { status: res.status })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const res = await financeApiFetch("/products", {
      method: "POST",
      body: JSON.stringify(body),
    })
    const json = await res.json()
    return NextResponse.json(json, { status: res.status })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
