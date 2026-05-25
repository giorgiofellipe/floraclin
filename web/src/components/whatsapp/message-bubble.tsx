'use client'

import { cn } from '@/lib/utils'
import { Check, CheckCheck } from 'lucide-react'

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
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'queued' || status === 'sent') {
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
  return null
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isOutbound = message.direction === 'outbound'
  const displayText = message.body || (message.templateName ? `[Template: ${message.templateName}]` : '[Mensagem sem texto]')

  return (
    <div className={cn('flex w-full', isOutbound ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'relative max-w-[75%] rounded-lg px-3 py-1.5 text-sm shadow-sm',
          isOutbound
            ? 'bg-[#D9FDD3] text-[#111B21]'
            : 'bg-white text-[#111B21]'
        )}
      >
        {message.mediaType && message.mediaUrl && (
          <div className="mb-1">
            {message.mediaType === 'image' ? (
              // eslint-disable-next-line @next/next/no-img-element
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

        <span className={cn('float-right mt-1 ml-2 flex items-center gap-0.5', isOutbound ? 'text-[#667781]' : 'text-[#667781]')}>
          <span className="text-[11px] leading-none">{formatTime(message.timestamp)}</span>
          {isOutbound && <StatusIcon status={message.deliveryStatus} />}
        </span>
      </div>
    </div>
  )
}
