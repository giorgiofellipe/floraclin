import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Clock } from 'lucide-react'
import { differenceInDays, parseISO } from 'date-fns'
import { formatDate } from '@/lib/utils'
import type { UpcomingFollowUp } from '@/db/queries/dashboard'

interface UpcomingFollowUpsProps {
  followUps: UpcomingFollowUp[]
}

export function UpcomingFollowUps({ followUps }: UpcomingFollowUpsProps) {
  const today = new Date()

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-forest">
          <Clock className="h-5 w-5" />
          Retornos próximos
        </CardTitle>
      </CardHeader>
      <CardContent>
        {followUps.length === 0 ? (
          <p className="py-8 text-center text-mid">
            Nenhum retorno nos próximos 14 dias
          </p>
        ) : (
          <div className="space-y-3">
            {followUps.map((fu) => {
              const daysUntil = differenceInDays(
                parseISO(fu.followUpDate),
                today
              )
              const daysLabel =
                daysUntil === 0
                  ? 'Hoje'
                  : daysUntil === 1
                    ? 'Amanhã'
                    : `em ${daysUntil} dias`

              return (
                <Link
                  key={fu.id}
                  href={`/pacientes/${fu.patientId}`}
                  className="block rounded-lg border border-transparent p-3 transition-colors hover:border-sage/20 hover:bg-petal/50"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-charcoal">
                        {fu.patientName}
                      </p>
                      <p className="text-sm text-mid">
                        {fu.procedureTypeName}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-sage">
                        {daysLabel}
                      </p>
                      <p className="text-xs text-mid">
                        {formatDate(fu.followUpDate)}
                      </p>
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
