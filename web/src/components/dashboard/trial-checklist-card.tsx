'use client'

import Link from 'next/link'
import { toast } from 'sonner'
import { CheckCircle2, Circle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useRequestImportHelp } from '@/hooks/mutations/use-tenant-mutations'
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
  canRequestImport = false,
  importHelpRequested = false,
}: {
  activation: ActivationState | null | undefined
  canRequestImport?: boolean
  importHelpRequested?: boolean
}) {
  if (!activation || activation.subscriptionStatus !== 'trialing') return null

  const rows = STEPS.map((step) => ({ ...step, done: step.isDone(activation) }))
  const doneCount = rows.filter((row) => row.done).length
  const offersImport = canRequestImport && !importHelpRequested
  if (doneCount === STEPS.length && !offersImport) return null

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
      {canRequestImport && <ImportHelpRow requested={importHelpRequested} />}
    </div>
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
