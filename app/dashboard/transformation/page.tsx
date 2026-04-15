"use client"
import React, { useState } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { UploadCloud, Download, Wand2, Loader2 } from "lucide-react"

export default function TransformationPage() {
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    preview_data: any[]
    chart_category: any[]
    chart_source: any[]
    file_base64: string
    total_rows: number
  } | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0])
      setError(null)
    }
  }

  const handleTransform = async () => {
    if (!file) {
      setError("Please select a file first.")
      return
    }

    setLoading(true)
    setError(null)

    const formData = new FormData()
    formData.append("file", file)

    try {
      const response = await fetch("http://localhost:8000/api/transform/sales", {
        method: "POST",
        body: formData, // the Fetch API handles setting the multipart/form-data headers automatically
      })

      if (!response.ok) {
        const errData = await response.json()
        throw new Error(errData.detail || "Transformation failed on the server.")
      }

      const data = await response.json()
      setResult(data)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = () => {
    if (!result?.file_base64) return
    
    // Decode base64 and trigger download
    const byteCharacters = atob(result.file_base64)
    const byteNumbers = new Array(byteCharacters.length)
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i)
    }
    const byteArray = new Uint8Array(byteNumbers)
    const blob = new Blob([byteArray], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
    
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "SalesDetails_Processed.xlsx"
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Data Transformation</h1>
        <p className="text-muted-foreground">Automate Excel mappings and visualize instantly.</p>
      </div>

      <Card className="border-2 border-dashed">
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row items-center gap-6 justify-center text-center">
            <div className="flex flex-col items-center gap-2 flex-1">
              <UploadCloud className="w-12 h-12 text-muted-foreground" />
              <Label htmlFor="file-upload" className="font-semibold text-lg cursor-pointer hover:underline text-primary">
                Upload SalesDetails.xlsx
              </Label>
              <Input 
                id="file-upload" 
                type="file" 
                accept=".xlsx,.xls" 
                onChange={handleFileChange}
                className="max-w-xs cursor-pointer bg-muted/30"
              />
              <p className="text-xs text-muted-foreground">Data must have header on row 7</p>
            </div>
            
            <div className="flex items-center">
              <Button 
                onClick={handleTransform} 
                disabled={!file || loading}
                size="lg"
                className="font-bold text-md px-8 py-6 rounded-xl shadow-lg border hover:scale-[1.02] transition-transform"
              >
                {loading ? (
                  <><Loader2 className="mr-2 h-5 w-5 animate-spin"/> Processing...</>
                ) : (
                  <><Wand2 className="mr-2 h-5 w-5"/> Transform Data</>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="p-4 bg-destructive/10 text-destructive font-bold rounded-lg animate-in slide-in-from-top-2">
          {error}
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-8 animate-in fade-in zoom-in-95 duration-500">
          
          <div className="flex justify-between items-center bg-card p-6 border rounded-xl shadow-sm">
            <div>
              <h2 className="text-xl font-bold text-green-600">✅ File successfully processed!</h2>
              <p className="text-muted-foreground mt-1">Total transformed rows: <span className="font-bold text-foreground">{result.total_rows}</span></p>
            </div>
            <Button onClick={handleDownload} variant="default" size="lg" className="shadow-md rounded-xl font-bold">
              <Download className="w-5 h-5 mr-2" />
              Download Result (.xlsx)
            </Button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle>Gross Amount by New Category</CardTitle>
                <CardDescription>Aggregation of transformed categories</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer 
                  config={{ 
                    'Gross Amount': { label: 'Gross Amount', color: 'hsl(var(--primary))' } 
                  }} 
                  className="h-[300px] w-full"
                >
                  <BarChart data={result.chart_category} margin={{ top: 10, right: 10, bottom: 20, left: 20 }} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tickFormatter={(val) => `Rp${(val/1000).toFixed(0)}k`}/>
                    <YAxis dataKey="New Category" type="category" width={150} tick={{fontSize: 12}} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="Gross Amount" fill="var(--color-Gross-Amount)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle>Gross Amount by Source</CardTitle>
                <CardDescription>Aggregation of mapped lead sources</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer 
                  config={{ 
                    'Gross Amount': { label: 'Gross Amount', color: 'hsl(var(--chart-2))' } 
                  }} 
                  className="h-[300px] w-full"
                >
                  <BarChart data={result.chart_source} margin={{ top: 10, right: 10, bottom: 20, left: 20 }} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tickFormatter={(val) => `Rp${(val/1000).toFixed(0)}k`} />
                    <YAxis dataKey="Source" type="category" width={100} tick={{fontSize: 12}} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="Gross Amount" fill="var(--color-Gross-Amount)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </div>

          <Card className="shadow-sm overflow-hidden">
            <CardHeader className="bg-muted/30">
              <CardTitle>Preview Transformed Data Table</CardTitle>
              <CardDescription>Showing first 100 entries of the transformed results.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto max-h-[500px]">
                <Table>
                  <TableHeader className="bg-muted/50 sticky top-0 z-10 shadow-sm">
                    <TableRow>
                      {result.preview_data.length > 0 && Object.keys(result.preview_data[0]).map((key) => (
                        <TableHead key={key} className="whitespace-nowrap font-bold text-foreground">{key}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.preview_data.map((row, i) => (
                      <TableRow key={i}>
                        {Object.values(row).map((val: any, colIdx) => (
                          <TableCell key={colIdx} className="whitespace-nowrap">
                            {val !== null ? String(val) : '-'}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                    {result.preview_data.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center h-24 text-muted-foreground">No data found after transformations</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

        </div>
      )}
    </div>
  )
}
