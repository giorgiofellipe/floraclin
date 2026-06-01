import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { PendingRescheduleList } from '@/components/scheduling/pending-reschedule-list'

export default function PendingReschedulePage() {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link
          href="/agenda"
          className="inline-flex items-center gap-1.5 text-[13px] text-mid hover:text-forest transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          Voltar para agenda
        </Link>
      </div>
      <div>
        <h1 className="text-lg font-medium text-charcoal">Reagendamentos Pendentes</h1>
        <p className="text-sm text-mid mt-1">
          Consultas cujos pacientes solicitaram reagendamento via WhatsApp.
        </p>
      </div>
      <PendingRescheduleList />
    </div>
  )
}
