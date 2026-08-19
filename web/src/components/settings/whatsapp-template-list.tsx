'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import {
  RefreshCw,
  Plus,
  Pencil,
  Trash2,
  Search,
  FileText,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'
import { getTemplateDisplayLabel } from '@/lib/whatsapp-blueprints'
import { WhatsAppTemplateEditor } from './whatsapp-template-editor'

// ─── Types ──────────────────────────────────────────────────────────

interface WhatsappTemplate {
  id: string
  tenantId: string
  metaTemplateId: string | null
  name: string
  language: string
  category: string
  status: string
  components: unknown
  purposeKey: string | null
  rejectedReason: string | null
  blueprintSlug: string | null
  submittedAt: Date | null
  variableMapping: unknown
  syncedAt: Date
  createdAt: Date
}

interface WhatsAppTemplateListProps {
  onProvision: () => Promise<void>
  configured?: boolean
}

// ─── Constants ──────────────────────────────────────────────────────

const STATUS_FILTER_ITEMS: Record<string, string> = {
  '': 'Todos',
  APPROVED: 'Aprovado',
  PENDING: 'Pendente',
  REJECTED: 'Rejeitado',
}

const STATUS_BADGE: Record<
  string,
  { label: string; className: string }
> = {
  APPROVED: {
    label: 'Aprovado',
    className: 'bg-[#F0F7F1] text-sage border-sage/20',
  },
  PENDING: {
    label: 'Pendente',
    className: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  REJECTED: {
    label: 'Rejeitado',
    className: 'bg-red-50 text-red-600 border-red-200',
  },
  PAUSED: {
    label: 'Pausado',
    className: 'bg-[#F4F6F8] text-mid border-[#E8ECEF]',
  },
  DISABLED: {
    label: 'Desativado',
    className: 'bg-[#F4F6F8] text-mid border-[#E8ECEF]',
  },
}

const CATEGORY_LABELS: Record<string, string> = {
  UTILITY: 'Utilitário',
  MARKETING: 'Marketing',
  AUTHENTICATION: 'Autenticação',
}

// ─── Component ──────────────────────────────────────────────────────

export function WhatsAppTemplateList({ onProvision, configured = false }: WhatsAppTemplateListProps) {
  const [templates, setTemplates] = useState<WhatsappTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [provisioning, setProvisioning] = useState(false)
  const [refreshingId, setRefreshingId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<WhatsappTemplate | null>(null)
  const [provisionConfirmOpen, setProvisionConfirmOpen] = useState(false)

  // ─── Fetch templates ────────────────────────────────────────────

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/templates')
      if (!res.ok) throw new Error('Erro ao buscar templates')
      const data = await res.json()
      setTemplates(data.data ?? [])
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Erro ao buscar templates',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!configured) {
      setLoading(false)
      return
    }
    fetchTemplates()
  }, [fetchTemplates, configured])

  // ─── Actions ────────────────────────────────────────────────────

  async function handleSync() {
    setSyncing(true)
    try {
      const res = await fetch('/api/whatsapp/templates/sync', { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Erro ao sincronizar')
      }
      toast.success('Templates sincronizados com sucesso')
      await fetchTemplates()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Erro ao sincronizar templates',
      )
    } finally {
      setSyncing(false)
    }
  }

  async function handleProvision() {
    setProvisioning(true)
    try {
      await onProvision()
      toast.success('Templates provisionados com sucesso')
      await fetchTemplates()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Erro ao provisionar templates',
      )
    } finally {
      setProvisioning(false)
    }
  }

  async function handleRefreshSingle(id: string) {
    setRefreshingId(id)
    try {
      const res = await fetch(`/api/whatsapp/templates/${id}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Erro ao atualizar template')
      }
      toast.success('Template atualizado')
      await fetchTemplates()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Erro ao atualizar template',
      )
    } finally {
      setRefreshingId(null)
    }
  }

  async function handleDelete(id: string, name: string) {
    const confirmed = window.confirm(
      `Tem certeza que deseja excluir o template "${name}"? Esta ação não pode ser desfeita.`,
    )
    if (!confirmed) return

    try {
      const res = await fetch(`/api/whatsapp/templates/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Erro ao excluir template')
      }
      toast.success('Template excluído')
      await fetchTemplates()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Erro ao excluir template',
      )
    }
  }

  function handleOpenCreate() {
    setEditingTemplate(null)
    setEditorOpen(true)
  }

  function handleOpenEdit(template: WhatsappTemplate) {
    setEditingTemplate(template)
    setEditorOpen(true)
  }

  function handleEditorSaved() {
    fetchTemplates()
  }

  // ─── Filtering ──────────────────────────────────────────────────

  const filtered = templates.filter((t) => {
    const matchesSearch =
      !searchQuery ||
      t.name.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesStatus = !statusFilter || t.status === statusFilter
    return matchesSearch && matchesStatus
  })

  // ─── Render ─────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Section header */}
      <div className="flex items-center gap-2 mb-1">
        <h3 className="uppercase tracking-wider text-xs font-medium text-mid">
          Templates de Mensagem
        </h3>
        <div className="flex-1 h-px bg-blush/60" />
      </div>

      {/* Actions bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleSync}
          disabled={syncing}
        >
          {syncing ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          Sincronizar
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setProvisionConfirmOpen(true)}
          disabled={provisioning}
        >
          {provisioning ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <FileText className="size-3.5" />
          )}
          Criar templates padrão
        </Button>

        <div className="flex-1" />

        <Button
          size="sm"
          onClick={handleOpenCreate}
          className="bg-forest text-cream hover:bg-sage"
        >
          <Plus className="size-3.5" />
          Novo Template
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-mid" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por nome..."
            className="pl-8 border-sage/20"
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs text-mid">Status</Label>
          <Select
            items={STATUS_FILTER_ITEMS}
            value={statusFilter}
            onValueChange={(val) => setStatusFilter(val ?? '')}
          >
            <SelectTrigger className="w-[140px] border-sage/20">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent />
          </Select>
        </div>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-[3px] border border-[#E8ECEF] bg-white p-4"
            >
              <div className="flex items-center gap-3">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-5 w-20" />
                <div className="flex-1" />
                <Skeleton className="h-7 w-7" />
                <Skeleton className="h-7 w-7" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <div className="rounded-[3px] border border-dashed border-[#E8ECEF] p-8 text-center">
          <FileText className="mx-auto size-8 text-mid/40 mb-2" />
          <p className="text-sm text-mid">
            {templates.length === 0
              ? 'Nenhum template cadastrado.'
              : 'Nenhum template encontrado com os filtros aplicados.'}
          </p>
          {templates.length === 0 && (
            <p className="mt-1 text-xs text-mid">
              Clique em &quot;Novo Template&quot; para criar ou
              &quot;Provisionar&quot; para gerar templates padrão.
            </p>
          )}
        </div>
      )}

      {/* Template cards */}
      {!loading && filtered.length > 0 && (
        <TooltipProvider>
          <div className="space-y-3">
            {filtered.map((t) => {
              const statusInfo = STATUS_BADGE[t.status] ?? {
                label: t.status,
                className: 'bg-[#F4F6F8] text-mid border-[#E8ECEF]',
              }
              const displayLabel = getTemplateDisplayLabel(t)

              return (
                <div
                  key={t.id}
                  className="rounded-[3px] border border-[#E8ECEF] bg-white p-4"
                >
                  <div className="flex items-start gap-3">
                    {/* Template info */}
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-medium text-charcoal truncate">
                          {displayLabel}
                        </h4>

                        {/* Category badge */}
                        <Badge variant="outline" className="text-[10px]">
                          {CATEGORY_LABELS[t.category] || t.category}
                        </Badge>

                        {/* Status badge */}
                        {t.status === 'REJECTED' && t.rejectedReason ? (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <span
                                  className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium cursor-help ${statusInfo.className}`}
                                />
                              }
                            >
                              {statusInfo.label}
                            </TooltipTrigger>
                            <TooltipContent>
                              {t.rejectedReason}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span
                            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusInfo.className}`}
                          >
                            {statusInfo.label}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 text-xs text-mid">
                        {displayLabel !== t.name && (
                          <span className="text-mid/60">{t.name}</span>
                        )}
                        <span>
                          Sincronizado em{' '}
                          {formatDateTime(t.syncedAt)}
                        </span>
                      </div>

                      {(() => {
                        const comps = t.components as Array<Record<string, unknown>> | undefined
                        const bodyText = comps?.find((c) => c.type === 'BODY')?.text as string | undefined
                        return bodyText ? (
                          <p className="text-xs text-mid/80 line-clamp-2 whitespace-pre-wrap">
                            {bodyText}
                          </p>
                        ) : null
                      })()}
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleRefreshSingle(t.id)}
                        disabled={refreshingId === t.id}
                        title="Atualizar"
                      >
                        {refreshingId === t.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <RefreshCw className="size-4" />
                        )}
                      </Button>

                      {t.status === 'APPROVED' && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handleOpenEdit(t)}
                          title="Editar"
                        >
                          <Pencil className="size-4" />
                        </Button>
                      )}

                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleDelete(t.id, t.name)}
                        title="Excluir"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </TooltipProvider>
      )}

      {/* Provision confirmation */}
      <Dialog open={provisionConfirmOpen} onOpenChange={setProvisionConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Criar templates padrão</DialogTitle>
            <DialogDescription>
              Isso criará os templates padrão do FloraClin na sua conta Meta.
              Templates já existentes serão ignorados.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button
              onClick={() => {
                setProvisionConfirmOpen(false)
                handleProvision()
              }}
            >
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editor sheet */}
      <WhatsAppTemplateEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        template={editingTemplate}
        onSaved={handleEditorSaved}
      />
    </div>
  )
}
