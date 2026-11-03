'use client'

import { notFound } from 'next/navigation'
import { usePatient } from '@/hooks/queries/use-patients'
import { useDiagramGroup } from '@/hooks/queries/use-face-diagram-groups'
import { DiagramGroupEditor } from '@/components/face-diagram-groups/diagram-group-editor'
import type { Role } from '@/types'

interface DiagramGroupPageClientProps {
  patientId: string
  groupId: string
  role: Role
}

export function DiagramGroupPageClient({ patientId, groupId, role }: DiagramGroupPageClientProps) {
  const { data: patient, isLoading: patientLoading } = usePatient(patientId)
  const { data: group, isLoading: groupLoading } = useDiagramGroup(groupId)

  if (patientLoading || groupLoading) {
    return <div className="flex items-center justify-center py-12 text-mid">Carregando...</div>
  }
  if (!patient || !group || group.patientId !== patientId) return notFound()

  return (
    <div className="p-4 md:p-6">
      <DiagramGroupEditor key={group.id} patient={patient} group={group} role={role} />
    </div>
  )
}
