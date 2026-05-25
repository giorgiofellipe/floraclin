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
import { Skeleton } from '@/components/ui/skeleton'
import { FileText, Send } from 'lucide-react'

interface Template {
  name: string
  language: string
  category: string
  body: string
  status: string
}

interface TemplatePickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelectTemplate: (templateName: string, language: string) => void
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

  const fetchTemplates = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/whatsapp/templates')
      if (!res.ok) {
        throw new Error('Erro ao carregar templates')
      }
      const data = await res.json()
      setTemplates(data.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      fetchTemplates()
    }
  }, [open, fetchTemplates])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Escolher template</DialogTitle>
          <DialogDescription>
            Selecione um template aprovado para enviar ao contato.
          </DialogDescription>
        </DialogHeader>

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

          {!loading && !error && templates.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Nenhum template aprovado encontrado.
            </div>
          )}

          {!loading &&
            templates.map((template) => (
              <button
                key={`${template.name}-${template.language}`}
                type="button"
                className="w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 disabled:opacity-50"
                disabled={sending}
                onClick={() => onSelectTemplate(template.name, template.language)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{template.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {template.category} &middot; {template.language}
                      </p>
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
            ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
