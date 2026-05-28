'use client'

import { useCallback, useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FileText, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'

interface SavedReply {
  id: string
  name: string
  body: string
  variableKeys: string[]
  purposeKey: string | null
}

interface SavedReplyPickerProps {
  onPick: (filled: string) => void
  disabled?: boolean
}

export function SavedReplyPicker({ onPick, disabled }: SavedReplyPickerProps) {
  const [replies, setReplies] = useState<SavedReply[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [editingReply, setEditingReply] = useState<SavedReply | null>(null)
  const [variableValues, setVariableValues] = useState<Record<string, string>>({})

  const fetchReplies = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/instagram/saved-replies')
      if (!res.ok) throw new Error('Erro ao carregar respostas salvas')
      const data = await res.json()
      const items = (data.data ?? []) as SavedReply[]
      setReplies(items.map((r) => ({
        ...r,
        variableKeys: Array.isArray(r.variableKeys) ? r.variableKeys : [],
      })))
      setLoaded(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao carregar respostas')
    } finally {
      setLoading(false)
    }
  }, [])

  function fillBody(body: string, values: Record<string, string>): string {
    return body.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? `{{${key}}}`)
  }

  function handleSelectReply(reply: SavedReply) {
    if (!reply.variableKeys || reply.variableKeys.length === 0) {
      onPick(reply.body)
      return
    }
    const initial: Record<string, string> = {}
    for (const k of reply.variableKeys) initial[k] = ''
    setVariableValues(initial)
    setEditingReply(reply)
  }

  function handleSubmitVariables() {
    if (!editingReply) return
    const filled = fillBody(editingReply.body, variableValues)
    onPick(filled)
    setEditingReply(null)
    setVariableValues({})
  }

  function handleOpenChange(open: boolean) {
    if (open && !loaded && !loading) {
      fetchReplies()
    }
  }

  return (
    <>
      <DropdownMenu onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              className="gap-1.5 text-mid hover:text-charcoal"
            >
              <FileText className="size-4" />
              Resposta salva
              <ChevronDown className="size-3.5" />
            </Button>
          }
        />
        <DropdownMenuContent align="start" className="max-h-80 w-72 overflow-y-auto">
          <DropdownMenuLabel>Respostas salvas</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {loading && (
            <div className="px-2 py-3 text-center text-xs text-muted-foreground">
              Carregando...
            </div>
          )}
          {!loading && replies.length === 0 && (
            <div className="px-2 py-3 text-center text-xs text-muted-foreground">
              Nenhuma resposta salva.
            </div>
          )}
          {!loading &&
            replies.map((reply) => (
              <DropdownMenuItem
                key={reply.id}
                onClick={() => handleSelectReply(reply)}
                className="flex flex-col items-start gap-0.5"
              >
                <span className="text-sm font-medium">{reply.name}</span>
                <span className="line-clamp-2 text-[11px] text-muted-foreground">
                  {reply.body}
                </span>
              </DropdownMenuItem>
            ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={!!editingReply}
        onOpenChange={(open) => {
          if (!open) {
            setEditingReply(null)
            setVariableValues({})
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Preencher variáveis</DialogTitle>
            <DialogDescription>
              {editingReply?.name}
            </DialogDescription>
          </DialogHeader>

          {editingReply && (
            <>
              <div className="space-y-3">
                {editingReply.variableKeys.map((key) => {
                  const value = variableValues[key] ?? ''
                  return (
                    <div key={key} className="space-y-1">
                      <Label className="text-xs text-mid">
                        {`{{${key}}}`}
                      </Label>
                      <Input
                        placeholder={key}
                        maxLength={500}
                        value={value}
                        onChange={(e) =>
                          setVariableValues((prev) => ({ ...prev, [key]: e.target.value }))
                        }
                      />
                      <p className="text-[10px] text-mid text-right tabular-nums">
                        {value.length}/500
                      </p>
                    </div>
                  )
                })}
              </div>

              <div className="mt-2 rounded-lg bg-muted/30 p-3">
                <p className="text-xs text-mid mb-1">Pré-visualização:</p>
                <p className="text-sm text-charcoal whitespace-pre-wrap">
                  {fillBody(editingReply.body, variableValues)}
                </p>
              </div>

              <div className="flex justify-end gap-2 mt-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditingReply(null)
                    setVariableValues({})
                  }}
                >
                  Cancelar
                </Button>
                <Button onClick={handleSubmitVariables}>Inserir</Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
