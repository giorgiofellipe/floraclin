'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useUpdateTenant } from '@/hooks/mutations/use-tenant-mutations'
import { toast } from 'sonner'
import { Loader2Icon, LockIcon, MessageSquareIcon, SmartphoneIcon } from 'lucide-react'
import { WhatsAppTemplateList } from './whatsapp-template-list'
import { WhatsAppAutomations } from './whatsapp-automations'
import { WhatsAppCreditBar } from './whatsapp-credit-bar'
import { WhatsAppCreditHistory } from './whatsapp-credit-history'
import { WhatsAppSystemTemplates } from './whatsapp-system-templates'
import { WhatsAppOwnNumberSheet, type OwnNumberCredentials } from './whatsapp-own-number-sheet'
import { SettingsSectionHeader } from './settings-section-header'
import { PLANS_HREF } from '@/lib/billing-links'
import { UNLIMITED_CREDITS } from '@/lib/whatsapp-credits'
import type { WhatsAppMode } from '@/lib/whatsapp-mode'

const SUPPORT_HREF =
  'https://wa.me/5547936181734?text=Ol%C3%A1%2C%20preciso%20de%20ajuda%20para%20configurar%20o%20WhatsApp%20Business%20API'

function OwnNumberLockedLink() {
  return (
    <Link
      href={PLANS_HREF}
      className="inline-flex min-h-11 items-center gap-1.5 text-xs text-sage font-medium hover:text-forest underline underline-offset-2 sm:min-h-0"
    >
      <LockIcon className="size-3" />
      Número próprio requer plano Starter ou superior
    </Link>
  )
}

const ALLOWED_ROLES = ['owner', 'practitioner', 'receptionist', 'financial'] as const
type AllowedRole = typeof ALLOWED_ROLES[number]

const ROLE_LABELS: Record<AllowedRole, string> = {
  owner: 'Proprietário',
  practitioner: 'Profissional',
  receptionist: 'Recepcionista',
  financial: 'Financeiro',
}

type BillingUsage = {
  subscription?: { status: string; currentPeriodEnd: string }
  plan: { name: string; slug: string; features?: Record<string, boolean> }
  usage: {
    whatsapp: { used: number; limit: number; periodEnd?: string }
  }
}

type SavedSettings = {
  mode: WhatsAppMode
  phoneNumberId: string
  businessAccountId: string
  allowedRoles: AllowedRole[]
}

interface WhatsAppSettingsFormProps {
  initialSettings?: Record<string, unknown> | null
}

export function WhatsAppSettingsForm({ initialSettings }: WhatsAppSettingsFormProps) {
  const updateTenant = useUpdateTenant()
  const [saved, setSaved] = useState<SavedSettings>(() => ({
    mode: (initialSettings?.whatsapp_mode as WhatsAppMode) || 'floraclin',
    phoneNumberId: (initialSettings?.whatsapp_phone_number_id as string) || '',
    businessAccountId: (initialSettings?.whatsapp_business_account_id as string) || '',
    allowedRoles: (initialSettings?.whatsapp_allowed_roles as AllowedRole[]) || ['owner'],
  }))
  const [historyOpen, setHistoryOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  // Remounts the sheet on each open so it starts at step 1 with the saved values.
  const [sheetKey, setSheetKey] = useState(0)
  const [templatesVersion, setTemplatesVersion] = useState(0)
  const [confirmFloraClinOpen, setConfirmFloraClinOpen] = useState(false)
  const [billingUsage, setBillingUsage] = useState<BillingUsage | null>(null)
  const [billingLoading, setBillingLoading] = useState(true)

  const verifyToken = (initialSettings?.whatsapp_verify_token as string) || 'floraclin_webhook_verify'
  const mode = saved.mode
  // GET /api/tenant never returns the token; an own number only connects after the server verified one.
  const hasSavedToken = mode === 'own' && Boolean(saved.phoneNumberId)
  const canUseOwnNumber = billingUsage?.plan?.features?.own_whatsapp_number === true
  // Only an answered plan check locks; a failed one leaves the server to enforce the plan.
  const ownNumberLocked = billingUsage !== null && !canUseOwnNumber
  const credits = billingUsage?.usage.whatsapp
  const sendsPaused = mode === 'floraclin' && !!credits && credits.limit !== UNLIMITED_CREDITS && credits.used >= credits.limit
  const trialEnd = billingUsage?.subscription?.status === 'trialing'
    ? billingUsage.subscription.currentPeriodEnd
    : null

  useEffect(() => {
    async function fetchBilling() {
      try {
        const res = await fetch('/api/billing/usage')
        if (res.ok) setBillingUsage(await res.json())
      } catch {
        // Billing data is non-critical for the form
      } finally {
        setBillingLoading(false)
      }
    }
    fetchBilling()
  }, [])

  /** Sends only the keys that changed; the route merges them into the saved settings. */
  async function persist(
    patch: Partial<SavedSettings>,
    payload: Record<string, unknown>,
    successMessage: string,
  ): Promise<boolean> {
    try {
      await updateTenant.mutateAsync({ _action: 'whatsapp_settings', settings: payload })
      setSaved((prev) => ({ ...prev, ...patch }))
      toast.success(successMessage)
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao atualizar configurações do WhatsApp')
      return false
    }
  }

  function toggleRole(role: AllowedRole, checked: boolean) {
    const allowedRoles = checked
      ? [...saved.allowedRoles, role]
      : saved.allowedRoles.filter((r) => r !== role)
    persist({ allowedRoles }, { whatsapp_allowed_roles: allowedRoles }, 'Perfis com acesso atualizados')
  }

  function connectOwnNumber(credentials: OwnNumberCredentials) {
    return persist(
      { mode: 'own', phoneNumberId: credentials.phoneNumberId, businessAccountId: credentials.businessAccountId },
      {
        whatsapp_mode: 'own',
        whatsapp_enabled: true,
        whatsapp_phone_number_id: credentials.phoneNumberId,
        whatsapp_business_account_id: credentials.businessAccountId,
        ...(credentials.accessToken ? { whatsapp_access_token: credentials.accessToken } : {}),
      },
      'Número próprio conectado',
    )
  }

  async function switchToFloraClin() {
    if (await persist({ mode: 'floraclin' }, { whatsapp_mode: 'floraclin' }, 'Envio pelo número do FloraClin ativado')) {
      setConfirmFloraClinOpen(false)
    }
  }

  function openSheet() {
    setSheetKey((k) => k + 1)
    setSheetOpen(true)
  }

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <SettingsSectionHeader>Envio</SettingsSectionHeader>
        <div className="flex flex-wrap items-start gap-3 rounded-[3px] border border-topbar-border bg-white p-4">
          {mode === 'floraclin' ? (
            <>
              <MessageSquareIcon className="mt-0.5 size-4 shrink-0 text-forest" />
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-sm font-medium text-charcoal">Número do FloraClin</p>
                <p className="text-xs text-mid">
                  Suas mensagens saem pelo WhatsApp compartilhado do FloraClin, com créditos mensais inclusos no plano. Nada para configurar.
                </p>
              </div>
            </>
          ) : (
            <>
              <SmartphoneIcon className="mt-0.5 size-4 shrink-0 text-forest" />
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-sm font-medium text-charcoal">Número próprio</p>
                <p className="text-xs text-mid [overflow-wrap:anywhere]">
                  {saved.phoneNumberId
                    ? `Conectado ao número de ID ${saved.phoneNumberId}.`
                    : 'Conexão incompleta. Termine a configuração para enviar mensagens.'}
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-0" onClick={openSheet}>
                {saved.phoneNumberId ? 'Editar conexão' : 'Concluir conexão'}
              </Button>
              <div className="basis-full flex flex-wrap items-center gap-x-4 pl-7">
                {ownNumberLocked && <OwnNumberLockedLink />}
                <a
                  href={SUPPORT_HREF}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center gap-1 text-xs font-medium text-sage hover:text-forest underline underline-offset-2 sm:min-h-0"
                >
                  <MessageSquareIcon className="size-3" />
                  Pedir ajuda ao suporte
                </a>
              </div>
            </>
          )}
        </div>
      </div>

      {mode === 'floraclin' && (
        <div className="space-y-4">
          <SettingsSectionHeader>Uso de créditos</SettingsSectionHeader>

          {billingLoading ? (
            <div className="rounded-[3px] border border-topbar-border bg-white p-4 animate-pulse">
              <div className="h-4 w-48 bg-content-bg rounded mb-3" />
              <div className="h-2 w-full bg-content-bg rounded" />
            </div>
          ) : billingUsage ? (
            <WhatsAppCreditBar
              used={billingUsage.usage.whatsapp.used}
              total={billingUsage.usage.whatsapp.limit}
              periodEnd={billingUsage.usage.whatsapp.periodEnd ?? ''}
              trialEnd={trialEnd}
            />
          ) : null}

          <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-0" onClick={() => setHistoryOpen(true)}>
            Ver histórico
          </Button>
          <WhatsAppCreditHistory open={historyOpen} onOpenChange={setHistoryOpen} />
        </div>
      )}

      {mode === 'own' && (
        <WhatsAppTemplateList
          configured={!!saved.phoneNumberId}
          onProvision={async () => {
            const res = await fetch('/api/whatsapp/templates/provision', { method: 'POST' })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Erro ao provisionar templates')
            setTemplatesVersion((v) => v + 1)
          }}
        />
      )}

      <WhatsAppAutomations key={`${mode}-${templatesVersion}`} mode={mode} sendsPaused={sendsPaused} />

      <div className="space-y-4">
        <SettingsSectionHeader>Perfis com acesso</SettingsSectionHeader>
        <p className="text-xs text-mid">
          Quem pode enviar e ver mensagens do WhatsApp. Cada mudança é salva na hora.
        </p>
        <div className="space-y-1">
          {ALLOWED_ROLES.map((role) => {
            const checked = saved.allowedRoles.includes(role)
            const lastOne = checked && saved.allowedRoles.length === 1
            return (
              <label key={role} className="flex min-h-11 items-center gap-3 cursor-pointer sm:min-h-9">
                <Checkbox
                  checked={checked}
                  disabled={updateTenant.isPending || lastOne}
                  onCheckedChange={(next) => toggleRole(role, next === true)}
                />
                <span className="text-sm text-charcoal">{ROLE_LABELS[role]}</span>
                {lastOne && <span className="text-xs text-mid">(pelo menos um perfil)</span>}
              </label>
            )
          })}
        </div>
      </div>

      {mode === 'floraclin' && <WhatsAppSystemTemplates />}

      <Accordion>
        <AccordionItem value="advanced">
          <AccordionTrigger className="text-sm font-medium text-charcoal">Avançado</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-3 pb-2">
              {mode === 'floraclin' ? (
                <>
                  <p className="text-xs text-mid">
                    Envie pelo número da própria clínica, com o nome dela no WhatsApp. Exige uma conta no Meta Business e leva uns 15 minutos.
                  </p>
                  {ownNumberLocked ? (
                    <OwnNumberLockedLink />
                  ) : (
                    <Button type="button" variant="outline" className="min-h-11 sm:min-h-0" disabled={billingLoading} onClick={openSheet}>
                      <SmartphoneIcon className="size-4" />
                      Conectar número próprio
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <p className="text-xs text-mid">
                    Volte a enviar pelo número do FloraClin. Os dados do número próprio ficam salvos.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 sm:min-h-0"
                    onClick={() => setConfirmFloraClinOpen(true)}
                  >
                    Voltar para o número do FloraClin
                  </Button>
                </>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <Dialog open={confirmFloraClinOpen} onOpenChange={setConfirmFloraClinOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Voltar para o número do FloraClin?</DialogTitle>
            <DialogDescription>
              Todas as mensagens, inclusive as automáticas, passam a sair pelo número compartilhado do FloraClin, com os textos padrão do FloraClin, e usam os créditos do plano. As automações ativas continuam ativas. Seus templates e os dados do número próprio ficam salvos para você reconectar depois.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" className="min-h-11 sm:min-h-0" onClick={() => setConfirmFloraClinOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              className="min-h-11 sm:min-h-0 bg-forest text-cream hover:bg-sage"
              disabled={updateTenant.isPending}
              onClick={switchToFloraClin}
            >
              {updateTenant.isPending && <Loader2Icon className="size-4 animate-spin" />}
              Usar o número do FloraClin
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <WhatsAppOwnNumberSheet
        key={sheetKey}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        initialPhoneNumberId={saved.phoneNumberId}
        initialBusinessAccountId={saved.businessAccountId}
        hasSavedToken={hasSavedToken}
        verifyToken={verifyToken}
        onConnect={connectOwnNumber}
      />
    </div>
  )
}
