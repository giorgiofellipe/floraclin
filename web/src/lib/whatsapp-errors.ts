const WHATSAPP_META_ERROR_LABELS: Record<string, string> = {
  '470': 'Janela de 24h expirada.',
  '131026': 'Número sem WhatsApp ou inválido.',
  '131047': 'Janela de 24h expirada.',
  '131049': 'Meta limitou a entrega.',
  '131051': 'Tipo de mensagem não suportado.',
  '130472': 'Entrega limitada por política da Meta.',
}

export function getWhatsAppErrorLabel(code: string | null | undefined): string | null {
  if (!code) return null
  if (code.startsWith('132')) return 'Problema no template aprovado pela Meta.'
  return WHATSAPP_META_ERROR_LABELS[code] ?? `Falha no WhatsApp (código ${code}).`
}

export function isKnownWhatsAppErrorCode(code: string): boolean {
  return Object.hasOwn(WHATSAPP_META_ERROR_LABELS, code)
}
