import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { getProcedureType } from '@/db/queries/tenants'
import { getTemplateForProcedureType } from '@/db/queries/evaluation-templates'
import { TemplateEditorPage } from './template-editor-page'

export const metadata: Metadata = {
  title: 'Ficha de Avaliacao | FloraClin',
}

interface PageProps {
  params: Promise<{ procedureTypeId: string }>
}

export default async function EvaluationTemplatePage({ params }: PageProps) {
  const { procedureTypeId } = await params
  const auth = await requireRole('owner')

  const procedureType = await getProcedureType(auth.tenantId, procedureTypeId)
  if (!procedureType) {
    redirect('/configuracoes')
  }

  const template = await getTemplateForProcedureType(auth.tenantId, procedureTypeId)

  return (
    <TemplateEditorPage
      procedureType={{
        id: procedureType.id,
        name: procedureType.name,
        category: procedureType.category,
      }}
      template={
        template
          ? {
              id: template.id,
              sections: template.sections as import('@/types/evaluation').EvaluationSection[],
              version: template.version,
            }
          : null
      }
    />
  )
}
