import { getAuthContext } from '@/lib/auth'
import { DiagramGroupPageClient } from './diagram-group-page-client'

interface DiagramGroupPageProps {
  params: Promise<{ id: string; groupId: string }>
}

export default async function DiagramGroupPage({ params }: DiagramGroupPageProps) {
  const { id, groupId } = await params
  const ctx = await getAuthContext()
  return <DiagramGroupPageClient patientId={id} groupId={groupId} role={ctx.role} />
}
