'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatDateTime } from '@/lib/utils'
import { ConsentTemplateForm } from '@/components/consent/consent-template-form'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/hooks/queries/query-keys'
import { useRestoreDefaultConsentTemplates } from '@/hooks/mutations/use-consent-mutations'
import { PlusIcon, PencilIcon } from 'lucide-react'
import { CONSENT_TYPE_LABELS } from '@/lib/constants'
import { consentCoverage, type ConsentCoverage, type CoverageProcedureType } from '@/lib/consent-requirements'
import { consentTypes, DEFAULT_CONSENT_TEMPLATES } from '@/validations/consent'

interface ConsentTemplate {
  id: string
  type: string
  title: string
  content: string
  version: number
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

interface ConsentTemplateListProps {
  templates: ConsentTemplate[]
  procedureTypes: CoverageProcedureType[]
}

const DEFAULT_TEMPLATE_COUNT = Object.keys(DEFAULT_CONSENT_TEMPLATES).length

function typeOrder(type: string) {
  const index = (consentTypes as readonly string[]).indexOf(type)
  return index === -1 ? consentTypes.length : index
}

function coverageLabel(coverage: ConsentCoverage) {
  switch (coverage.kind) {
    case 'all':
      return 'Todos os procedimentos'
    case 'approval':
      return 'Todo plano aprovado'
    case 'manual':
      return 'Não exigido automaticamente'
    case 'procedures':
      return coverage.names.length > 0
        ? coverage.names.join(', ')
        : 'Nenhum procedimento desta categoria'
  }
}

function CategoryChip({ type }: { type: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-petal px-2.5 py-0.5 text-xs font-medium text-sage">
      {CONSENT_TYPE_LABELS[type] || type}
    </span>
  )
}

export function ConsentTemplateList({ templates, procedureTypes }: ConsentTemplateListProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const restoreDefaults = useRestoreDefaultConsentTemplates()
  const [createOpen, setCreateOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<ConsentTemplate | null>(null)

  function handleSuccess() {
    setCreateOpen(false)
    setEditingTemplate(null)
    queryClient.invalidateQueries({ queryKey: queryKeys.consent.all })
    router.refresh()
  }

  async function handleRestoreDefaults() {
    try {
      const { data } = await restoreDefaults.mutateAsync()
      toast.success(data.created > 0 ? `${data.created} modelos de termo criados` : 'Os modelos padrão já existem')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao criar os modelos padrão')
    }
  }

  const rows = [...templates]
    .sort((a, b) => typeOrder(a.type) - typeOrder(b.type))
    .map((template) => ({
      template,
      coverage: coverageLabel(consentCoverage(template.type, procedureTypes)),
    }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium text-charcoal">
            {templates.length} {templates.length === 1 ? 'modelo' : 'modelos'} de termo
          </h3>
          <p className="mt-1 text-xs text-mid">
            Modelos de termos de consentimento para assinatura pelos pacientes.
          </p>
        </div>
        <Button
          variant={templates.length === 0 ? 'outline' : 'default'}
          className="h-11 shrink-0 sm:h-8"
          onClick={() => setCreateOpen(true)}
        >
          <PlusIcon className="mr-1.5 size-4" />
          Novo termo
        </Button>
      </div>

      {templates.length === 0 ? (
        <div className="rounded-[3px] border border-dashed border-topbar-border px-6 py-8 text-center">
          <p className="text-sm text-charcoal">Nenhum modelo de termo cadastrado.</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-mid">
            Comece com os modelos padrão (consentimento geral, toxina, preenchedor, contrato de serviço e outros) e edite depois, ou clique em &quot;Novo termo&quot;.
          </p>
          <Button
            className="mt-4 h-11 sm:h-8"
            onClick={handleRestoreDefaults}
            disabled={restoreDefaults.isPending}
          >
            {restoreDefaults.isPending
              ? 'Criando modelos...'
              : `Usar modelos padrão (${DEFAULT_TEMPLATE_COUNT})`}
          </Button>
        </div>
      ) : (
        <>
          <div className="hidden sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Título</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Cobertura</TableHead>
                  <TableHead>Versão</TableHead>
                  <TableHead>Atualizado em</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ template, coverage }) => (
                  <TableRow key={template.id}>
                    <TableCell className="max-w-72 whitespace-normal break-words font-medium">
                      {template.title}
                    </TableCell>
                    <TableCell>
                      <CategoryChip type={template.type} />
                    </TableCell>
                    <TableCell className="max-w-64 whitespace-normal break-words text-sm text-mid">
                      {coverage}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">v{template.version}</TableCell>
                    <TableCell className="text-sm text-mid tabular-nums">
                      {formatDateTime(template.updatedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Editar ${template.title}`}
                        onClick={() => setEditingTemplate(template)}
                      >
                        <PencilIcon className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul className="divide-y divide-topbar-border rounded-[3px] border border-topbar-border sm:hidden">
            {rows.map(({ template, coverage }) => (
              <li key={template.id} className="flex items-start gap-2 py-3 pl-4 pr-1">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="break-words text-sm font-medium text-charcoal">{template.title}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <CategoryChip type={template.type} />
                    <span className="text-xs text-mid tabular-nums">v{template.version}</span>
                  </div>
                  <p className="break-words text-xs text-mid">{coverage}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 shrink-0"
                  aria-label={`Editar ${template.title}`}
                  onClick={() => setEditingTemplate(template)}
                >
                  <PencilIcon className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Novo Termo de Consentimento</DialogTitle>
          </DialogHeader>
          <ConsentTemplateForm
            activeTemplates={templates.filter((t) => t.isActive)}
            onSuccess={handleSuccess}
          />
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editingTemplate} onOpenChange={(open) => !open && setEditingTemplate(null)}>
        <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Termo (cria nova versão)</DialogTitle>
          </DialogHeader>
          {editingTemplate && (
            <ConsentTemplateForm
              template={editingTemplate}
              onSuccess={handleSuccess}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
