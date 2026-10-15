export type CreditActor = { type: 'user'; userId: string } | { type: 'patient' } | { type: 'system' }

export interface CreditRecipient {
  patientId: string | null
  conversationId?: string | null
  name: string | null
}

export interface CreditContext {
  actor: CreditActor
  recipient: CreditRecipient
  documentLabel?: string
}

export type LedgerItemKind = 'template' | 'text' | 'media' | 'document'
export type LedgerRefundReason = 'send_failed' | 'delivery_failed'

export interface LedgerEntry {
  id: string
  kind: 'spend' | 'refund'
  amount: number
  refundReason: LedgerRefundReason | null
  actor: { type: CreditActor['type']; name: string | null }
  recipientName: string
  item: { kind: LedgerItemKind; label: string | null }
  createdAt: string
}

export interface LedgerPeriod {
  id: string
  start: string
  end: string
  used: number
  total: number
}

export interface LedgerPage {
  periods: LedgerPeriod[]
  periodId: string
  entries: LedgerEntry[]
  nextCursor: string | null
}

export type SentencePart = { text: string; strong: boolean }

const plain = (text: string): SentencePart => ({ text, strong: false })
const bold = (text: string): SentencePart => ({ text, strong: true })

// "enviou X", "não entregou X"
function itemObject(item: LedgerEntry['item']): SentencePart[] {
  switch (item.kind) {
    case 'template': return [bold(item.label ?? 'template')]
    case 'text': return [plain('uma mensagem')]
    case 'media': return [plain('um arquivo')]
    case 'document': return item.label ? [plain('o documento '), bold(item.label)] : [plain('um documento')]
  }
}

// "o envio de X"
function itemAfterDe(item: LedgerEntry['item']): SentencePart[] {
  switch (item.kind) {
    case 'template': return [plain('de '), bold(item.label ?? 'template')]
    case 'text': return [plain('de uma mensagem')]
    case 'media': return [plain('de um arquivo')]
    case 'document': return item.label ? [plain('do documento '), bold(item.label)] : [plain('de um documento')]
  }
}

export function describeLedgerEntry(entry: LedgerEntry): SentencePart[] {
  const to = [plain(' para '), bold(entry.recipientName)]

  if (entry.kind === 'refund') {
    if (entry.refundReason === 'delivery_failed') {
      return [plain('Estorno: o WhatsApp não entregou '), ...itemObject(entry.item), ...to]
    }
    return [plain('Estorno: o envio '), ...itemAfterDe(entry.item), ...to, plain(' falhou')]
  }

  switch (entry.actor.type) {
    case 'user':
      return [bold(entry.actor.name ?? 'Usuário removido'), plain(' enviou '), ...itemObject(entry.item), ...to]
    case 'patient':
      if (entry.item.kind === 'document') {
        return [bold(entry.recipientName), plain(' pediu uma cópia do '), bold(entry.item.label ?? 'documento')]
      }
      // Only the resume template that precedes a patient-requested copy lands here.
      return [plain('Envio automático: '), ...itemObject(entry.item), ...to]
    case 'system':
      return [plain('Envio automático: '), ...itemObject(entry.item), ...to]
  }
}
