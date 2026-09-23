import { financeApiFetch } from "@/lib/finance-api"
import { NextRequest, NextResponse } from "next/server"

export async function GET() {
  try {
    const res = await financeApiFetch("/recipes")
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
    const res = await financeApiFetch("/recipes", {
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

export async function DELETE() {
  try {
    const res = await financeApiFetch("/recipes", { method: "DELETE" })
    const json = await res.json()
    return NextResponse.json(json, { status: res.status })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
