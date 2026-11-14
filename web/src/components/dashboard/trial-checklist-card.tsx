'use client'

import { NEW_APPOINTMENT_PATH, NEW_PATIENT_PATH } from '@/lib/deep-links'
import Link from 'next/link'
import { toast } from 'sonner'
import { CheckCircle2, ChevronRight, Circle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useRequestImportHelp } from '@/hooks/mutations/use-tenant-mutations'
import type { ActivationState } from '@/lib/activation'

type Step = { label: string; href: (latestPatientId: string | null) => string; isDone: (a: ActivationState) => boolean }

const STEPS: Step[] = [
  { label: 'Concluir a configuração', href: () => '/onboarding', isDone: (a) => a.onboardingDone },
  { label: 'Cadastrar o primeiro paciente', href: () => NEW_PATIENT_PATH, isDone: (a) => a.hasPatient },
  { label: 'Agendar o primeiro atendimento', href: () => NEW_APPOINTMENT_PATH, isDone: (a) => a.hasAppointment },
  {
    label: 'Registrar o primeiro procedimento no diagrama facial',
    href: (id) => (id ? `/pacientes/${id}/atendimento?new=1` : NEW_PATIENT_PATH),
    isDone: (a) => a.hasProcedureRecord,
  },
  { label: 'Enviar a primeira mensagem no WhatsApp', href: () => '/whatsapp', isDone: (a) => a.hasWhatsappSend },
]

export function TrialChecklistCard({
  activation,
  latestPatientId = null,
  canRequestImport = false,
  importHelpRequested = false,
}: {
  activation: ActivationState | null | undefined
  latestPatientId?: string | null
  canRequestImport?: boolean
  importHelpRequested?: boolean
}) {
  if (!activation || activation.subscriptionStatus !== 'trialing') return null

  const rows = STEPS.map((step) => ({ label: step.label, href: step.href(latestPatientId), done: step.isDone(activation) }))
  const nextIndex = rows.findIndex((row) => !row.done)
  const doneCount = rows.filter((row) => row.done).length
  const offersImport = canRequestImport && !importHelpRequested
  if (doneCount === STEPS.length && !offersImport) return null

  return (
    <section aria-labelledby="checklist-title" data-testid="trial-checklist" className="rounded-lg border border-sage/30 bg-sage/5 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="checklist-title" className="text-[15px] font-semibold text-charcoal">Primeiros passos</h2>
        <p className="text-xs text-mid">{doneCount} de {STEPS.length}</p>
      </div>
      <ul className="space-y-1">
        {rows.map((row, i) => (
          <li key={row.label}>
            {row.done ? (
              <div className="flex min-h-11 items-center gap-2 px-2 text-sm text-mid">
                <CheckCircle2 className="size-4 shrink-0 text-sage" />
                <span className="line-through decoration-mid/40">{row.label}</span>
              </div>
            ) : (
              <Link
                href={row.href}
                aria-current={i === nextIndex ? 'step' : undefined}
                className={cn(
                  'flex min-h-11 items-center gap-2 rounded-md px-2 text-sm transition-colors',
                  i === nextIndex ? 'bg-forest font-medium text-cream hover:bg-sage' : 'text-charcoal hover:bg-sage/10',
                )}
              >
                <Circle className={cn('size-4 shrink-0', i === nextIndex ? 'text-cream/70' : 'text-mid')} />
                <span className="flex-1">{row.label}</span>
                <ChevronRight className="size-4 shrink-0 opacity-70" />
              </Link>
            )}
          </li>
        ))}
      </ul>
      {canRequestImport && <ImportHelpRow requested={importHelpRequested} />}
    </section>
  )
}

function ImportHelpRow({ requested }: { requested: boolean }) {
  const request = useRequestImportHelp()
  const done = requested || request.isSuccess

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-sage/20 pt-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 text-sm">
        {done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-sage" /> : <Circle className="mt-0.5 size-4 shrink-0 text-mid" />}
        <div>
          <p className={done ? 'text-mid' : 'text-charcoal'}>Importar pacientes de outro sistema</p>
          <p className="text-xs text-mid">
            {done
              ? 'A gente entra em contato pelo WhatsApp para receber seus arquivos.'
              : 'Tem pacientes em outro sistema ou planilha? A gente ajuda a trazer.'}
          </p>
        </div>
      </div>
      {!done && (
        <Button
          variant="outline"
          className="self-start sm:self-auto"
          disabled={request.isPending}
          onClick={() => request.mutate(undefined, { onError: (err) => toast.error(err.message) })}
        >
          Quero ajuda
        </Button>
      )}
    </div>
  )
}
