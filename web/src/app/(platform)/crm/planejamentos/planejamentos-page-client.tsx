'use client'

import { useMemo, useState } from 'react'
import { ClipboardList, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { PlanejamentosTable } from '@/components/planejamentos/planejamentos-table'
import { useOpenPlanejamentos } from '@/hooks/queries/use-planejamentos'
import { usePractitioners } from '@/hooks/queries/use-appointments'
import { useProcedureTypes } from '@/hooks/queries/use-procedure-types'

interface PractitionerOption {
  id: string
  fullName: string
}

interface ProcedureTypeOption {
  id: string
  name: string
}

const ALL_VALUE = '__all__'

export function PlanejamentosPageClient() {
  const [practitionerId, setPractitionerId] = useState<string | undefined>(undefined)
  const [procedureTypeId, setProcedureTypeId] = useState<string | undefined>(undefined)
  const [includeSnoozed, setIncludeSnoozed] = useState(false)
  const [minValue, setMinValue] = useState<string>('')
  const [maxValue, setMaxValue] = useState<string>('')

  const filters = useMemo(
    () => ({ practitionerId, procedureTypeId, includeSnoozed }),
    [practitionerId, procedureTypeId, includeSnoozed],
  )

  const { data, isLoading, refetch, isFetching } = useOpenPlanejamentos(filters)
  const rawRows = useMemo(() => data?.data ?? [], [data])

  const { data: practitioners } = usePractitioners()
  const { data: procedureTypesRes } = useProcedureTypes()

  const practitionerItems = useMemo(() => {
    const map: Record<string, string> = { [ALL_VALUE]: 'Todos os profissionais' }
    const list = (practitioners as PractitionerOption[] | undefined) ?? []
    for (const p of list) {
      map[p.id] = p.fullName
    }
    return map
  }, [practitioners])

  const procedureTypeItems = useMemo(() => {
    const map: Record<string, string> = { [ALL_VALUE]: 'Todos os procedimentos' }
    const list = (procedureTypesRes as ProcedureTypeOption[] | undefined) ?? []
    for (const t of list) {
      map[t.id] = t.name
    }
    return map
  }, [procedureTypesRes])

  // Apply client-side value range filtering (backend ignores it for now)
  const filteredRows = useMemo(() => {
    const min = minValue ? Number(minValue) : null
    const max = maxValue ? Number(maxValue) : null
    if (min === null && max === null) return rawRows
    return rawRows.filter((row) => {
      const amount = row.totalAmount != null ? Number(row.totalAmount) : null
      if (min !== null && (amount === null || amount < min)) return false
      if (max !== null && (amount === null || amount > max)) return false
      return true
    })
  }, [rawRows, minValue, maxValue])

  const totalOpen = rawRows.length
  const totalAfterFilter = filteredRows.length

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-[24px] font-medium text-[#2A2A2A]">
            <ClipboardList className="h-5 w-5 text-sage" />
            Planejamentos abertos
          </h1>
          <p className="mt-1 text-[13px] text-[#7A7A7A]">
            {isLoading
              ? 'Carregando...'
              : totalAfterFilter === totalOpen
                ? `${totalOpen} planejamento${totalOpen !== 1 ? 's' : ''} aguardando contato`
                : `${totalAfterFilter} de ${totalOpen} planejamento${totalOpen !== 1 ? 's' : ''}`}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw
            className={`mr-1 h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`}
          />
          Atualizar
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-lg border border-input bg-card p-3 md:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1">
          <Label className="text-xs uppercase tracking-wider text-mid">
            Profissional
          </Label>
          <Select
            items={practitionerItems}
            value={practitionerId ?? ALL_VALUE}
            onValueChange={(v) =>
              setPractitionerId(v === ALL_VALUE || !v ? undefined : v)
            }
          >
            <SelectTrigger className="h-8 w-full">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent />
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs uppercase tracking-wider text-mid">
            Procedimento
          </Label>
          <Select
            items={procedureTypeItems}
            value={procedureTypeId ?? ALL_VALUE}
            onValueChange={(v) =>
              setProcedureTypeId(v === ALL_VALUE || !v ? undefined : v)
            }
          >
            <SelectTrigger className="h-8 w-full">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent />
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="min-value" className="text-xs uppercase tracking-wider text-mid">
            Valor mín. (R$)
          </Label>
          <input
            id="min-value"
            type="number"
            inputMode="decimal"
            min={0}
            step={1}
            value={minValue}
            onChange={(e) => setMinValue(e.target.value)}
            placeholder="0"
            className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm transition-colors focus:border-ring focus:ring-3 focus:ring-ring/50 focus:outline-none"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="max-value" className="text-xs uppercase tracking-wider text-mid">
            Valor máx. (R$)
          </Label>
          <input
            id="max-value"
            type="number"
            inputMode="decimal"
            min={0}
            step={1}
            value={maxValue}
            onChange={(e) => setMaxValue(e.target.value)}
            placeholder="Sem limite"
            className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm transition-colors focus:border-ring focus:ring-3 focus:ring-ring/50 focus:outline-none"
          />
        </div>

        <div className="flex items-end pb-1">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Switch
              checked={includeSnoozed}
              onCheckedChange={(checked) => setIncludeSnoozed(Boolean(checked))}
            />
            <span>Incluir adiados</span>
          </label>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <PlanejamentosTable rows={filteredRows} showSnoozeBadge={includeSnoozed} />
      )}
    </div>
  )
}
