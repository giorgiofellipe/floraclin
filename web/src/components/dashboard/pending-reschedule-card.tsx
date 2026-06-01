import Link from 'next/link'
import { CalendarClock } from 'lucide-react'

export function PendingRescheduleCard({ count }: { count: number }) {
  if (count === 0) return null

  return (
    <Link
      href="/agenda/reagendamentos"
      className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-3 transition-colors hover:bg-amber-50"
    >
      <div className="flex size-10 items-center justify-center rounded-full bg-amber-100">
        <CalendarClock className="size-5 text-amber-600" />
      </div>
      <div>
        <p className="text-sm font-medium text-charcoal">
          {count} consulta{count !== 1 ? 's' : ''} aguardando reagendamento
        </p>
        <p className="text-xs text-mid">Clique para ver e reagendar</p>
      </div>
    </Link>
  )
}
