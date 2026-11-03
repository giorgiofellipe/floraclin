import { getAuthContext } from '@/lib/auth'
import { NewDiagramPageClient } from './new-diagram-page-client'

interface NewDiagramPageProps {
  params: Promise<{ id: string }>
}

export default async function NewDiagramPage({ params }: NewDiagramPageProps) {
  const { id } = await params
  const ctx = await getAuthContext()
  return <NewDiagramPageClient patientId={id} role={ctx.role} />
}
