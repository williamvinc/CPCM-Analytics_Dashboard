import { getDashboard } from "@/lib/finance-api"
import { NextResponse } from "next/server"

export async function GET() {
  try {
    const data = await getDashboard()
    return NextResponse.json(data)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
