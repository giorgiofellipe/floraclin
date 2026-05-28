'use client'

import * as React from 'react'
import { toast } from 'sonner'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AVAILABLE_DOCUMENT_PLACEHOLDERS,
} from '@/lib/templates/placeholders'
import {
  useCreateDocumentTemplate,
  useUpdateDocumentTemplate,
  type DocumentTemplateRow,
} from '@/hooks/queries/use-document-templates'
import type { ClinicalDocumentKind } from '@/validations/clinical-document'

const KIND_OPTIONS: Record<string, string> = {
  receita: 'Receita',
  atestado: 'Atestado',
}

export interface DocumentTemplateFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  template?: DocumentTemplateRow | null
  defaultKind?: ClinicalDocumentKind
  onSaved?: () => void
}

export function DocumentTemplateForm({
  open,
  onOpenChange,
  template,
  defaultKind,
  onSaved,
}: DocumentTemplateFormProps) {
  const create = useCreateDocumentTemplate()
  const update = useUpdateDocumentTemplate()
  const bodyRef = React.useRef<HTMLTextAreaElement | null>(null)

  const [kind, setKind] = React.useState<ClinicalDocumentKind>(
    template?.kind ?? defaultKind ?? 'receita',
  )
  const [name, setName] = React.useState(template?.name ?? '')
  const [body, setBody] = React.useState(template?.body ?? '')
  const [isActive, setIsActive] = React.useState(template?.isActive ?? true)

  // Reset whenever the dialog opens for a new/different template.
  React.useEffect(() => {
    if (!open) return
    setKind(template?.kind ?? defaultKind ?? 'receita')
    setName(template?.name ?? '')
    setBody(template?.body ?? '')
    setIsActive(template?.isActive ?? true)
  }, [open, template, defaultKind])

  function insertPlaceholderAtCursor(token: string) {
    const el = bodyRef.current
    if (!el) {
      setBody((prev) => prev + token)
      return
    }
    const start = el.selectionStart ?? body.length
    const end = el.selectionEnd ?? body.length
    const next = body.slice(0, start) + token + body.slice(end)
    setBody(next)
    requestAnimationFrame(() => {
      el.focus()
      const cursor = start + token.length
      el.setSelectionRange(cursor, cursor)
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !body.trim()) {
      toast.error('Preencha nome e corpo do modelo')
      return
    }

    try {
      if (template) {
        await update.mutateAsync({
          id: template.id,
          input: { kind, name: name.trim(), body, isActive },
        })
        toast.success('Modelo atualizado')
      } else {
        await create.mutateAsync({ kind, name: name.trim(), body, isActive })
        toast.success('Modelo criado')
      }
      onSaved?.()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao salvar modelo')
    }
  }

  const isPending = create.isPending || update.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] w-[95vw] max-w-5xl flex-col gap-0 p-0 sm:max-w-5xl">
        <form
          onSubmit={handleSubmit}
          className="flex h-full min-h-0 flex-col"
        >
          <DialogHeader className="border-b border-[#E8ECEF] px-6 py-4">
            <DialogTitle>{template ? 'Editar modelo' : 'Novo modelo'}</DialogTitle>
            <DialogDescription>
              Modelos pré-preenchem o corpo ao emitir um documento. Use marcadores como
              <code className="mx-1 font-mono text-xs">{'{{patient.name}}'}</code> para
              dados que serão substituídos automaticamente.
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 gap-4 overflow-hidden p-6 md:grid-cols-[1fr_240px]">
            <div className="flex min-h-0 flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
                <div className="space-y-1">
                  <Label>Tipo</Label>
                  <Select
                    items={KIND_OPTIONS}
                    value={kind}
                    onValueChange={(v) =>
                      setKind((v as ClinicalDocumentKind) ?? 'receita')
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent />
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="tpl-name">Nome do modelo</Label>
                  <Input
                    id="tpl-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex.: Receita padrão dipirona"
                    maxLength={255}
                  />
                </div>
              </div>

              <div className="flex min-h-0 flex-1 flex-col space-y-1">
                <Label htmlFor="tpl-body">Corpo</Label>
                <Textarea
                  id="tpl-body"
                  ref={bodyRef}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Conteúdo do modelo..."
                  className="flex-1 resize-none font-serif text-base leading-relaxed"
                />
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                Modelo ativo
              </label>
            </div>

            <aside className="flex min-h-0 flex-col space-y-2 overflow-y-auto pr-1">
              <Label className="text-xs uppercase tracking-wider text-mid">
                Marcadores
              </Label>
              <div className="space-y-1.5">
                {AVAILABLE_DOCUMENT_PLACEHOLDERS.map((p) => (
                  <button
                    key={p.token}
                    type="button"
                    onClick={() => insertPlaceholderAtCursor(p.token)}
                    className="w-full rounded-[3px] border border-[#E8ECEF] bg-white px-2.5 py-1.5 text-left text-xs hover:bg-blush/40"
                    title={p.description}
                  >
                    <div className="font-mono text-charcoal">{p.token}</div>
                    <div className="text-mid">{p.description}</div>
                  </button>
                ))}
              </div>
            </aside>
          </div>

          <DialogFooter className="m-0 flex-row justify-end gap-2 rounded-b-xl border-t border-[#E8ECEF] bg-muted/50 p-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
