'use client'

import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { ReferralDashboardResponse } from '@/lib/referral/dashboard'
import { ReferralCodeEditor } from './referral-code-editor'

const CARD = 'rounded-[3px] border border-[#E8ECEF] bg-white p-4 sm:p-5'

async function copy(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(message)
  } catch {
    toast.error('Não foi possível copiar')
  }
}

export function ReferralSettings() {
  const { data, isLoading, isError } = useQuery<ReferralDashboardResponse>({
    queryKey: ['referral'],
    queryFn: async () => {
      const res = await fetch('/api/referral')
      if (!res.ok) throw new Error('Erro ao carregar indicações')
      return res.json()
    },
  })

  if (isLoading) return <Skeleton className="h-64 w-full" />
  if (isError || !data) {
    return <p className="py-12 text-center text-sm text-mid">Erro ao carregar indicações.</p>
  }

  const { progress } = data

  return (
    <div className="space-y-4">
      <section className={CARD}>
        <h3 className="text-sm font-medium text-charcoal">Seu link de indicação</h3>
        {data.link && data.shareText && data.whatsappShareUrl ? (
          <div className="mt-3 space-y-3">
            <p className="break-all rounded-[3px] bg-[#F4F6F8] px-3 py-2 text-sm text-charcoal">{data.link}</p>
            {data.code && <ReferralCodeEditor currentCode={data.code} previousCodes={data.previousCodes} />}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => copy(data.link!, 'Link copiado')}>
                Copiar link
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => window.open(data.whatsappShareUrl!, '_blank', 'noopener,noreferrer')}
              >
                Compartilhar no WhatsApp
              </Button>
              <Button type="button" variant="outline" onClick={() => copy(data.shareText!, 'Texto copiado')}>
                Copiar texto para Instagram
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-mid">{data.inactiveMessage}</p>
        )}
      </section>

      <section className={CARD}>
        <h3 className="text-sm font-medium text-charcoal">Seu progresso</h3>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={progress.target}
          aria-valuenow={Math.min(progress.counting, progress.target)}
          className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[#E8ECEF]"
        >
          <div className="h-full bg-sage" style={{ width: `${progress.percent}%` }} />
        </div>
        <p className="mt-2 text-sm text-charcoal">{progress.label}</p>
        {progress.bonusLabel && <p className="mt-1 text-sm text-mid">{progress.bonusLabel}</p>}
      </section>

      <section className={CARD}>
        <p className="text-sm text-charcoal">{data.discountLine}</p>
      </section>

      <section className={CARD}>
        <h3 className="text-sm font-medium text-charcoal">Clínicas indicadas</h3>
        {data.referrals.length === 0 ? (
          <p className="mt-2 text-sm text-mid">Nenhuma clínica indicada ainda.</p>
        ) : (
          <ul className="mt-3 divide-y divide-[#E8ECEF]">
            {data.referrals.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-charcoal">{r.name}</p>
                  <p className="text-xs text-mid">{r.signupDate}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-charcoal">{r.label}</p>
                  {r.sublabel && <p className="text-xs text-mid">{r.sublabel}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.history.length > 0 && (
        <section className={CARD}>
          <h3 className="text-sm font-medium text-charcoal">Histórico</h3>
          <ul className="mt-3 space-y-1">
            {data.history.map((h, i) => (
              <li key={`${h.date}-${i}`} className="text-sm text-mid">
                {h.date}: {h.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      <a
        href={data.rulesUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block text-sm text-sage underline"
      >
        Ver regras do programa
      </a>
    </div>
  )
}
