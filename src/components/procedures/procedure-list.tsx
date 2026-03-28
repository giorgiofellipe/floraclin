'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Loader2, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProcedureCard } from './procedure-card'
import { listProceduresAction } from '@/actions/procedures'
import type { ProcedureListItem } from '@/db/queries/procedures'

// ─── Types ──────────────────────────────────────────────────────────

interface ProcedureListProps {
  patientId: string
}

// ─── Component ──────────────────────────────────────────────────────

export function ProcedureList({ patientId }: ProcedureListProps) {
  const router = useRouter()
  const [procedures, setProcedures] = useState<ProcedureListItem[]>([])
  const [loading, setLoading] = useState(true)

  const loadProcedures = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listProceduresAction(patientId)
      if (result.success && result.data) {
        setProcedures(result.data)
      }
    } finally {
      setLoading(false)
    }
  }, [patientId])

  useEffect(() => {
    loadProcedures()
  }, [loadProcedures])

  const handleNewProcedure = () => {
    router.push(`/pacientes/${patientId}/procedimentos/novo`)
  }

  const handleProcedureClick = (procedureId: string) => {
    router.push(`/pacientes/${patientId}/procedimentos/${procedureId}`)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-mid" />
        <span className="ml-2 text-sm text-mid">Carregando procedimentos...</span>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header with "New Procedure" button */}
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg text-forest">
          Evolucao Clinica
        </h2>
        <Button
          onClick={handleNewProcedure}
          className="bg-forest text-cream hover:bg-sage"
        >
          <Plus className="mr-2 size-4" />
          Novo Procedimento
        </Button>
      </div>

      {/* Vertical timeline */}
      {procedures.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-cream/50 py-16">
          <FileText className="mb-3 size-10 text-mid/40" />
          <p className="text-sm font-medium text-mid">
            Nenhum procedimento registrado
          </p>
          <p className="mt-1 text-xs text-mid/60">
            Clique em &quot;Novo Procedimento&quot; para registrar o primeiro atendimento.
          </p>
        </div>
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-6 top-0 bottom-0 w-px bg-sage/20" />

          {/* Procedure cards */}
          <div className="space-y-3">
            {procedures.map((procedure, index) => (
              <div key={procedure.id} className="relative pl-14">
                {/* Timeline dot */}
                <div className="absolute left-[19px] top-5 size-3 rounded-full border-2 border-sage bg-white" />

                <ProcedureCard
                  procedure={procedure}
                  onClick={() => handleProcedureClick(procedure.id)}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
