const FINANCE_API_URL = process.env.FINANCE_API_URL || "https://financeapi.cpcm.my.id"
const FINANCE_API_USER = process.env.FINANCE_API_USER || "admin"
const FINANCE_API_PASS = process.env.FINANCE_API_PASS || "qwerty123"

let cachedToken: string | null = null
let tokenExpiry: number = 0

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() / 1000 < tokenExpiry - 60) {
    return cachedToken
  }

  const res = await fetch(`${FINANCE_API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: FINANCE_API_USER, password: FINANCE_API_PASS }),
  })

  if (!res.ok) throw new Error("Finance API login failed")

  const json = await res.json()
  cachedToken = json.data.token

  const payload = JSON.parse(atob(cachedToken!.split(".")[1]))
  tokenExpiry = payload.exp

  return cachedToken!
}

export async function financeApiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getToken()
  const url = `${FINANCE_API_URL}${path}`

  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  })
}

export interface DashboardData {
  total_product: number
  total_stock_ingredient: number
  total_user: number
  total_outlet: number
  total_purchase_ingredient: number
}

export interface Outlet {
  id: number
  outlet_code: string
  outlet_name: string
  address: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ProductCategory {
  id: number
  code_product_category: string
  name_product_category: string
  createdat: string
  createdby: string
  updateat: string
  updateby: string | null
}

export async function getDashboard(): Promise<DashboardData> {
  const res = await financeApiFetch("/dashboard")
  const json = await res.json()
  return json.data
}

export async function getOutlets(): Promise<Outlet[]> {
  const res = await financeApiFetch("/outlets")
  const json = await res.json()
  return json.data
}

export async function getProductCategories(): Promise<ProductCategory[]> {
  const res = await financeApiFetch("/product-categories")
  const json = await res.json()
  return json.data
}
