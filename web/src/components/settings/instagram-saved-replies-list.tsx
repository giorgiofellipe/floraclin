'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Archive,
  MessageSquareText,
  Pencil,
  Plus,
  Search,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'
import { InstagramSavedReplyEditor } from './instagram-saved-reply-editor'

// ─── Types ──────────────────────────────────────────────────────────

interface InstagramSavedReply {
  id: string
  tenantId: string
  name: string
  body: string
  variableKeys: string[]
  purposeKey: string | null
  archivedAt: Date | string | null
  createdAt: Date | string
  updatedAt: Date | string
}

// ─── Component ──────────────────────────────────────────────────────

export function InstagramSavedRepliesList() {
  const [replies, setReplies] = useState<InstagramSavedReply[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingReplyId, setEditingReplyId] = useState<string | undefined>(
    undefined,
  )
  const [archivingId, setArchivingId] = useState<string | null>(null)

  // ─── Fetch saved replies ────────────────────────────────────────

  const fetchReplies = useCallback(async () => {
    try {
      const res = await fetch('/api/instagram/saved-replies')
      if (!res.ok) throw new Error('Erro ao buscar respostas salvas')
      const data = await res.json()
      const items: InstagramSavedReply[] = Array.isArray(data)
        ? data
        : data.data ?? data.items ?? []
      setReplies(items)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Erro ao buscar respostas salvas',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchReplies()
  }, [fetchReplies])

  // ─── Actions ────────────────────────────────────────────────────

  function handleOpenCreate() {
    setEditingReplyId(undefined)
    setEditorOpen(true)
  }

  function handleOpenEdit(id: string) {
    setEditingReplyId(id)
    setEditorOpen(true)
  }

  function handleEditorOpenChange(open: boolean) {
    setEditorOpen(open)
    if (!open) {
      // Refresh after the editor closes so newly created/updated rows show up.
      fetchReplies()
    }
  }

  async function handleArchive(id: string, name: string) {
    const confirmed = window.confirm(
      `Tem certeza que deseja arquivar a resposta "${name}"? Ela não poderá mais ser usada.`,
    )
    if (!confirmed) return

    setArchivingId(id)
    try {
      const res = await fetch(`/api/instagram/saved-replies/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Erro ao arquivar resposta')
      }
      toast.success('Resposta arquivada')
      await fetchReplies()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Erro ao arquivar resposta',
      )
    } finally {
      setArchivingId(null)
    }
  }

  // ─── Filtering ──────────────────────────────────────────────────

  const filtered = replies.filter((r) => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return (
      r.name.toLowerCase().includes(q) || r.body.toLowerCase().includes(q)
    )
  })

  // ─── Render ─────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Section header */}
      <div className="flex items-center gap-2 mb-1">
        <h3 className="uppercase tracking-wider text-xs font-medium text-mid">
          Respostas Salvas
        </h3>
        <div className="flex-1 h-px bg-blush/60" />
      </div>

      {/* Actions bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-mid" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por nome ou conteúdo..."
            className="pl-8"
          />
        </div>

        <Button
          size="sm"
          onClick={handleOpenCreate}
          className="bg-forest text-cream hover:bg-sage"
        >
          <Plus className="size-3.5" />
          Nova resposta
        </Button>
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
                <div className="flex-1" />
                <Skeleton className="h-7 w-7" />
                <Skeleton className="h-7 w-7" />
              </div>
              <Skeleton className="mt-2 h-4 w-3/4" />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <div className="rounded-[3px] border border-dashed border-[#E8ECEF] p-8 text-center">
          <MessageSquareText className="mx-auto size-8 text-mid/40 mb-2" />
          <p className="text-sm text-mid">
            {replies.length === 0
              ? 'Nenhuma resposta salva.'
              : 'Nenhuma resposta encontrada com os filtros aplicados.'}
          </p>
          {replies.length === 0 && (
            <p className="mt-1 text-xs text-mid">
              Clique em &quot;Nova resposta&quot; para criar a primeira.
            </p>
          )}
        </div>
      )}

      {/* Reply cards */}
      {!loading && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((r) => (
            <div
              key={r.id}
              className="rounded-[3px] border border-[#E8ECEF] bg-white p-4"
            >
              <div className="flex items-start gap-3">
                {/* Reply info */}
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-sm font-medium text-charcoal truncate">
                      {r.name}
                    </h4>
                    {r.variableKeys.length > 0 && (
                      <span className="text-[10px] uppercase tracking-wider text-mid">
                        {r.variableKeys.length} variá
                        {r.variableKeys.length === 1 ? 'vel' : 'veis'}
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-mid/80 line-clamp-2 whitespace-pre-wrap">
                    {r.body}
                  </p>

                  <p className="text-[11px] text-mid">
                    Atualizado em {formatDateTime(r.updatedAt)}
                  </p>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleOpenEdit(r.id)}
                    title="Editar"
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleArchive(r.id, r.name)}
                    disabled={archivingId === r.id}
                    title="Arquivar"
                  >
                    <Archive className="size-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Editor sheet */}
      <InstagramSavedReplyEditor
        replyId={editingReplyId}
        open={editorOpen}
        onOpenChange={handleEditorOpenChange}
      />
    </div>
  )
}
