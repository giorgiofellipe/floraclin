'use client'

import Link from 'next/link'
import { Cake, Loader2 } from 'lucide-react'
import { addDays } from 'date-fns'
import { brToday, parseBrDate, toLocalYmd } from '@/lib/dates'
import { useBirthdays } from '@/hooks/queries/use-birthdays'
import { BirthdayRowActions } from '@/components/patients/birthday-row-actions'

const MAX_VISIBLE_ROWS = 5

/**
 * Dashboard widget: lists patients with birthdays today, plus a count badge for
 * "+N esta semana" (next 7 days, excluding today). Mounted by Group 3 wiring
 * inside `dashboard-page-client.tsx`.
 *
 * Two independent fetches: today (rendered) + week (count-only). Each lives on
 * its own React Query key so navigation to the full Aniversariantes page can
 * reuse either window without overlap.
 */
export function UpcomingBirthdaysCard() {
  const today = brToday()
  const inSevenDays = toLocalYmd(addDays(parseBrDate(today, '12:00:00'), 7))
  const currentYear = parseInt(today.slice(0, 4), 10)

  const todayQuery = useBirthdays({ from: today, to: today })
  const weekQuery = useBirthdays({ from: today, to: inSevenDays })

  const todayItems = todayQuery.data ?? []
  const weekItems = weekQuery.data ?? []
  const weekExtraCount = Math.max(0, weekItems.length - todayItems.length)

  const visible = todayItems.slice(0, MAX_VISIBLE_ROWS)
  const hiddenCount = Math.max(0, todayItems.length - MAX_VISIBLE_ROWS)

  return (
    <div
      className="bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] rounded-[3px] p-5"
      data-testid="dashboard-birthdays"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Cake className="h-4 w-4 text-blush" />
          <span className="text-[14px] font-medium text-[#2A2A2A]">
            Aniversariantes de hoje
          </span>
        </div>
        <div className="flex items-center gap-2">
          {weekExtraCount > 0 && (
            <Link
              href="/pacientes/aniversariantes"
              className="inline-flex items-center rounded-full bg-[#F5EAEA] px-2 py-0.5 text-[11px] font-medium text-[#B36A6A] hover:bg-[#EFD7D7] transition-colors"
            >
              +{weekExtraCount} esta semana
            </Link>
          )}
          <span className="text-[11px] font-medium uppercase tracking-wider text-[#7A7A7A]">
            {todayItems.length} HOJE
          </span>
        </div>
      </div>

      {todayQuery.isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="size-5 animate-spin text-mid" />
        </div>
      ) : todayQuery.isError ? (
        <div className="py-8 text-center text-[13px] text-mid">
          Não foi possível carregar aniversariantes.
        </div>
      ) : todayItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <p className="text-[14px] font-medium text-[#2A2A2A]">
            Ninguém faz aniversário hoje
          </p>
          <p className="mt-1 text-[13px] text-[#7A7A7A]">
            {weekExtraCount > 0
              ? `${weekExtraCount} paciente${weekExtraCount !== 1 ? 's' : ''} fazem nos próximos 7 dias.`
              : 'Nenhum aniversário também nos próximos 7 dias.'}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-[#F0F0F0]">
          {visible.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 py-3"
            >
              <Link
                href={`/pacientes/${item.id}`}
                className="min-w-0 flex-1 group"
              >
                <p className="text-[14px] text-[#2A2A2A] truncate group-hover:underline">
                  {item.fullName}
                </p>
                <p className="mt-0.5 text-[12px] text-[#7A7A7A]">
                  Faz {item.ageTurning} ano{item.ageTurning !== 1 ? 's' : ''}
                  {item.greetedAt && item.greetedByName
                    ? ` · Parabenizado por ${item.greetedByName}`
                    : ''}
                </p>
              </Link>
              <BirthdayRowActions
                patientId={item.id}
                patientPhone={item.phone}
                greetedAt={item.greetedAt}
                year={currentYear}
                size="sm"
              />
            </div>
          ))}
          {hiddenCount > 0 && (
            <div className="pt-3 text-right">
              <Link
                href="/pacientes/aniversariantes"
                className="text-[12px] font-medium text-sage hover:underline"
              >
                Ver todos (+{hiddenCount})
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Footer link — always visible so users can browse upcoming months. */}
      <div className="mt-3 border-t border-[#F0F0F0] pt-3">
        <Link
          href="/pacientes/aniversariantes"
          className="text-[12px] font-medium text-sage hover:underline"
        >
          Ver todos os aniversariantes
        </Link>
      </div>
    </div>
  )
}
