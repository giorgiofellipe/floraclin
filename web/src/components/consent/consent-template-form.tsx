'use client'

import { useState, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCreateConsentTemplate, useUpdateConsentTemplate } from '@/hooks/mutations/use-consent-mutations'
import { DEFAULT_CONSENT_TEMPLATES } from '@/validations/consent'
import { CONTRACT_PLACEHOLDERS } from '@/lib/contract-interpolation'
import type { ConsentType } from '@/types'

const CONSENT_TYPE_ITEMS: Record<string, string> = {
  general: 'Consentimento Geral',
  botox: 'Toxina Botulínica',
  filler: 'Preenchedor / Ácido Hialurônico',
  biostimulator: 'Bioestimulador',
  custom: 'Personalizado',
  service_contract: 'Contrato de Serviço',
}

interface ExistingTemplate {
  id: string
  type: string
  title: string
  content: string
  version: number
}

interface ConsentTemplateFormProps {
  template?: ExistingTemplate | null
  onSuccess?: () => void
}

export function ConsentTemplateForm({ template, onSuccess }: ConsentTemplateFormProps) {
  const isEditing = !!template
  const formRef = useRef<HTMLFormElement>(null)

  const createTemplate = useCreateConsentTemplate()
  const updateTemplate = useUpdateConsentTemplate()
  const isPending = createTemplate.isPending || updateTemplate.isPending
  const [error, setError] = useState<string | null>(null)

  const [selectedType, setSelectedType] = useState<ConsentType>(
    (template?.type as ConsentType) ?? 'general'
  )
  const [title, setTitle] = useState(template?.title ?? '')
  const [content, setContent] = useState(template?.content ?? '')

  // When type changes, suggest default content (only for new templates)
  const handleTypeChange = (newType: ConsentType) => {
    setSelectedType(newType)
    if (!isEditing && newType !== 'custom') {
      const defaultTemplate = DEFAULT_CONSENT_TEMPLATES[newType as keyof typeof DEFAULT_CONSENT_TEMPLATES]
      if (defaultTemplate) {
        setTitle(defaultTemplate.title)
        setContent(defaultTemplate.content)
      }
    }
  }


  const handleLoadDefault = () => {
    if (selectedType === 'custom') return
    const defaultTemplate = DEFAULT_CONSENT_TEMPLATES[selectedType as keyof typeof DEFAULT_CONSENT_TEMPLATES]
    if (defaultTemplate) {
      setTitle(defaultTemplate.title)
      setContent(defaultTemplate.content)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Form */}
      <Card className="border-0 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <CardHeader>
          <CardTitle className="font-semibold text-[#2A2A2A]">
            {isEditing ? 'Editar Termo de Consentimento' : 'Novo Termo de Consentimento'}
          </CardTitle>
          {isEditing && (
            <CardDescription className="text-mid">
              Ao salvar, uma nova versão será criada (v{(template?.version ?? 0) + 1}).
              A versão anterior será preservada.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <form ref={formRef} onSubmit={async (e) => {
            e.preventDefault()
            setError(null)
            try {
              if (isEditing && template) {
                await updateTemplate.mutateAsync({ id: template.id, type: selectedType, title, content })
              } else {
                await createTemplate.mutateAsync({ type: selectedType, title, content })
              }
              onSuccess?.()
              if (!isEditing) {
                setTitle('')
                setContent('')
                setSelectedType('general')
              }
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Erro ao salvar termo')
            }
          }} className="space-y-4">
            {isEditing && (
              <input type="hidden" name="templateId" value={template?.id} />
            )}

            {/* Type selector — only for new templates */}
            {!isEditing && (
              <div className="space-y-2">
                <Label htmlFor="type">Tipo</Label>
                <Select
                  items={CONSENT_TYPE_ITEMS}
                  value={selectedType}
                  onValueChange={(val) => handleTypeChange(val as ConsentType)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione o tipo" />
                  </SelectTrigger>
                  <SelectContent />
                </Select>
                <input type="hidden" name="type" value={selectedType} />
              </div>
            )}

            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title" className="uppercase tracking-wider text-xs text-mid">Título</Label>
              <Input
                id="title"
                name="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Título do termo"
                required
                className="border-sage/20 focus:border-sage/40"
              />
              {false && (
                <p className="text-sm text-destructive">{""}</p>
              )}
            </div>

            {/* Content */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="content" className="uppercase tracking-wider text-xs text-mid">Conteúdo</Label>
                {!isEditing && selectedType !== 'custom' && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleLoadDefault}
                  >
                    Carregar modelo sugerido
                  </Button>
                )}
              </div>
              <Textarea
                id="content"
                name="content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Texto do termo de consentimento..."
                rows={16}
                className="min-h-64 font-mono text-xs border-sage/20 focus:border-sage/40"
                required
              />
              {false && (
                <p className="text-sm text-destructive">{""}</p>
              )}
            </div>

            {/* Placeholder documentation for service_contract */}
            {selectedType === 'service_contract' && (
              <div className="rounded-[3px] border border-sage/20 bg-petal p-4 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-sage">
                  Variáveis disponíveis
                </p>
                <p className="text-xs text-mid">
                  Use as variáveis abaixo no texto do contrato. Elas serão substituídas automaticamente pelos dados do paciente e do procedimento.
                </p>
                <div className="grid gap-1">
                  {CONTRACT_PLACEHOLDERS.map((p) => (
                    <div key={p.placeholder} className="flex items-start gap-2 text-xs">
                      <code className="shrink-0 rounded bg-white px-1.5 py-0.5 font-mono text-forest border border-sage/20">
                        {p.placeholder}
                      </code>
                      <span className="text-mid">{p.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Errors */}
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            {false && (
              <p className="text-sm text-sage">
                {isEditing ? 'Termo atualizado com sucesso!' : 'Termo criado com sucesso!'}
              </p>
            )}

            <Button type="submit" disabled={isPending} className="w-full bg-forest text-cream hover:bg-sage shadow-[0_1px_4px_rgba(0,0,0,0.06)] hover:shadow-md transition-all duration-200">
              {isPending
                ? 'Salvando...'
                : isEditing
                  ? `Salvar nova versão (v${(template?.version ?? 0) + 1})`
                  : 'Criar termo'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Preview */}
      <Card className="border-0 shadow-[0_1px_4px_rgba(0,0,0,0.06)] flex flex-col">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="font-semibold text-[#2A2A2A]">Pré-visualização</CardTitle>
            {isEditing && (
              <Badge variant="outline" className="border-sage/30 bg-sage/5 text-sage text-xs">
                v{(template?.version ?? 0) + 1} (rascunho)
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col">
          {content ? (
            <ScrollArea className="flex-1 min-h-96 rounded-[3px] border border-[#E8ECEF] bg-white p-5">
              <div className="space-y-3">
                <h3 className="text-base font-semibold text-charcoal">{title || 'Sem título'}</h3>
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-charcoal">
                  {content}
                </div>
              </div>
            </ScrollArea>
          ) : (
            <div className="flex flex-1 min-h-96 items-center justify-center rounded-[3px] border border-dashed border-sage/20 bg-white text-sm text-mid">
              O conteúdo do termo aparecerá aqui
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
