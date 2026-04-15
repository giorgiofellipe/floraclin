'use client'

import { useRouter } from 'next/navigation'
import { Plus, Loader2, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProcedureCard } from './procedure-card'
import { useProcedures } from '@/hooks/queries/use-procedures'
import type { ProcedureListItem } from '@/db/queries/procedures'

// ─── Types ──────────────────────────────────────────────────────────

interface ProcedureListProps {
  patientId: string
}

// ─── Component ──────────────────────────────────────────────────────

export function ProcedureList({ patientId }: ProcedureListProps) {
  const router = useRouter()
  const { data: proceduresResult, isLoading: loading } = useProcedures(patientId)
  const procedures: ProcedureListItem[] = proceduresResult ?? []

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
    <div className="space-y-5">
      {/* Header with "New Procedure" button */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-[#2A2A2A]">
          Evolução Clínica
        </h2>
        <Button
          onClick={handleNewProcedure}
          className="bg-forest text-cream hover:bg-sage transition-colors"
        >
          <Plus className="mr-2 size-4" />
          Novo Procedimento
        </Button>
      </div>

      {/* Vertical timeline */}
      {procedures.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[3px] border border-dashed border-sage/20 bg-white py-16">
          <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-white">
            <FileText className="size-6 text-mid/50" />
          </div>
          <p className="text-sm font-medium text-mid">
            Nenhum procedimento registrado
          </p>
          <p className="mt-1.5 text-xs text-mid/60">
            Clique em &quot;Novo Procedimento&quot; para registrar o primeiro atendimento.
          </p>
        </div>
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-6 top-0 bottom-0 w-px bg-gradient-to-b from-sage/30 via-sage/20 to-sage/5" />

          {/* Procedure cards */}
          <div className="space-y-3">
            {procedures.map((procedure) => (
              <div key={procedure.id} className="group relative pl-14">
                {/* Timeline dot */}
                <div className="absolute left-[19px] top-5 size-3 rounded-full border-2 border-sage bg-white shadow-sm transition-colors group-hover:bg-sage/20" />

                <ProcedureCard
                  procedure={procedure}
                  patientId={patientId}
                  onClick={() => handleProcedureClick(procedure.id)}
                  onStatusChange={() => {}}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
