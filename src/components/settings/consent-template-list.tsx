'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
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
import { PlusIcon, PencilIcon } from 'lucide-react'

const CONSENT_TYPE_LABELS: Record<string, string> = {
  general: 'Geral',
  botox: 'Toxina Botulínica',
  filler: 'Preenchimento',
  biostimulator: 'Bioestimulador',
  custom: 'Personalizado',
}

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
  embedded?: boolean
}

export function ConsentTemplateList({ templates, embedded = false }: ConsentTemplateListProps) {
  const [createOpen, setCreateOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<ConsentTemplate | null>(null)

  const grouped = templates.reduce<Record<string, ConsentTemplate[]>>((acc, template) => {
    if (!acc[template.type]) {
      acc[template.type] = []
    }
    acc[template.type].push(template)
    return acc
  }, {})

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-[#2A2A2A]">
            {templates.length} {templates.length === 1 ? 'modelo' : 'modelos'} de termo
          </h3>
          <p className="mt-1 text-xs text-mid">
            Modelos de termos de consentimento para assinatura pelos pacientes.
          </p>
        </div>
        {!embedded && (
          <Button
            className="bg-forest text-cream hover:bg-sage transition-colors"
            onClick={() => setCreateOpen(true)}
          >
            <PlusIcon className="mr-1.5 size-4" />
            Novo Termo
          </Button>
        )}
      </div>

      {templates.length === 0 ? (
        <div className="rounded-[3px] border border-dashed border-[#E8ECEF] p-8 text-center">
          <p className="text-sm text-mid">
            Nenhum modelo de termo cadastrado.
          </p>
          <p className="mt-1 text-xs text-mid">
            Clique em &quot;Novo Termo&quot; para criar o primeiro modelo.
          </p>
        </div>
      ) : (
        Object.entries(grouped).map(([type, typeTemplates]) => (
          <div key={type} className="space-y-2">
            <h4 className="text-[10px] font-medium uppercase tracking-[0.15em] text-mid">
              {CONSENT_TYPE_LABELS[type] || type}
            </h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Título</TableHead>
                  <TableHead>Versão</TableHead>
                  <TableHead>Status</TableHead>
                  {!embedded && <TableHead>Atualizado em</TableHead>}
                  {!embedded && <TableHead className="text-right">Ações</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {typeTemplates.map((template) => (
                  <TableRow key={template.id}>
                    <TableCell className="font-medium">{template.title}</TableCell>
                    <TableCell>
                      <Badge variant="outline">v{template.version}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        template.isActive
                          ? 'bg-[#F0F7F1] text-sage'
                          : 'bg-[#F4F6F8] text-mid'
                      }`}>
                        {template.isActive ? 'Ativo' : 'Inativo'}
                      </span>
                    </TableCell>
                    {!embedded && (
                      <TableCell className="text-mid text-sm">
                        {formatDateTime(template.updatedAt)}
                      </TableCell>
                    )}
                    {!embedded && (
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setEditingTemplate(template)}
                        >
                          <PencilIcon className="size-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ))
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Novo Termo de Consentimento</DialogTitle>
          </DialogHeader>
          <ConsentTemplateForm
            onSuccess={() => setCreateOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editingTemplate} onOpenChange={(open) => !open && setEditingTemplate(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Termo (cria nova versão)</DialogTitle>
          </DialogHeader>
          {editingTemplate && (
            <ConsentTemplateForm
              template={editingTemplate}
              onSuccess={() => setEditingTemplate(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
