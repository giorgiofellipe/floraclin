'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { FileText, Send, Search, ArrowLeft } from 'lucide-react'
import { PURPOSE_LABELS } from '@/lib/whatsapp-blueprints'

interface VariableMapping {
  index: number
  key: string
  label: string
  example: string
}

interface Template {
  id: string
  name: string
  language: string
  category: string
  body: string
  status: string
  purposeKey: string | null
  variableMapping: VariableMapping[] | null
}

interface TemplatePickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelectTemplate: (templateName: string, language: string, params?: Record<string, string>) => void
  sending?: boolean
}

export function TemplatePicker({
  open,
  onOpenChange,
  onSelectTemplate,
  sending,
}: TemplatePickerProps) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null)
  const [variableValues, setVariableValues] = useState<Record<number, string>>({})

  const fetchTemplates = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/whatsapp/templates')
      if (!res.ok) throw new Error('Erro ao carregar templates')
      const data = await res.json()
      const allTemplates = (data.data ?? []) as Array<Record<string, unknown>>
      const approved = allTemplates
        .filter((t) => t.status === 'APPROVED')
        .map((t) => {
          const components = t.components as Array<Record<string, unknown>> | undefined
          const bodyComp = components?.find((c) => c.type === 'BODY')
          return {
            id: t.id as string,
            name: t.name as string,
            language: t.language as string,
            category: t.category as string,
            body: (bodyComp?.text as string) ?? '',
            status: t.status as string,
            purposeKey: (t.purposeKey as string) ?? null,
            variableMapping: (t.variableMapping as VariableMapping[]) ?? null,
          }
        })
      setTemplates(approved)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      fetchTemplates()
      setSelectedTemplate(null)
      setVariableValues({})
      setSearch('')
    }
  }, [open, fetchTemplates])

  function handleSelectTemplate(template: Template) {
    if (template.variableMapping && template.variableMapping.length > 0) {
      setSelectedTemplate(template)
      setVariableValues({})
    } else {
      onSelectTemplate(template.name, template.language)
    }
  }

  function handleSendWithVariables() {
    if (!selectedTemplate) return
    const mapping = selectedTemplate.variableMapping ?? []
    const params: Record<string, string> = {}
    for (const v of mapping) {
      params[String(v.index)] = variableValues[v.index] || v.example
    }
    onSelectTemplate(selectedTemplate.name, selectedTemplate.language, params)
    setSelectedTemplate(null)
  }

  const filtered = templates.filter((t) => {
    const q = search.toLowerCase()
    if (!q) return true
    const purposeLabel = t.purposeKey ? (PURPOSE_LABELS[t.purposeKey] ?? '') : ''
    return t.name.toLowerCase().includes(q) || purposeLabel.toLowerCase().includes(q)
  })

  const utilityTemplates = filtered.filter((t) => t.category === 'UTILITY')
  const marketingTemplates = filtered.filter((t) => t.category === 'MARKETING')

  if (selectedTemplate) {
    const mapping = selectedTemplate.variableMapping ?? []
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <button type="button" onClick={() => setSelectedTemplate(null)} className="text-mid hover:text-charcoal">
                <ArrowLeft className="h-4 w-4" />
              </button>
              Preencher variáveis
            </DialogTitle>
            <DialogDescription>
              Preencha os campos para personalizar a mensagem.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {mapping.map((v) => (
              <div key={v.index} className="space-y-1">
                <Label className="text-xs text-mid">
                  {`{{${v.index}}}`} — {v.label}
                </Label>
                <Input
                  placeholder={v.example}
                  value={variableValues[v.index] ?? ''}
                  onChange={(e) =>
                    setVariableValues((prev) => ({ ...prev, [v.index]: e.target.value }))
                  }
                />
              </div>
            ))}
          </div>

          <div className="mt-2 rounded-lg bg-muted/30 p-3">
            <p className="text-xs text-mid mb-1">Pré-visualização:</p>
            <p className="text-sm text-charcoal whitespace-pre-wrap">
              {(() => {
                let preview = selectedTemplate.body
                for (const v of mapping) {
                  preview = preview.replace(
                    `{{${v.index}}}`,
                    variableValues[v.index] || `[${v.label}]`
                  )
                }
                return preview
              })()}
            </p>
          </div>

          <div className="flex justify-end gap-2 mt-2">
            <Button
              variant="outline"
              onClick={() => setSelectedTemplate(null)}
            >
              Voltar
            </Button>
            <Button
              onClick={handleSendWithVariables}
              disabled={sending}
            >
              <Send className="h-3.5 w-3.5" />
              Enviar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Escolher template</DialogTitle>
          <DialogDescription>
            Selecione um template aprovado para enviar ao contato.
          </DialogDescription>
        </DialogHeader>

        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-mid" />
          <Input
            placeholder="Buscar template..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>

        <div className="max-h-80 space-y-2 overflow-y-auto">
          {loading && (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {!loading && !error && filtered.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Nenhum template aprovado encontrado.
            </div>
          )}

          {!loading && utilityTemplates.length > 0 && (
            <>
              <p className="text-xs font-medium text-mid uppercase tracking-wider pt-1">Utilitário</p>
              {utilityTemplates.map((template) => (
                <TemplateCard key={template.id} template={template} sending={sending} onSelect={handleSelectTemplate} />
              ))}
            </>
          )}

          {!loading && marketingTemplates.length > 0 && (
            <>
              <p className="text-xs font-medium text-mid uppercase tracking-wider pt-2">Marketing</p>
              {marketingTemplates.map((template) => (
                <TemplateCard key={template.id} template={template} sending={sending} onSelect={handleSelectTemplate} />
              ))}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function TemplateCard({
  template,
  sending,
  onSelect,
}: {
  template: Template
  sending?: boolean
  onSelect: (t: Template) => void
}) {
  const purposeLabel = template.purposeKey ? PURPOSE_LABELS[template.purposeKey] : null

  return (
    <button
      type="button"
      className="w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 disabled:opacity-50"
      disabled={sending}
      onClick={() => onSelect(template)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">{template.name}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-xs text-muted-foreground">{template.language}</span>
              {purposeLabel && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  {purposeLabel}
                </Badge>
              )}
            </div>
          </div>
        </div>
        <Send className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      </div>
      {template.body && (
        <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
          {template.body}
        </p>
      )}
    </button>
  )
}
