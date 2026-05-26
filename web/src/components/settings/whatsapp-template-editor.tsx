'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PREDEFINED_VARIABLES } from '@/lib/whatsapp-blueprints'
import { Send, X, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'

// ─── Types ──────────────────────────────────────────────────────────

type VarMapping = { index: number; key: string; label: string; example: string }

interface WhatsappTemplate {
  id: string
  name: string
  language: string
  category: string
  status: string
  components: unknown
  purposeKey: string | null
  metaTemplateId: string | null
  variableMapping: unknown
}

interface WhatsAppTemplateEditorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  template?: WhatsappTemplate | null
  onSaved: () => void
}

// ─── Helpers ────────────────────────────────────────────────────────

const NAME_REGEX = /^[a-z][a-z0-9_]*$/

const CATEGORY_ITEMS: Record<string, string> = {
  UTILITY: 'Utilitário',
  MARKETING: 'Marketing',
}

const LANGUAGE_ITEMS: Record<string, string> = {
  pt_BR: 'Português (BR)',
  en_US: 'English (US)',
  es: 'Español',
}

function extractBodyText(components: unknown): string {
  if (!Array.isArray(components)) return ''
  const body = components.find(
    (c: Record<string, unknown>) => c.type === 'BODY',
  )
  return (body?.text as string) ?? ''
}

function extractVariableMapping(mapping: unknown): VarMapping[] {
  if (!Array.isArray(mapping)) return []
  return mapping.filter(
    (m): m is VarMapping =>
      typeof m === 'object' &&
      m !== null &&
      'index' in m &&
      'key' in m &&
      'label' in m &&
      'example' in m,
  )
}

function replaceVariablesWithExamples(
  text: string,
  vars: VarMapping[],
): string {
  let result = text
  for (const v of vars) {
    result = result.replaceAll(`{{${v.index}}}`, v.example)
  }
  return result
}

// ─── Component ──────────────────────────────────────────────────────

export function WhatsAppTemplateEditor({
  open,
  onOpenChange,
  template,
  onSaved,
}: WhatsAppTemplateEditorProps) {
  const isEdit = !!template
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const [name, setName] = useState('')
  const [category, setCategory] = useState('UTILITY')
  const [language, setLanguage] = useState('pt_BR')
  const [bodyText, setBodyText] = useState('')
  const [variableMapping, setVariableMapping] = useState<VarMapping[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)

  // Reset form when sheet opens or template changes
  useEffect(() => {
    if (!open) return

    if (template) {
      setName(template.name)
      setCategory(template.category)
      setLanguage(template.language)
      setBodyText(extractBodyText(template.components))
      setVariableMapping(extractVariableMapping(template.variableMapping))
    } else {
      setName('')
      setCategory('UTILITY')
      setLanguage('pt_BR')
      setBodyText('')
      setVariableMapping([])
    }
    setNameError(null)
  }, [open, template])

  const handleInsertVariable = useCallback(
    (item: (typeof PREDEFINED_VARIABLES)[number]) => {
      const alreadyMapped = variableMapping.some((v) => v.key === item.key)
      if (alreadyMapped) {
        toast.error('Essa variável já foi adicionada')
        return
      }

      const nextIndex = variableMapping.length + 1
      const newVar: VarMapping = {
        index: nextIndex,
        key: item.key,
        label: item.label,
        example: item.example,
      }

      setVariableMapping((prev) => [...prev, newVar])
      setBodyText((prev) => {
        const suffix = prev.length > 0 && !prev.endsWith(' ') ? ' ' : ''
        return `${prev}${suffix}{{${nextIndex}}}`
      })
    },
    [variableMapping],
  )

  const handleRemoveVariable = useCallback(
    (index: number) => {
      setVariableMapping((prev) => {
        const filtered = prev.filter((v) => v.index !== index)
        // Re-index remaining variables
        return filtered.map((v, i) => ({ ...v, index: i + 1 }))
      })

      // Update body text: remove the placeholder and re-index
      setBodyText((prev) => {
        let result = prev.replace(`{{${index}}}`, '')
        // Re-index remaining placeholders
        const remaining = variableMapping
          .filter((v) => v.index !== index)
          .sort((a, b) => a.index - b.index)
        remaining.forEach((v, i) => {
          result = result.replaceAll(`{{${v.index}}}`, `{{${i + 1}}}`)
        })
        return result.replace(/\s{2,}/g, ' ').trim()
      })
    },
    [variableMapping],
  )

  function validateName(value: string): boolean {
    if (!value.trim()) {
      setNameError('Nome é obrigatório')
      return false
    }
    if (!NAME_REGEX.test(value)) {
      setNameError(
        'Use apenas letras minúsculas, números e underscores (ex: meu_template_1)',
      )
      return false
    }
    setNameError(null)
    return true
  }

  async function handleSubmit() {
    if (!isEdit && !validateName(name)) return
    if (!bodyText.trim()) {
      toast.error('O texto do template é obrigatório')
      return
    }

    setSubmitting(true)

    try {
      const components = [
        {
          type: 'BODY',
          text: bodyText,
          example: {
            body_text: [variableMapping.map((v) => v.example)],
          },
        },
      ]

      if (isEdit) {
        const res = await fetch(`/api/whatsapp/templates/${template!.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ components, variableMapping }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || 'Erro ao salvar alterações')
        }
        toast.success('Template atualizado com sucesso')
      } else {
        const res = await fetch('/api/whatsapp/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            category,
            language,
            components,
            variableMapping,
          }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || 'Erro ao criar template')
        }
        toast.success('Template enviado para aprovação')
      }

      onSaved()
      onOpenChange(false)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Erro ao salvar template',
      )
    } finally {
      setSubmitting(false)
    }
  }

  const previewText = replaceVariablesWithExamples(bodyText, variableMapping)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-lg w-full overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {isEdit ? 'Editar Template' : 'Novo Template'}
          </SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-4 pb-4">
          {/* Create-only fields */}
          {!isEdit && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label className="uppercase tracking-wider text-xs text-mid">
                  Nome *
                </Label>
                <Input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    if (nameError) validateName(e.target.value)
                  }}
                  onBlur={() => name && validateName(name)}
                  placeholder="ex: lembrete_consulta"
                />
                {nameError && (
                  <p className="text-xs text-red-500">{nameError}</p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label className="uppercase tracking-wider text-xs text-mid">
                  Categoria *
                </Label>
                <Select
                  items={CATEGORY_ITEMS}
                  value={category}
                  onValueChange={(val) => val && setCategory(val)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent />
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label className="uppercase tracking-wider text-xs text-mid">
                  Idioma
                </Label>
                <Select
                  items={LANGUAGE_ITEMS}
                  value={language}
                  onValueChange={(val) => val && setLanguage(val)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent />
                </Select>
              </div>
            </>
          )}

          {/* Body text */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label className="uppercase tracking-wider text-xs text-mid">
                Texto da mensagem *
              </Label>

              {/* Variable insertion dropdown */}
              <Select
                value=""
                onValueChange={(val) => {
                  if (!val) return
                  const item = PREDEFINED_VARIABLES.find((v) => v.key === val)
                  if (item) handleInsertVariable(item)
                }}
                items={PREDEFINED_VARIABLES.reduce(
                  (acc, v) => {
                    acc[v.key] = v.label
                    return acc
                  },
                  {} as Record<string, string>,
                )}
              >
                <SelectTrigger className="h-7 text-xs gap-1">
                  <Plus className="size-3" />
                  <span>Variável</span>
                </SelectTrigger>
                <SelectContent />
              </Select>
            </div>

            <Textarea
              ref={textareaRef}
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              placeholder="Olá, {{1}}! Sua consulta está agendada para {{2}} às {{3}}."
              rows={6}
              className="resize-y"
            />
          </div>

          {/* Variable mapping display */}
          {variableMapping.length > 0 && (
            <div className="flex flex-col gap-2">
              <Label className="uppercase tracking-wider text-xs text-mid">
                Variáveis mapeadas
              </Label>
              <div className="space-y-1.5">
                {variableMapping.map((v) => (
                  <div
                    key={v.index}
                    className="flex items-center gap-2 rounded-[3px] border border-[#E8ECEF] bg-[#F4F6F8] px-3 py-1.5"
                  >
                    <span className="text-xs font-mono text-charcoal">
                      {`{{${v.index}}}`}
                    </span>
                    <span className="text-xs text-mid">→</span>
                    <span className="text-xs text-charcoal flex-1">
                      {v.label}{' '}
                      <span className="text-mid">({v.example})</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveVariable(v.index)}
                      className="text-mid hover:text-red-500 transition-colors"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Preview */}
          {bodyText.trim() && (
            <div className="flex flex-col gap-1.5">
              <Label className="uppercase tracking-wider text-xs text-mid">
                Pré-visualização
              </Label>
              <div className="rounded-[3px] border border-[#E8ECEF] bg-[#F4F6F8] p-4">
                <p className="text-sm text-charcoal whitespace-pre-wrap leading-relaxed">
                  {previewText}
                </p>
              </div>
            </div>
          )}
        </div>

        <SheetFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || (!isEdit && !name.trim()) || !bodyText.trim()}
            className="bg-forest text-cream hover:bg-sage"
          >
            {submitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            {isEdit ? 'Salvar alterações' : 'Enviar para aprovação'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
