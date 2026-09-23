"use client"

import * as React from "react"
import { format } from "date-fns"
import { CalendarIcon } from "lucide-react"
import { DateRange } from "react-day-picker"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

interface DateRangePickerProps {
  value?: DateRange
  onChange?: (range: DateRange | undefined) => void
  className?: string
  placeholder?: string
}

export function DateRangePicker({
  value,
  onChange,
  className,
  placeholder = "Pick a date range",
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false)
  const [internalRange, setInternalRange] = React.useState<DateRange | undefined>(value)
  const [selectingEnd, setSelectingEnd] = React.useState(false)

  // Sync internal state when value changes externally (e.g., presets)
  React.useEffect(() => {
    setInternalRange(value)
  }, [value])

  const handleDayClick = (day: Date) => {
    if (!selectingEnd || !internalRange?.from) {
      setInternalRange({ from: day, to: undefined })
      setSelectingEnd(true)
      return
    }

    const range = day < internalRange.from
      ? { from: day, to: internalRange.from }
      : { from: internalRange.from, to: day }

    setInternalRange(range)
    onChange?.(range)
    setSelectingEnd(false)
    setOpen(false)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)

    if (!nextOpen) {
      setSelectingEnd(false)
      setInternalRange(value)
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal={true}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-[280px] justify-start text-left font-normal",
            !value && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {value?.from ? (
            value.to ? (
              <>
                {format(value.from, "dd MMM yyyy")} - {format(value.to, "dd MMM yyyy")}
              </>
            ) : (
              format(value.from, "dd MMM yyyy")
            )
          ) : (
            <span>{placeholder}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
        <Calendar
          mode="range"
          defaultMonth={internalRange?.from || value?.from}
          selected={internalRange}
          onDayClick={handleDayClick}
          numberOfMonths={1}
        />
      </PopoverContent>
    </Popover>
  )
}
