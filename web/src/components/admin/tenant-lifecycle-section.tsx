import { formatInTimeZone } from 'date-fns-tz'
import { BR_TZ } from '@/lib/dates'
import type { getLifecycleHistory } from '@/db/queries/lifecycle'

type Lifecycle = Awaited<ReturnType<typeof getLifecycleHistory>>

const LABEL = 'text-[10px] uppercase tracking-[0.15em] text-mid font-medium'

const CHANNEL_LABEL: Record<string, string> = { whatsapp: 'WhatsApp', email: 'E-mail' }
const STATUS_LABEL: Record<string, string> = {
  pending: 'pendente',
  sent: 'enviada',
  failed: 'falhou',
  skipped: 'ignorada',
}

function formatInstant(iso: string) {
  return formatInTimeZone(new Date(iso), BR_TZ, 'dd/MM HH:mm')
}

export function TenantLifecycleSection({ lifecycle }: { lifecycle?: Lifecycle }) {
  if (!lifecycle || (lifecycle.sends.length === 0 && lifecycle.replies.length === 0)) {
    return null
  }

  return (
    <div className="mt-4 space-y-4">
      {lifecycle.sends.length > 0 && (
        <div className="space-y-2">
          <span className={LABEL}>Mensagens de teste</span>
          <div className="space-y-1.5">
            {lifecycle.sends.map((send) => (
              <div
                key={`${send.messageKey}-${send.channel}`}
                className="rounded-md bg-white border border-sage/10 px-3 py-2"
              >
                <div className="flex items-center gap-3 text-xs text-charcoal">
                  <span className="font-medium">{send.messageKey}</span>
                  <span className="text-mid">{CHANNEL_LABEL[send.channel] ?? send.channel}</span>
                  <span className="text-mid">{STATUS_LABEL[send.status] ?? send.status}</span>
                  <span className="ml-auto tabular-nums text-mid">{formatInstant(send.claimedAt)}</span>
                </div>
                {send.error && <p className="mt-1 text-xs text-red-600">{send.error}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {lifecycle.replies.length > 0 && (
        <div className="space-y-2">
          <span className={LABEL}>Respostas</span>
          <div className="space-y-1.5">
            {lifecycle.replies.map((reply, index) => (
              <div
                key={`${reply.receivedAt}-${index}`}
                className="rounded-md bg-white border border-sage/10 px-3 py-2"
              >
                <div className="flex items-center gap-3 text-xs text-mid">
                  <span className="tabular-nums">{formatInstant(reply.receivedAt)}</span>
                  <span>{reply.messageKey}</span>
                </div>
                <p className="mt-1 text-sm text-charcoal whitespace-pre-wrap">{reply.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
