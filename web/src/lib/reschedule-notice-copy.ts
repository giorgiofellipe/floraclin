import type { RescheduleNotification } from '@/lib/whatsapp-reschedule'

export const RESCHEDULE_NOTICE_TOASTS: Record<Exclude<RescheduleNotification, 'sent'>, string> = {
  unavailable: 'Reagendado. O aviso por WhatsApp não está disponível para esta clínica.',
  no_phone: 'Reagendado. O paciente não tem um telefone válido para o aviso por WhatsApp.',
  no_credits: 'Reagendado. Sem créditos de WhatsApp para enviar o aviso.',
  failed: 'Reagendado, mas o aviso por WhatsApp não foi enviado.',
}

export const RESCHEDULE_NOTICE_SENT = 'Reagendado. Paciente avisado por WhatsApp.'
