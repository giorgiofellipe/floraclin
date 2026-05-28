'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'
import { savedReplyInputSchema } from '@/validations/instagram'

// ─── Types ──────────────────────────────────────────────────────────

interface InstagramSavedReplyEditorProps {
  replyId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface SavedReplyResponse {
  id: string
  name: string
  body: string
  variableKeys?: string[]
  purposeKey?: string | null
}

// ─── Helpers ────────────────────────────────────────────────────────

// Regex finds `{{variable}}` placeholders so the preview can highlight them.
const VARIABLE_REGEX = /\{\{(\w+)\}\}/g

function renderPreview(body: string): React.ReactNode[] {
  if (!body) return [<span key="empty" className="text-mid/60">Pré-visualização aparecerá aqui...</span>]

  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let keyIdx = 0

  // Use a fresh regex per render — global flag carries `lastIndex` state.
  const re = new RegExp(VARIABLE_REGEX.source, 'g')

  while ((match = re.exec(body)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <span key={`text-${keyIdx++}`}>{body.slice(lastIndex, match.index)}</span>,
      )
    }
    parts.push(
      <span
        key={`var-${keyIdx++}`}
        className="inline-flex items-center rounded-[2px] bg-sage/15 text-forest font-medium px-1"
      >
        {match[0]}
      </span>,
    )
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < body.length) {
    parts.push(<span key={`text-${keyIdx++}`}>{body.slice(lastIndex)}</span>)
  }

  return parts
}

// ─── Component ──────────────────────────────────────────────────────

export function InstagramSavedReplyEditor({
  replyId,
  open,
  onOpenChange,
}: InstagramSavedReplyEditorProps) {
  const isEdit = !!replyId

  const [name, setName] = useState('')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<{ name?: string; body?: string }>({})

  // ─── Load existing reply on edit ────────────────────────────────

  useEffect(() => {
    if (!open) return

    if (!replyId) {
      setName('')
      setBody('')
      setErrors({})
      return
    }

    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const res = await fetch(`/api/instagram/saved-replies/${replyId}`)
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || 'Erro ao carregar resposta')
        }
        const data = await res.json()
        const reply: SavedReplyResponse = data.data ?? data
        if (cancelled) return
        setName(reply.name ?? '')
        setBody(reply.body ?? '')
        setErrors({})
      } catch (err) {
        if (cancelled) return
        toast.error(
          err instanceof Error ? err.message : 'Erro ao carregar resposta',
        )
        onOpenChange(false)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, replyId, onOpenChange])

  // ─── Variable extraction (preview metadata) ─────────────────────

  const variableKeys = useMemo(() => {
    const keys = new Set<string>()
    let match: RegExpExecArray | null
    const re = new RegExp(VARIABLE_REGEX.source, 'g')
    while ((match = re.exec(body)) !== null) {
      keys.add(match[1])
    }
    return Array.from(keys)
  }, [body])

  // ─── Submit ─────────────────────────────────────────────────────

  async function handleSubmit() {
    const parsed = savedReplyInputSchema.safeParse({
      name: name.trim(),
      body: body.trim(),
    })

    if (!parsed.success) {
      const fieldErrors: { name?: string; body?: string } = {}
      for (const issue of parsed.error.issues) {
        const path = issue.path[0]
        if (path === 'name') fieldErrors.name = issue.message
        if (path === 'body') fieldErrors.body = issue.message
      }
      setErrors(fieldErrors)
      return
    }

    setErrors({})
    setSubmitting(true)

    try {
      const url = isEdit
        ? `/api/instagram/saved-replies/${replyId}`
        : '/api/instagram/saved-replies'
      const method = isEdit ? 'PATCH' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Erro ao salvar resposta')
      }

      toast.success(
        isEdit ? 'Resposta atualizada com sucesso' : 'Resposta criada com sucesso',
      )
      onOpenChange(false)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Erro ao salvar resposta',
      )
    } finally {
      setSubmitting(false)
    }
  }

  // ─── Render ─────────────────────────────────────────────────────

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-lg w-full overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {isEdit ? 'Editar resposta' : 'Nova resposta'}
          </SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-4 pb-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-5 animate-spin text-mid" />
            </div>
          ) : (
            <>
              {/* Name */}
              <div className="flex flex-col gap-1.5">
                <Label className="uppercase tracking-wider text-xs text-mid">
                  Nome *
                </Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Boas-vindas"
                  maxLength={255}
                />
                {errors.name && (
                  <p className="text-xs text-red-500">{errors.name}</p>
                )}
              </div>

              {/* Body */}
              <div className="flex flex-col gap-1.5">
                <Label className="uppercase tracking-wider text-xs text-mid">
                  Mensagem *
                </Label>
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Olá {{nome}}! Como posso ajudar?"
                  rows={6}
                  maxLength={2000}
                  className="resize-y"
                />
                <p className="text-[11px] text-mid">
                  Use{' '}
                  <code className="bg-[#F4F6F8] px-1 py-0.5 rounded text-[10px]">
                    {'{{variavel}}'}
                  </code>{' '}
                  para inserir variáveis que serão preenchidas no envio.
                </p>
                {errors.body && (
                  <p className="text-xs text-red-500">{errors.body}</p>
                )}
              </div>

              {/* Detected variables */}
              {variableKeys.length > 0 && (
                <div className="flex flex-col gap-2">
                  <Label className="uppercase tracking-wider text-xs text-mid">
                    Variáveis detectadas
                  </Label>
                  <div className="flex flex-wrap gap-1.5">
                    {variableKeys.map((key) => (
                      <span
                        key={key}
                        className="inline-flex items-center rounded-[2px] bg-sage/15 text-forest font-medium px-2 py-0.5 text-xs"
                      >
                        {`{{${key}}}`}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Live preview */}
              <div className="flex flex-col gap-1.5">
                <Label className="uppercase tracking-wider text-xs text-mid">
                  Pré-visualização
                </Label>
                <div className="rounded-[3px] border border-[#E8ECEF] bg-[#F4F6F8] p-4">
                  <p className="text-sm text-charcoal whitespace-pre-wrap leading-relaxed">
                    {renderPreview(body)}
                  </p>
                </div>
              </div>
            </>
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
            disabled={submitting || loading || !name.trim() || !body.trim()}
            className="bg-forest text-cream hover:bg-sage"
          >
            {submitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            {isEdit ? 'Salvar alterações' : 'Criar resposta'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
