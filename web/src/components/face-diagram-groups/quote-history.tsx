'use client'

import { useId } from 'react'
import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatBrDate } from '@/lib/dates'
import { formatCurrency } from '@/lib/utils'
import { useDiagramQuotes, type DiagramQuoteJson } from '@/hooks/queries/use-face-diagram-groups'

function whatsappNote(quote: DiagramQuoteJson): string | null {
  if (!quote.whatsappRequestedAt) return null
  const date = formatBrDate(quote.whatsappRequestedAt)
  if (quote.whatsappStatus === 'sent') return `Enviado por WhatsApp em ${date}`
  if (quote.whatsappStatus === 'queued') return `Na fila do WhatsApp desde ${date}`
  return null
}

export function QuoteHistory({ groupId }: { groupId: string }) {
  const { data: quotes } = useDiagramQuotes(groupId)
  const titleId = useId()

  if (!quotes || quotes.length === 0) return null

  return (
    <section
      aria-labelledby={titleId}
      className="space-y-3 rounded-[3px] bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
    >
      <h3 id={titleId} className="text-sm font-medium text-charcoal">
        Orçamentos gerados
      </h3>
      <ul className="divide-y divide-sage/10">
        {quotes.map((quote) => {
          const note = whatsappNote(quote)
          return (
            <li key={quote.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="text-sm text-charcoal">
                  {formatBrDate(quote.createdAt)} · {formatCurrency(quote.total)}
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
