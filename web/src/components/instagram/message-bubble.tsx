'use client'

import { cn } from '@/lib/utils'
import { Check, CheckCheck, Clock } from 'lucide-react'
import type { InstagramMessage } from '@/db/queries/instagram'

export type { InstagramMessage }

export interface BubbleReaction {
  emoji: string
  senderType: 'us' | 'them'
}

interface MessageBubbleProps {
  message: InstagramMessage
  reactions?: BubbleReaction[]
}

function formatTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

/**
 * Only render Instagram-supplied media URLs that are HTTPS and target a
 * public host. Guards against SSRF-style links pointing at localhost,
 * private IP ranges, link-local, or file://-style schemes that could leak
 * from webhook payloads.
 */
function isSafeMediaUrl(u: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(u)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  const host = parsed.hostname.toLowerCase()
  if (!host) return false
  if (host === 'localhost' || host === '0.0.0.0' || host === '::1') return false
  // IPv4 literal — block loopback (127.x), link-local (169.254.x), and
  // RFC1918 private ranges.
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (ipv4Match) {
    const [a, b] = [Number(ipv4Match[1]), Number(ipv4Match[2])]
    if (a === 127) return false
    if (a === 10) return false
    if (a === 169 && b === 254) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
  }
  // IPv6 literals (bracketed): treat anything non-loopback as a real host
  // would already have parsed. Block explicit loopback / link-local prefix.
  if (host.startsWith('[') && (host.includes('::1') || host.startsWith('[fe80'))) {
    return false
  }
  return true
}

function deriveDisplayText(message: InstagramMessage): string | null {
  if (message.body) return message.body
  // For media or story replies we render the media/quoted-story themselves;
  // the bubble doesn't need filler text.
  if (message.mediaType) return null
  if (message.messageType === 'story_reply') return null
  return '[Mensagem sem texto]'
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'queued') {
    return <Clock className="size-3.5 text-amber-500" />
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
  return null
}

export function MessageBubble({ message, reactions }: MessageBubbleProps) {
  const isOutbound = message.direction === 'outbound'
  const isReactionRow = message.messageType === 'reaction'
  const isStoryReply = message.messageType === 'story_reply'

  // Standalone reaction row: render minimal inline indicator.
  if (isReactionRow) {
    return (
      <div className={cn('flex w-full', isOutbound ? 'justify-end' : 'justify-start')}>
        <span className="text-xs text-muted-foreground">
          {isOutbound ? 'Você reagiu' : 'Reagiu'}{' '}
          <span className="text-base align-middle">{message.reactionEmoji ?? ''}</span>
        </span>
      </div>
    )
  }

  const displayText = deriveDisplayText(message)
  const storyMediaSafe =
    !!message.storyMediaUrl && isSafeMediaUrl(message.storyMediaUrl)
  const mediaUrlSafe = !!message.mediaUrl && isSafeMediaUrl(message.mediaUrl)

  return (
    <div className={cn('flex w-full', isOutbound ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'relative max-w-[75%] rounded-lg px-3 py-1.5 text-sm shadow-sm',
          isOutbound
            ? 'bg-[#D9FDD3] text-[#111B21]'
            : 'bg-white text-[#111B21]',
        )}
      >
        {isStoryReply && message.storyMediaUrl && (
          <div className="mb-1.5 flex gap-2 rounded border-l-2 border-[#8696A0] bg-black/5 p-1.5">
            {storyMediaSafe ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={message.storyMediaUrl ?? undefined}
                alt="Story"
                className="size-12 rounded object-cover"
              />
            ) : (
              <div className="flex size-12 items-center justify-center rounded bg-black/10 text-[10px] text-[#667781]">
                Mídia indisponível
              </div>
            )}
            <div className="flex flex-col justify-center">
              <span className="text-[11px] font-medium text-[#667781]">Resposta ao story</span>
            </div>
          </div>
        )}

        {message.mediaType && message.mediaUrl && (
          <div className="mb-1">
            {!mediaUrlSafe ? (
              <span className="text-xs text-[#667781]">Mídia indisponível</span>
            ) : message.mediaType === 'image' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={message.mediaUrl}
                alt="Imagem"
                className="max-h-64 rounded object-cover"
              />
            ) : message.mediaType === 'video' ? (
              <video
                src={message.mediaUrl}
                controls
                className="max-h-64 rounded"
              />
            ) : message.mediaType === 'audio' ? (
              <audio src={message.mediaUrl} controls className="w-full" />
            ) : (
              <a
                href={message.mediaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 underline"
              >
                {message.mediaFilename || 'Baixar arquivo'}
              </a>
            )}
          </div>
        )}

        {displayText && (
          <span className="whitespace-pre-wrap break-words">{displayText}</span>
        )}

        <span className="float-right mt-1.5 ml-2 flex items-end gap-0.5 text-[#667781]">
          <span className="text-[11px] leading-tight">{formatTime(message.timestamp)}</span>
          {isOutbound && <StatusIcon status={message.deliveryStatus} />}
        </span>

        {reactions && reactions.length > 0 && (
          <div
            className={cn(
              'absolute -bottom-2 flex gap-0.5 rounded-full bg-white px-1.5 py-0.5 text-xs shadow ring-1 ring-black/5',
              isOutbound ? 'right-2' : 'left-2',
            )}
          >
            {reactions.map((r, i) => (
              <span key={`${r.emoji}-${i}`} title={r.senderType === 'us' ? 'Você' : 'Eles'}>
                {r.emoji}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
