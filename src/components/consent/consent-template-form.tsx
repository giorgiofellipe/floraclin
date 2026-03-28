'use client'

import { useActionState, useEffect, useState, useRef } from 'react'
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  createConsentTemplateAction,
  updateConsentTemplateAction,
  type ConsentActionState,
} from '@/actions/consent'
import { DEFAULT_CONSENT_TEMPLATES } from '@/validations/consent'
import type { ConsentType } from '@/types'

const CONSENT_TYPE_OPTIONS: { value: ConsentType; label: string }[] = [
  { value: 'general', label: 'Consentimento Geral' },
  { value: 'botox', label: 'Toxina Botulínica' },
  { value: 'filler', label: 'Preenchedor / Ácido Hialurônico' },
  { value: 'biostimulator', label: 'Bioestimulador' },
  { value: 'custom', label: 'Personalizado' },
]

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

  const action = isEditing ? updateConsentTemplateAction : createConsentTemplateAction
  const [state, formAction, isPending] = useActionState<ConsentActionState, FormData>(action, null)

  const [selectedType, setSelectedType] = useState<ConsentType>(
    (template?.type as ConsentType) ?? 'general'
  )
  const [title, setTitle] = useState(template?.title ?? '')
  const [content, setContent] = useState(template?.content ?? '')

  // When type changes, suggest default content (only for new templates)
  useEffect(() => {
    if (!isEditing && selectedType !== 'custom') {
      const defaultTemplate = DEFAULT_CONSENT_TEMPLATES[selectedType as keyof typeof DEFAULT_CONSENT_TEMPLATES]
      if (defaultTemplate && !content) {
        setTitle(defaultTemplate.title)
        setContent(defaultTemplate.content)
      }
    }
  }, [selectedType, isEditing, content])

  // Handle success
  useEffect(() => {
    if (state?.success) {
      onSuccess?.()
      if (!isEditing) {
        setTitle('')
        setContent('')
        setSelectedType('general')
      }
    }
  }, [state?.success, onSuccess, isEditing])

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
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="font-display text-forest">
            {isEditing ? 'Editar Termo de Consentimento' : 'Novo Termo de Consentimento'}
          </CardTitle>
          {isEditing && (
            <CardDescription className="text-mid">
              Ao salvar, uma nova versao sera criada (v{(template?.version ?? 0) + 1}).
              A versao anterior sera preservada.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <form ref={formRef} action={formAction} className="space-y-4">
            {isEditing && (
              <input type="hidden" name="templateId" value={template?.id} />
            )}

            {/* Type selector — only for new templates */}
            {!isEditing && (
              <div className="space-y-2">
                <Label htmlFor="type">Tipo</Label>
                <Select
                  value={selectedType}
                  onValueChange={(val) => setSelectedType(val as ConsentType)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione o tipo">
                      {(value: string) => CONSENT_TYPE_OPTIONS.find((o) => o.value === value)?.label ?? value}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {CONSENT_TYPE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <input type="hidden" name="type" value={selectedType} />
              </div>
            )}

            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title" className="uppercase tracking-wider text-xs text-mid">Titulo</Label>
              <Input
                id="title"
                name="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Titulo do termo"
                required
                className="border-sage/20 focus:border-sage/40"
              />
              {state?.fieldErrors?.title && (
                <p className="text-sm text-destructive">{state.fieldErrors.title[0]}</p>
              )}
            </div>

            {/* Content */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="content" className="uppercase tracking-wider text-xs text-mid">Conteudo</Label>
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
              {state?.fieldErrors?.content && (
                <p className="text-sm text-destructive">{state.fieldErrors.content[0]}</p>
              )}
            </div>

            {/* Errors */}
            {state?.error && (
              <p className="text-sm text-destructive">{state.error}</p>
            )}

            {state?.success && (
              <p className="text-sm text-sage">
                {isEditing ? 'Termo atualizado com sucesso!' : 'Termo criado com sucesso!'}
              </p>
            )}

            <Button type="submit" disabled={isPending} className="w-full bg-forest text-cream hover:bg-sage shadow-sm hover:shadow-md transition-all duration-200">
              {isPending
                ? 'Salvando...'
                : isEditing
                  ? `Salvar nova versao (v${(template?.version ?? 0) + 1})`
                  : 'Criar termo'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Preview */}
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="font-display text-forest">Pre-visualizacao</CardTitle>
            {isEditing && (
              <Badge variant="outline" className="border-sage/30 bg-sage/5 text-sage text-xs">
                v{(template?.version ?? 0) + 1} (rascunho)
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {content ? (
            <ScrollArea className="h-96 rounded-xl border border-blush/50 bg-petal/20 p-5">
              <div className="space-y-3">
                <h3 className="text-base font-semibold text-forest">{title || 'Sem titulo'}</h3>
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-charcoal">
                  {content}
                </div>
              </div>
            </ScrollArea>
          ) : (
            <div className="flex h-96 items-center justify-center rounded-xl border border-dashed border-sage/20 bg-cream/30 text-sm text-mid">
              O conteudo do termo aparecera aqui
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
