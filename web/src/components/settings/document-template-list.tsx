'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { FileText, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  useDocumentTemplates,
  useDeleteDocumentTemplate,
  type DocumentTemplateRow,
} from '@/hooks/queries/use-document-templates'
import { DocumentTemplateForm } from './document-template-form'
import type { ClinicalDocumentKind } from '@/validations/clinical-document'

export interface DocumentTemplateListProps {
  kind: ClinicalDocumentKind
}

export function DocumentTemplateList({ kind }: DocumentTemplateListProps) {
  const { data, isLoading } = useDocumentTemplates({ kind, includeInactive: true })
  const deleteMutation = useDeleteDocumentTemplate()

  const [editorOpen, setEditorOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<DocumentTemplateRow | null>(null)

  function openCreate() {
    setEditing(null)
    setEditorOpen(true)
  }

  function openEdit(t: DocumentTemplateRow) {
    setEditing(t)
    setEditorOpen(true)
  }

  async function handleDelete(t: DocumentTemplateRow) {
    if (!window.confirm(`Excluir o modelo "${t.name}"? Esta ação é reversível apenas pelo suporte.`)) {
      return
    }
    try {
      await deleteMutation.mutateAsync(t.id)
      toast.success('Modelo excluído')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao excluir')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openCreate} size="sm" className="bg-forest text-cream hover:bg-sage">
          <Plus className="size-3.5" />
          Novo modelo
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <div className="rounded-[3px] border border-dashed border-[#E8ECEF] p-8 text-center">
          <FileText className="mx-auto mb-2 size-8 text-mid/40" />
          <p className="text-sm text-mid">
            Nenhum modelo de {kind === 'receita' ? 'receita' : 'atestado'} cadastrado.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {data.map((t) => (
            <li
              key={t.id}
              className="flex items-start gap-3 rounded-[3px] border border-[#E8ECEF] bg-white p-3"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-charcoal">{t.name}</span>
                  {!t.isActive && (
                    <Badge variant="outline" className="text-[10px]">
                      Inativo
                    </Badge>
                  )}
                </div>
                <p className="line-clamp-2 whitespace-pre-wrap text-xs text-mid/80">
                  {t.body}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => openEdit(t)}
                  title="Editar"
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => handleDelete(t)}
                  disabled={deleteMutation.isPending}
                  title="Excluir"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <DocumentTemplateForm
        open={editorOpen}
        onOpenChange={setEditorOpen}
        template={editing}
        defaultKind={kind}
      />
    </div>
  )
}
