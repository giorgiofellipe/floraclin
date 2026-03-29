import Link from 'next/link'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Clock, Heart } from 'lucide-react'
import { differenceInDays, parseISO } from 'date-fns'
import { formatDate } from '@/lib/utils'
import type { UpcomingFollowUp } from '@/db/queries/dashboard'

interface UpcomingFollowUpsProps {
  followUps: UpcomingFollowUp[]
}

export function UpcomingFollowUps({ followUps }: UpcomingFollowUpsProps) {
  const today = new Date()

  return (
    <Card className="border-0 shadow-[0_1px_4px_rgba(0,0,0,0.06)] bg-white rounded-[3px]">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-sage" />
          <span className="text-xs font-medium uppercase tracking-wider text-mid">
            Retornos proximos
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {followUps.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-petal mb-4">
              <Heart className="h-7 w-7 text-blush" />
            </div>
            <p className="text-charcoal font-medium">Tudo em dia!</p>
            <p className="mt-1 text-sm text-mid">
              Nenhum retorno nos proximos 14 dias.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {followUps.map((fu) => {
              const daysUntil = differenceInDays(
                parseISO(fu.followUpDate),
                today
              )
              const daysLabel =
                daysUntil === 0
                  ? 'Hoje'
                  : daysUntil === 1
                    ? 'Amanha'
                    : `${daysUntil}d`

              const badgeColor =
                daysUntil <= 0
                  ? 'bg-amber-light text-amber-dark'
                  : daysUntil < 7
                    ? 'bg-sage/10 text-sage'
                    : 'bg-amber-light/60 text-amber-mid'

              return (
                <Link
                  key={fu.id}
                  href={`/pacientes/${fu.patientId}`}
                  className="group block rounded-lg border border-transparent p-3 transition-all duration-200 hover:border-sage/15 hover:bg-petal/30 hover:shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-charcoal truncate">
                        {fu.patientName}
                      </p>
                      <p className="text-xs text-mid mt-0.5">
                        {fu.procedureTypeName}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${badgeColor}`}>
                        {daysLabel}
                      </span>
                      <span className="text-[11px] text-mid">
                        {formatDate(fu.followUpDate)}
                      </span>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
