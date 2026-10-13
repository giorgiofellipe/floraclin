'use client'

import { cn } from '@/lib/utils'
import { getWhatsAppErrorLabel } from '@/lib/whatsapp-errors'
import { Check, CheckCheck, Clock, Loader2, RotateCcw } from 'lucide-react'

export interface Message {
  id: string
  conversationId: string
  metaMessageId: string | null
  direction: 'inbound' | 'outbound'
  body: string | null
  mediaType: string | null
  mediaUrl: string | null
  mediaFilename: string | null
  templateName: string | null
  deliveryStatus: string
  errorCode: string | null
  timestamp: string
  createdAt: string
}

interface MessageBubbleProps {
  message: Message
  onRetry?: (message: Message) => void
  retrying?: boolean
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'queued') {
    return <Clock className="size-3.5 text-amber-500" />
  }
  if (status === 'expired') {
    return <span className="text-[10px] text-muted-foreground">Expirada</span>
  }
  if (status === 'sent') {
    return <Check className="size-3.5 text-[#8696A0]" />
  }
  if (status === 'delivered') {
    return <CheckCheck className="size-3.5 text-[#8696A0]" />
  }
  if (status === 'read') {
    return <CheckCheck className="size-3.5 text-[#53BDEB]" />
  }
  if (status === 'failed') {
    return <span className="text-[10px] text-destructive">Falhou</span>
  }
  if (status === 'retrying') {
    return <Loader2 className="size-3.5 animate-spin text-[#8696A0]" />
  }
  if (status === 'retried') {
    return <span className="text-[10px] text-muted-foreground">Reenviada</span>
  }
  return null
}

export function MessageBubble({ message, onRetry, retrying = false }: MessageBubbleProps) {
  const isOutbound = message.direction === 'outbound'
  const isQueued = message.deliveryStatus === 'queued'
  const isExpired = message.deliveryStatus === 'expired'
  const isFailed = message.deliveryStatus === 'failed'
  const failedReason = isFailed ? getWhatsAppErrorLabel(message.errorCode) : null
  const displayText = message.body || (message.templateName ? `[Template: ${message.templateName}]` : '[Mensagem sem texto]')

  return (
    <div className={cn('flex w-full', isOutbound ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'relative max-w-[75%] rounded-lg px-3 py-1.5 text-sm shadow-sm',
          isOutbound
            ? 'bg-[#D9FDD3] text-[#111B21]'
            : 'bg-white text-[#111B21]',
          isExpired && 'opacity-50',
        )}
      >
        {message.mediaType && message.mediaUrl && (
          <div className="mb-1">
            {message.mediaType === 'image' ? (
              <img
                src={message.mediaUrl}
                alt="Imagem"
                className="max-h-64 rounded object-cover"
              />
            ) : (
              <a
                href={message.mediaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 underline"
              >
                {message.mediaType === 'video' ? 'Abrir video' : message.mediaType === 'audio' ? 'Ouvir audio' : 'Baixar arquivo'}
              </a>
            )}
          </div>
        )}

        <span className="whitespace-pre-wrap break-words">{displayText}</span>

        {isQueued && (
          <div className="mt-1 text-[10px] text-amber-600">
            Na fila — aguardando resposta
          </div>
        )}

        {isFailed && (failedReason || onRetry) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-destructive">
            {failedReason && <span>{failedReason}</span>}
            {onRetry && (
              <button
                type="button"
                onClick={() => onRetry(message)}
                disabled={retrying}
                className="inline-flex items-center gap-1 rounded px-1 py-0.5 font-medium underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
              >
                {retrying ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <RotateCcw className="size-3" />
                )}
                Tentar novamente
              </button>
            )}
          </div>
        )}

        <span className="float-right mt-1.5 ml-2 flex items-end gap-0.5 text-[#667781]">
          <span className="text-[11px] leading-tight">{formatTime(message.timestamp)}</span>
          {isOutbound && <StatusIcon status={message.deliveryStatus} />}
        </span>
      </div>
    </div>
  )
}
