'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Loader2, Stethoscope } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { WizardOverrides } from './types'

// ─── Types ──────────────────────────────────────────────────────────

interface ProcedureType {
  id: string
  name: string
  category: string
  defaultPrice: string | null
  estimatedDurationMin: number | null
}

interface ProcedureTypeStepProps {
  selectedTypeIds: string[]
  onSelectedTypeIdsChange: (typeIds: string[]) => void
  wizardOverrides?: WizardOverrides
  readOnly?: boolean
}

// ─── Component ──────────────────────────────────────────────────────

export function ProcedureTypeStep({
  selectedTypeIds,
  onSelectedTypeIdsChange,
  wizardOverrides,
  readOnly,
}: ProcedureTypeStepProps) {
  const [procedureTypes, setProcedureTypes] = useState<ProcedureType[]>([])
  const [loading, setLoading] = useState(true)

  // ─── Load procedure types ─────────────────────────────────────────
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/procedure-types')
        if (res.ok) {
          const types = await res.json()
          setProcedureTypes(types as ProcedureType[])
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // ─── Handle wizard triggerSave ─────────────────────────────────────
  const selectedTypeIdsRef = useRef(selectedTypeIds)
  selectedTypeIdsRef.current = selectedTypeIds
  const onSaveCompleteRef = useRef(wizardOverrides?.onSaveComplete)
  onSaveCompleteRef.current = wizardOverrides?.onSaveComplete
  const prevTriggerRef = useRef(wizardOverrides?.triggerSave ?? 0)

  useEffect(() => {
    const current = wizardOverrides?.triggerSave ?? 0
    // When the wizard resets triggerSave to 0 (after a save completes),
    // also reset our "seen" marker. Otherwise the next press increments
    // back to 1 and gets treated as a duplicate, silently skipping the save.
    if (current === 0) {
      prevTriggerRef.current = 0
      return
    }
    if (current === prevTriggerRef.current) {
      console.log('[step2] triggerSave effect SKIPPED — same value as prev', {
        current,
        prev: prevTriggerRef.current,
      })
      return
    }
    prevTriggerRef.current = current

    console.log('[step2] triggerSave effect firing', {
      current,
      selectedCount: selectedTypeIdsRef.current.length,
      selectedIds: selectedTypeIdsRef.current,
    })

    if (selectedTypeIdsRef.current.length === 0) {
      console.log('[step2] reporting validation error — no types selected')
      onSaveCompleteRef.current?.({
        success: false,
        error: 'Selecione ao menos um tipo de procedimento.',
        errorType: 'validation',
      })
      return
    }
    console.log('[step2] reporting success', {
      onSaveCompletePresent: !!onSaveCompleteRef.current,
    })
    onSaveCompleteRef.current?.({ success: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardOverrides?.triggerSave])

  // ─── Toggle handler ───────────────────────────────────────────────

  function handleToggle(typeId: string) {
    if (readOnly) return

    if (selectedTypeIds.includes(typeId)) {
      onSelectedTypeIdsChange(selectedTypeIds.filter((id) => id !== typeId))
    } else {
      onSelectedTypeIdsChange([...selectedTypeIds, typeId])
    }
  }

  // ─── Group by category ────────────────────────────────────────────

  const grouped = procedureTypes.reduce<Record<string, ProcedureType[]>>((acc, type) => {
    const cat = type.category || 'Outros'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(type)
    return acc
  }, {})

  const CATEGORY_LABELS: Record<string, string> = {
    botox: 'Toxina Botulínica',
    toxina_botulinica: 'Toxina Botulínica',
    filler: 'Preenchimento',
    preenchimento: 'Preenchimento',
    biostimulator: 'Bioestimulador',
    bioestimulador: 'Bioestimulador',
    skinbooster: 'Skinbooster',
    peel: 'Peeling',
    peeling: 'Peeling',
    laser: 'Laser',
    microagulhamento: 'Microagulhamento',
    fios: 'Fios',
    outros: 'Outros',
  }

  // ─── Render ───────────────────────────────────────────────────────

  return (
    <Card className="bg-white border-0 shadow-[0_1px_4px_rgba(0,0,0,0.06)] rounded-[3px]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2.5 text-base">
          <div className="flex size-7 items-center justify-center rounded-md bg-forest/5">
            <Stethoscope className="size-4 text-forest" />
          </div>
          <span className="uppercase tracking-wider text-sm text-[#2A2A2A] font-medium">
            Tipo de Procedimento
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-mid">
            <Loader2 className="size-4 animate-spin" />
            Carregando tipos...
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-mid">
              Selecione um ou mais tipos de procedimento (o primeiro será o principal).
            </p>

            {Object.entries(grouped).map(([category, types]) => (
              <div key={category} className="space-y-2">
                <p className="text-xs font-medium text-mid uppercase tracking-wider">
                  {CATEGORY_LABELS[category.toLowerCase()] ?? category}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {types.map((type) => {
                    const isSelected = selectedTypeIds.includes(type.id)
                    const isPrimary = selectedTypeIds[0] === type.id

                    return (
                      <button
                        key={type.id}
                        type="button"
                        onClick={() => handleToggle(type.id)}
                        disabled={readOnly}
                        className={cn(
                          'flex items-center gap-3 rounded-[3px] border p-3 text-left text-sm transition-colors',
                          isSelected
                            ? 'border-sage bg-sage/5 text-charcoal'
                            : 'border-[#E8ECEF] bg-white text-mid hover:border-sage/50 hover:bg-[#F4F6F8]',
                          readOnly && 'cursor-default opacity-70',
                        )}
                      >
                        <div
                          className={cn(
                            'flex size-5 shrink-0 items-center justify-center rounded-[3px] border-2 transition-colors',
                            isSelected ? 'border-sage bg-sage' : 'border-[#E8ECEF]',
                          )}
                        >
                          {isSelected && (
                            <svg
                              className="size-3 text-white"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={3}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-charcoal">{type.name}</span>
                          {type.defaultPrice && (
                            <span className="ml-2 text-xs text-mid">
                              R$ {parseFloat(type.defaultPrice).toFixed(2)}
                            </span>
                          )}
                          {isPrimary && (
                            <span className="ml-2 text-xs text-sage font-medium">
                              (principal)
                            </span>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
