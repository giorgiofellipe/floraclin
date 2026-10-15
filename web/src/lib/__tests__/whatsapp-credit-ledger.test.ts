import { describe, expect, it } from 'vitest'
import { describeLedgerEntry, type LedgerEntry } from '../whatsapp-credit-ledger'

function entry(overrides: Partial<LedgerEntry>): LedgerEntry {
  return {
    id: 'l1', kind: 'spend', amount: -1, refundReason: null,
    actor: { type: 'user', name: 'Ana Souza' },
    recipientName: 'Maria Silva',
    item: { kind: 'text', label: null },
    createdAt: '2026-10-15T13:00:00.000Z',
    ...overrides,
  }
}

const text = (e: LedgerEntry) => describeLedgerEntry(e).map((p) => p.text).join('')
const strong = (e: LedgerEntry) => describeLedgerEntry(e).filter((p) => p.strong).map((p) => p.text)

describe('describeLedgerEntry', () => {
  it.each<[string, Partial<LedgerEntry>, string]>([
    ['user template', { item: { kind: 'template', label: 'Link de anamnese' } }, 'Ana Souza enviou Link de anamnese para Maria Silva'],
    ['user text', {}, 'Ana Souza enviou uma mensagem para Maria Silva'],
    ['user media', { item: { kind: 'media', label: null } }, 'Ana Souza enviou um arquivo para Maria Silva'],
    ['user document', { item: { kind: 'document', label: 'Atestado' } }, 'Ana Souza enviou o documento Atestado para Maria Silva'],
    ['removed user', { actor: { type: 'user', name: null } }, 'Usuário removido enviou uma mensagem para Maria Silva'],
    ['patient copy', { actor: { type: 'patient', name: 'Maria Silva' }, item: { kind: 'document', label: 'Termo de consentimento' } }, 'Maria Silva pediu uma cópia do Termo de consentimento'],
    ['patient-triggered resume template', { actor: { type: 'patient', name: 'Maria Silva' }, item: { kind: 'template', label: 'Retomar conversa' } }, 'Envio automático: Retomar conversa para Maria Silva'],
    ['system template', { actor: { type: 'system', name: null }, item: { kind: 'template', label: 'Lembrete de consulta' } }, 'Envio automático: Lembrete de consulta para Maria Silva'],
    ['system text', { actor: { type: 'system', name: null } }, 'Envio automático: uma mensagem para Maria Silva'],
    ['refund send_failed template', { kind: 'refund', amount: 1, refundReason: 'send_failed', item: { kind: 'template', label: 'Link de anamnese' } }, 'Estorno: o envio de Link de anamnese para Maria Silva falhou'],
    ['refund send_failed document', { kind: 'refund', amount: 1, refundReason: 'send_failed', item: { kind: 'document', label: 'Atestado' } }, 'Estorno: o envio do documento Atestado para Maria Silva falhou'],
    ['refund delivery_failed', { kind: 'refund', amount: 3, refundReason: 'delivery_failed', item: { kind: 'template', label: 'Aniversário' } }, 'Estorno: o WhatsApp não entregou Aniversário para Maria Silva'],
  ])('%s', (_name, overrides, expected) => {
    expect(text(entry(overrides))).toBe(expected)
  })

  it('marks the names, not the glue words, as strong', () => {
    expect(strong(entry({ item: { kind: 'document', label: 'Atestado' } }))).toEqual(['Ana Souza', 'Atestado', 'Maria Silva'])
  })

  it('falls back to "um documento" when a document has no label', () => {
    expect(text(entry({ item: { kind: 'document', label: null } }))).toBe('Ana Souza enviou um documento para Maria Silva')
  })
})
