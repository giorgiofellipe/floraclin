'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { Loader2, Plus, Syringe, Calendar } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatDateTime } from '@/lib/utils'
import { listProceduresAction } from '@/actions/procedures'

interface ProcedureRecord {
  id: string
  procedureTypeName: string
  practitionerName: string
  performedAt: Date | string
  status: string
  technique: string | null
  clinicalResponse: string | null
  notes: string | null
}

const STATUS_LABELS: Record<string, string> = {
  in_progress: 'Em andamento',
  completed: 'Concluído',
  cancelled: 'Cancelado',
}

const STATUS_STYLES: Record<string, string> = {
  in_progress: 'bg-amber-light text-amber-dark',
  completed: 'bg-[#F0F7F1] text-sage',
  cancelled: 'bg-red-100 text-red-800',
}

interface PatientProceduresTabProps {
  patientId: string
}

export function PatientProceduresTab({ patientId }: PatientProceduresTabProps) {
  const [procedures, setProcedures] = useState<ProcedureRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [, startTransition] = useTransition()

  const loadProcedures = useCallback(() => {
    startTransition(async () => {
      try {
        const result = await listProceduresAction(patientId)
        if (result.success && result.data) {
          setProcedures(result.data as unknown as ProcedureRecord[])
        } else {
          setProcedures([])
        }
      } catch {
        setProcedures([])
      } finally {
        setLoading(false)
      }
    })
  }, [patientId])

  useEffect(() => {
    loadProcedures()
  }, [loadProcedures])

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
      <div className="flex items-center justify-between">
        <p className="text-sm text-mid">
          {procedures.length} {procedures.length === 1 ? 'procedimento' : 'procedimentos'}
        </p>
        <Link
          href={`/pacientes/${patientId}/procedimentos/novo`}
          className="inline-flex items-center justify-center rounded-md bg-forest px-4 py-2 text-sm font-medium text-cream hover:bg-sage transition-colors"
        >
          <Plus className="size-4 mr-1" />
          Novo Procedimento
        </Link>
      </div>

      {procedures.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-mid">
          <Syringe className="mb-2 size-8" />
          <p className="text-sm">Nenhum procedimento registrado</p>
          <p className="text-xs mt-1">
            Clique em &quot;Novo Procedimento&quot; para registrar o primeiro.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {procedures.map((proc) => (
            <div
              key={proc.id}
              className="rounded-lg border bg-white p-4 transition-shadow hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-charcoal truncate">
                      {proc.procedureTypeName}
                    </h3>
                    <Badge className={STATUS_STYLES[proc.status] ?? 'bg-[#F0F7F1] text-sage'}>
                      {STATUS_LABELS[proc.status] ?? proc.status}
                    </Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-mid">
                    <span className="flex items-center gap-1">
                      <Calendar className="size-3" />
                      {formatDateTime(proc.performedAt)}
                    </span>
                    <span>por {proc.practitionerName}</span>
                  </div>
                  {proc.technique && (
                    <p className="mt-2 text-sm text-charcoal">
                      <span className="text-mid">Técnica:</span> {proc.technique}
                    </p>
                  )}
                  {proc.clinicalResponse && (
                    <p className="text-sm text-charcoal">
                      <span className="text-mid">Resposta clínica:</span> {proc.clinicalResponse}
                    </p>
                  )}
                  {proc.notes && (
                    <p className="mt-1 text-xs text-mid">{proc.notes}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
