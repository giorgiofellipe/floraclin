'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatDate } from '@/lib/utils'
import { isTerminalStatus, referralStatusLabel } from '@/lib/referral/status'
import type {
  CapturedVia,
  IneligibleReason,
  PausedReason,
  ReferralChecks,
  ReferralStatus,
} from '@/lib/referral/types'

interface AdminReferralRow {
  id: string
  referredName: string
  status: ReferralStatus
  pausedReason: PausedReason | null
  ineligibleReason: IneligibleReason | null
  capturedVia: CapturedVia
  capturedAt: string
  qualifiedAt: string | null
  checks: ReferralChecks
}

interface AdminReferralView {
  code: string | null
  referredBy: (Omit<AdminReferralRow, 'referredName'> & { referrerName: string }) | null
  referrals: AdminReferralRow[]
  events: Array<{
    id: string
    createdAt: string
    counting: number
    discountPercent: number
    bonusCredits: number
    reason: string
  }>
}

const VIA_LABELS: Record<CapturedVia, string> = {
  link: 'link',
  signup_field: 'cadastro',
  billing_page: 'cobrança',
}

const SIGNAL_LABELS: Record<string, string> = {
  owner_email: 'e-mail',
  email_domain: 'domínio',
  phone: 'telefone',
  registry: 'registro',
  shared_user: 'usuário',
  card: 'cartão',
}

const queryKey = (tenantId: string) => ['admin', 'tenants', 'referrals', tenantId] as const

/** One line per check stage that found something; "sem alertas" when all are clean. */
export function summarizeChecks(checks: ReferralChecks | null | undefined): string {
  const parts: string[] = []
  const stages: Array<[string, ReferralChecks['atSignup']]> = [
    ['cadastro', checks?.atSignup],
    ['checkout', checks?.atCheckout],
    ['qualificação', checks?.atQualification],
  ]
  for (const [name, r] of stages) {
    if (!r) continue
    const self = r.selfReferral.map((s) => SIGNAL_LABELS[s] ?? s)
    if (self.length) parts.push(`${name}: mesma pessoa (${self.join(', ')})`)
    for (const n of r.notNew) {
      parts.push(`${name}: já cliente (${n.signals.map((s) => SIGNAL_LABELS[s] ?? s).join(', ')})`)
    }
  }
  if (checks?.adminNote) parts.push(`nota: ${checks.adminNote}`)
  return parts.length ? parts.join('; ') : 'sem alertas'
}

async function fetchView(tenantId: string): Promise<AdminReferralView> {
  const res = await fetch(`/api/admin/tenants/${tenantId}/referrals`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || 'Erro ao carregar indicações')
  }
  return (await res.json()).data
}

export function TenantReferralsPanel({ tenantId }: { tenantId: string }) {
  const queryClient = useQueryClient()
  const [target, setTarget] = useState<AdminReferralRow | null>(null)
  const [note, setNote] = useState('')

  const { data, isLoading, error } = useQuery({
    queryKey: queryKey(tenantId),
    queryFn: () => fetchView(tenantId),
    enabled: !!tenantId,
  })

  const markIneligible = useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) => {
      const res = await fetch(`/api/admin/referrals/${id}/ineligible`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(note ? { note } : {}),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao marcar indicação')
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKey(tenantId) }),
  })

  const closeConfirm = () => {
    setTarget(null)
    setNote('')
  }

  const confirm = async () => {
    if (!target) return
    try {
      await markIneligible.mutateAsync({ id: target.id, note: note.trim() })
      toast.success('Indicação marcada como não elegível')
      closeConfirm()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao marcar indicação')
    }
  }

  const heading = (
    <span className="text-[10px] uppercase tracking-[0.15em] text-mid font-medium">Indique e Ganhe</span>
  )

  if (isLoading) {
    return (
      <div className="space-y-1.5" data-testid="admin-referrals-panel">
        {heading}
        <p className="text-xs text-mid">Carregando…</p>
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="space-y-1.5" data-testid="admin-referrals-panel">
        {heading}
        <p className="text-xs text-red-600">{error instanceof Error ? error.message : 'Erro ao carregar indicações'}</p>
      </div>
    )
  }

  const { code, referredBy, referrals, events } = data
  const empty = !code && !referredBy && referrals.length === 0 && events.length === 0

  return (
    <div className="space-y-3" data-testid="admin-referrals-panel">
      {heading}
      {empty && <p className="text-xs text-mid">Sem atividade de indicação.</p>}

      {code && <p className="text-xs text-mid">Código: <span className="font-mono text-charcoal">{code}</span></p>}

      {referredBy && (
        <p className="text-xs text-mid">
          Indicada por <strong className="text-charcoal">{referredBy.referrerName}</strong>:{' '}
          {statusText(referredBy)}
        </p>
      )}

      {referrals.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-mid">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider">
                <th className="py-1 pr-2 font-medium">Clínica</th>
                <th className="py-1 pr-2 font-medium">Status</th>
                <th className="py-1 pr-2 font-medium">Origem</th>
                <th className="py-1 pr-2 font-medium">Datas</th>
                <th className="py-1 pr-2 font-medium">Verificações</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {referrals.map((r) => (
                <tr key={r.id} className="border-t border-sage/10 align-top">
                  <td className="py-1.5 pr-2 text-charcoal">{r.referredName}</td>
                  <td className="py-1.5 pr-2">{statusText(r)}</td>
                  <td className="py-1.5 pr-2">{VIA_LABELS[r.capturedVia] ?? r.capturedVia}</td>
                  <td className="py-1.5 pr-2">
                    <div>Captada {formatDate(r.capturedAt)}</div>
                    {r.qualifiedAt && <div>Contou {formatDate(r.qualifiedAt)}</div>}
                  </td>
                  <td className="py-1.5 pr-2">{summarizeChecks(r.checks)}</td>
                  <td className="py-1.5">
                    {!isTerminalStatus(r.status) && (
                      <Button variant="outline" size="sm" onClick={() => setTarget(r)}>
                        Marcar indicação como não elegível
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {events.length > 0 && (
        <div className="space-y-1">
          <span className="text-[10px] uppercase tracking-wider text-mid font-medium">Histórico de recompensa</span>
          <ul className="space-y-0.5 text-xs text-mid">
            {events.map((e) => (
              <li key={e.id}>
                {formatDate(e.createdAt)}: {e.counting} contando, {e.discountPercent}%, +{e.bonusCredits} créditos ({e.reason})
              </li>
            ))}
          </ul>
        </div>
      )}

      <Dialog open={!!target} onOpenChange={(o) => { if (!o) closeConfirm() }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Marcar indicação como não elegível</DialogTitle>
            <DialogDescription>
              {target?.referredName}: a indicação deixa de contar e o desconto de quem indicou é recalculado.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="admin-referral-note">Motivo</Label>
            <Textarea
              id="admin-referral-note"
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              className="border-sage/20 min-h-16"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={closeConfirm} disabled={markIneligible.isPending}>
              Voltar
            </Button>
            <Button size="sm" variant="destructive" onClick={confirm} disabled={markIneligible.isPending}>
              {markIneligible.isPending && <Loader2Icon className="h-3.5 w-3.5 animate-spin" />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function statusText(r: {
  status: ReferralStatus
  pausedReason: PausedReason | null
  ineligibleReason: IneligibleReason | null
}): string {
  const { label, sublabel } = referralStatusLabel(r)
  return sublabel ? `${label} (${sublabel})` : label
}
