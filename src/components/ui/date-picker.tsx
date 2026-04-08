"use client"

import * as React from "react"
import { format, parse, isValid } from "date-fns"
import { ptBR } from "date-fns/locale"
import { CalendarIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface DatePickerProps {
  /** Value as YYYY-MM-DD string */
  value?: string
  /** Called with YYYY-MM-DD string */
  onChange?: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  /** Min date as YYYY-MM-DD */
  minDate?: string
  /** Max date as YYYY-MM-DD */
  maxDate?: string
  /** Show year/month dropdowns for quick navigation (useful for birth dates) */
  showYearNavigation?: boolean
  /** Year range for dropdown. Default: 100 years back to 10 years forward */
  yearRange?: { from: number; to: number }
}

function parseDate(str: string | undefined): Date | undefined {
  if (!str) return undefined
  const d = parse(str, "yyyy-MM-dd", new Date())
  return isValid(d) ? d : undefined
}

function formatDateStr(date: Date): string {
  return format(date, "yyyy-MM-dd")
}

const MONTHS_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

function maskDateInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

function parseBrDate(str: string): Date | undefined {
  const match = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!match) return undefined
  const d = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]))
  return isValid(d) ? d : undefined
}

function DatePicker({
  value,
  onChange,
  placeholder = "Selecionar data",
  className,
  disabled = false,
  minDate,
  maxDate,
  showYearNavigation = false,
  yearRange,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false)
  const [typedValue, setTypedValue] = React.useState("")
  const [isTyping, setIsTyping] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const selected = parseDate(value)
  const fromDate = parseDate(minDate)
  const toDate = parseDate(maxDate)

  const currentYear = new Date().getFullYear()
  const defaultYearRange = { from: currentYear - 100, to: currentYear + 10 }
  const range = yearRange ?? defaultYearRange

  const [viewMonth, setViewMonth] = React.useState<Date>(selected ?? new Date())

  // Sync viewMonth when value changes externally (depend on string, not Date object)
  React.useEffect(() => {
    if (value) {
      const d = parseDate(value)
      if (d) setViewMonth(d)
    }
  }, [value])

  const yearItems = React.useMemo(() => {
    const items: Record<string, string> = {}
    for (let y = range.to; y >= range.from; y--) {
      items[String(y)] = String(y)
    }
    return items
  }, [range.from, range.to])

  const monthItems = React.useMemo(() => {
    const items: Record<string, string> = {}
    MONTHS_PT.forEach((name, i) => { items[String(i)] = name })
    return items
  }, [])

  const handleTypedCommit = React.useCallback((str: string) => {
    const parsed = parseBrDate(str)
    if (parsed) {
      onChange?.(formatDateStr(parsed))
    }
    setIsTyping(false)
    setTypedValue("")
  }, [onChange])

  return (
    <Popover open={open} onOpenChange={(o) => {
      setOpen(o)
      if (!o) { setIsTyping(false); setTypedValue("") }
    }}>
      <PopoverTrigger
        disabled={disabled}
        nativeButton={false}
        render={
          <div
            className={cn(
              "flex h-8 w-full items-center rounded-lg border border-input bg-transparent text-sm transition-colors",
              "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
              disabled && "cursor-not-allowed opacity-50",
              "hover:border-sage/40",
              className
            )}
          />
        }
        onClick={(e) => {
          // Only open calendar when clicking the icon, not the text
          if ((e.target as HTMLElement).closest('[data-date-input]')) {
            e.preventDefault()
          }
        }}
      >
        {isTyping ? (
          <input
            ref={inputRef}
            data-date-input
            type="text"
            inputMode="numeric"
            value={typedValue}
            placeholder="dd/mm/aaaa"
            className="flex-1 min-w-0 h-full bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground"
            onChange={(e) => setTypedValue(maskDateInput(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleTypedCommit(typedValue)
              } else if (e.key === 'Escape') {
                setIsTyping(false)
                setTypedValue("")
              }
            }}
            onBlur={() => {
              if (typedValue.length === 10) {
                handleTypedCommit(typedValue)
              } else {
                setIsTyping(false)
                setTypedValue("")
              }
            }}
          />
        ) : (
          <span
            data-date-input
            className={cn(
              "flex-1 min-w-0 h-full flex items-center px-2.5 cursor-text select-none truncate",
              !selected && "text-muted-foreground"
            )}
            onClick={() => {
              if (disabled) return
              setIsTyping(true)
              setTypedValue(selected ? format(selected, "dd/MM/yyyy") : "")
              setTimeout(() => inputRef.current?.focus(), 0)
            }}
          >
            {selected ? format(selected, "dd/MM/yyyy") : "dd/mm/aaaa"}
          </span>
        )}
        <span className="shrink-0 px-2 flex items-center text-mid hover:text-charcoal transition-colors cursor-pointer">
          <CalendarIcon className="h-3.5 w-3.5" />
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        {/* Year/month quick navigation */}
        {showYearNavigation && (
          <div className="flex items-center gap-1.5 px-3 pt-3 pb-1">
            <Select
              items={monthItems}
              value={String(viewMonth.getMonth())}
              onValueChange={(v) => {
                if (v == null) return
                const d = new Date(viewMonth)
                d.setMonth(Number(v))
                setViewMonth(d)
              }}
            >
              <SelectTrigger className="h-7 w-[110px] text-xs border-sage/20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS_PT.map((name, i) => (
                  <SelectItem key={i} value={String(i)}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              items={yearItems}
              value={String(viewMonth.getFullYear())}
              onValueChange={(v) => {
                if (v == null) return
                const d = new Date(viewMonth)
                d.setFullYear(Number(v))
                setViewMonth(d)
              }}
            >
              <SelectTrigger className="h-7 w-[80px] text-xs border-sage/20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: range.to - range.from + 1 }, (_, i) => {
                  const y = range.to - i
                  return <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                })}
              </SelectContent>
            </Select>
          </div>
        )}
        <Calendar
          mode="single"
          selected={selected}
          month={showYearNavigation ? viewMonth : undefined}
          onMonthChange={showYearNavigation ? setViewMonth : undefined}
          onSelect={(date) => {
            if (date) {
              onChange?.(formatDateStr(date))
            } else {
              onChange?.("")
            }
            setOpen(false)
          }}
          locale={ptBR}
          defaultMonth={selected}
          disabled={[
            ...(fromDate ? [{ before: fromDate }] : []),
            ...(toDate ? [{ after: toDate }] : []),
          ]}
          classNames={{
            today: "rounded-(--cell-radius) bg-sage/15 text-forest font-semibold data-[selected=true]:rounded-none",
          }}
          components={{
            DayButton: ({ className: dayClassName, day, modifiers, ...props }) => (
              <button
                type="button"
                data-selected-single={
                  modifiers.selected &&
                  !modifiers.range_start &&
                  !modifiers.range_end &&
                  !modifiers.range_middle
                }
                className={cn(
                  "relative flex aspect-square w-full min-w-(--cell-size) items-center justify-center rounded-(--cell-radius) text-sm font-normal transition-colors",
                  "hover:bg-sage/10 hover:text-forest",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage/50",
                  "data-[selected-single=true]:bg-forest data-[selected-single=true]:text-cream data-[selected-single=true]:font-medium",
                  "disabled:pointer-events-none disabled:opacity-30",
                  modifiers.outside && "text-mid/40",
                  dayClassName
                )}
                {...props}
              />
            ),
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

interface DateRangePickerProps {
  dateFrom?: string
  dateTo?: string
  onDateFromChange?: (value: string) => void
  onDateToChange?: (value: string) => void
  className?: string
}

function DateRangePicker({
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  className,
}: DateRangePickerProps) {
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <DatePicker
        value={dateFrom}
        onChange={onDateFromChange}
        placeholder="De"
        maxDate={dateTo}
        className="w-[160px]"
      />
      <span className="text-mid text-xs select-none">—</span>
      <DatePicker
        value={dateTo}
        onChange={onDateToChange}
        placeholder="Até"
        minDate={dateFrom}
        className="w-[160px]"
      />
    </div>
  )
}

export { DatePicker, DateRangePicker }
