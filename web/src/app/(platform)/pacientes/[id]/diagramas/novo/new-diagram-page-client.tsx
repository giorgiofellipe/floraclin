'use client'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { usePatient } from '@/hooks/queries/use-patients'
import { DiagramGroupEditor } from '@/components/face-diagram-groups/diagram-group-editor'
import type { Role } from '@/types'

export function NewDiagramPageClient({ patientId, role }: { patientId: string; role: Role }) {
  const { data: patient, isLoading } = usePatient(patientId)

  if (isLoading) {
    return <div className="flex items-center justify-center py-12 text-mid">Carregando...</div>
  }
  if (!patient) return notFound()

  if (role !== 'owner' && role !== 'practitioner') {
    return (
      <div className="mx-auto max-w-xl p-6 text-center">
        <p className="text-sm text-mid">Você não tem permissão para criar diagramas.</p>
        <Link
          href={`/pacientes/${patientId}?tab=diagramas`}
          className="mt-3 inline-flex items-center gap-1 text-sm text-sage hover:text-forest"
        >
          <ArrowLeft className="size-4" />
          Voltar para Diagramas
        </Link>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6">
      <DiagramGroupEditor patient={patient} group={null} role={role} />
    </div>
  )
}
