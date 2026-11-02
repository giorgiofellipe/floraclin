'use client'

import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatBrDate } from '@/lib/dates'
import { queryKeys } from '@/hooks/queries/query-keys'
import type { DiagramQuote } from '@/db/queries/face-diagram-quotes'

type QuoteWithUrl = Omit<DiagramQuote, 'createdAt' | 'whatsappRequestedAt'> & {
  createdAt: string
  whatsappRequestedAt: string | null
  url: string | null
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export function useDiagramQuotes(groupId: string) {
  return useQuery({
    queryKey: [...queryKeys.diagramGroups.detail(groupId), 'quotes'],
    queryFn: async () => {
      const res = await fetch(`/api/face-diagram-groups/${groupId}/quotes`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()).data as QuoteWithUrl[]
    },
  })
}

function whatsappNote(quote: QuoteWithUrl): string | null {
  if (!quote.whatsappRequestedAt) return null
  const date = formatBrDate(quote.whatsappRequestedAt)
  if (quote.whatsappStatus === 'sent') return `Enviado por WhatsApp em ${date}`
  if (quote.whatsappStatus === 'queued') return `Na fila do WhatsApp desde ${date}`
  return null
}

export function QuoteHistory({ groupId }: { groupId: string }) {
  const { data: quotes } = useDiagramQuotes(groupId)

  if (!quotes || quotes.length === 0) return null

  return (
    <section
      aria-label="Orçamentos gerados"
      className="space-y-3 rounded-[3px] bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
    >
      <h3 className="text-sm font-medium text-charcoal">Orçamentos gerados</h3>
      <ul className="divide-y divide-sage/10">
        {quotes.map((quote) => {
          const note = whatsappNote(quote)
          return (
            <li key={quote.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="text-sm text-charcoal">
                  {formatBrDate(quote.createdAt)} · {brl.format(quote.total)}
                </p>
                {note && <p className="text-xs text-mid">{note}</p>}
              </div>
              {quote.url && (
                <Button
                  variant="outline"
                  size="sm"
                  render={<a href={quote.url} target="_blank" rel="noopener noreferrer" />}
                >
                  <ExternalLink className="size-3.5" />
                  Abrir
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
