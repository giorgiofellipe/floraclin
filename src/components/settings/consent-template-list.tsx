'use client'

import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDateTime } from '@/lib/utils'

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
  /** When embedded in wizard, simplifies the layout */
  embedded?: boolean
}

export function ConsentTemplateList({ templates, embedded = false }: ConsentTemplateListProps) {
  // Group templates by type
  const grouped = templates.reduce<Record<string, ConsentTemplate[]>>((acc, template) => {
    if (!acc[template.type]) {
      acc[template.type] = []
    }
    acc[template.type].push(template)
    return acc
  }, {})

  if (templates.length === 0) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhum modelo de termo cadastrado.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Os modelos de termos de consentimento podem ser gerenciados no módulo de Termos.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-foreground">
          {templates.length} {templates.length === 1 ? 'modelo' : 'modelos'} de termo
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Modelos de termos de consentimento utilizados para assinatura pelos pacientes.
        </p>
      </div>

      {Object.entries(grouped).map(([type, typeTemplates]) => (
        <div key={type} className="space-y-2">
          <h4 className="text-sm font-medium text-foreground">
            {CONSENT_TYPE_LABELS[type] || type}
          </h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Título</TableHead>
                <TableHead>Versão</TableHead>
                <TableHead>Status</TableHead>
                {!embedded && <TableHead>Atualizado em</TableHead>}
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
                    <Badge variant={template.isActive ? 'secondary' : 'outline'}>
                      {template.isActive ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </TableCell>
                  {!embedded && (
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(template.updatedAt)}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ))}
    </div>
  )
}
