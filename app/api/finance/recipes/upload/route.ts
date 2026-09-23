import { NextRequest, NextResponse } from "next/server"

const FINANCE_API_URL = process.env.FINANCE_API_URL || "https://financeapi.cpcm.my.id"
const FINANCE_API_USER = process.env.FINANCE_API_USER || "admin"
const FINANCE_API_PASS = process.env.FINANCE_API_PASS || "qwerty123"

async function getToken(): Promise<string> {
  const res = await fetch(`${FINANCE_API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: FINANCE_API_USER, password: FINANCE_API_PASS }),
  })
  const json = await res.json()
  return json.data.token
}

export async function POST(request: NextRequest) {
  try {
    const token = await getToken()
    const formData = await request.formData()
    const res = await fetch(`${FINANCE_API_URL}/recipes/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    })
    const json = await res.json()
    return NextResponse.json(json, { status: res.status })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
