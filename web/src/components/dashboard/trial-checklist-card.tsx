import Link from 'next/link'
import { CheckCircle2, Circle } from 'lucide-react'
import type { ActivationState } from '@/lib/activation'

const STEPS: { label: string; href: string; isDone: (a: ActivationState) => boolean }[] = [
  { label: 'Concluir a configuração', href: '/onboarding', isDone: (a) => a.onboardingDone },
  { label: 'Cadastrar o primeiro paciente', href: '/pacientes?novo=1', isDone: (a) => a.hasPatient },
  { label: 'Agendar o primeiro atendimento', href: '/agenda?open=new', isDone: (a) => a.hasAppointment },
  {
    label: 'Registrar o primeiro procedimento no diagrama facial',
    href: '/pacientes',
    isDone: (a) => a.hasProcedureRecord,
  },
  { label: 'Enviar a primeira mensagem no WhatsApp', href: '/whatsapp', isDone: (a) => a.hasWhatsappSend },
]

export function TrialChecklistCard({
  activation,
}: {
  activation: ActivationState | null | undefined
}) {
  if (!activation || activation.subscriptionStatus !== 'trialing') return null

  const rows = STEPS.map((step) => ({ ...step, done: step.isDone(activation) }))
  const doneCount = rows.filter((row) => row.done).length
  if (doneCount === STEPS.length) return null

  return (
    <div data-testid="trial-checklist" className="rounded-lg border border-sage/30 bg-sage/5 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium text-charcoal">Primeiros passos</p>
        <p className="text-xs text-mid">{doneCount} de {STEPS.length}</p>
      </div>
      <ul className="space-y-1.5">
        {rows.map((row) => (
          <li key={row.href} className="flex items-center gap-2 text-sm">
            {row.done ? (
              <>
                <CheckCircle2 className="size-4 text-sage" />
                <span className="text-mid">{row.label}</span>
              </>
            ) : (
              <>
                <Circle className="size-4 text-mid" />
                <Link href={row.href} className="text-charcoal hover:underline">
                  {row.label}
                </Link>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
