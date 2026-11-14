'use client'

import { MessageCircle } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { useWriteGuard } from '@/components/layout/subscription-access'
import { usePatientWhatsapp } from '@/hooks/use-patient-whatsapp'
import { cn } from '@/lib/utils'

interface PatientWhatsappButtonProps {
  patient: { id: string; phone: string; fullName: string }
  inAppAllowed: boolean
  className?: string
}

export function PatientWhatsappButton({ patient, inAppAllowed, className }: PatientWhatsappButtonProps) {
  const guardWrite = useWriteGuard()
  const { canUseInApp, waHref, opening, openInApp } = usePatientWhatsapp(patient, inAppAllowed)
  const label = `WhatsApp de ${patient.fullName}`

  if (canUseInApp) {
    return (
      <Button
        type="button"
        variant="ghost"
        aria-label={label}
        title="WhatsApp"
        disabled={opening}
        onClick={guardWrite(openInApp)}
        className={className}
      >
        <MessageCircle className="size-4" />
      </Button>
    )
  }
  if (!waHref) return null
  return (
    <a
      href={waHref}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title="WhatsApp"
      className={cn(buttonVariants({ variant: 'ghost' }), className)}
    >
      <MessageCircle className="size-4" />
    </a>
  )
}
