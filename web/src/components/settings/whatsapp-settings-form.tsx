'use client'

import { useState, useEffect } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'
import { useUpdateTenant } from '@/hooks/mutations/use-tenant-mutations'
import { toast } from 'sonner'
import {
  SaveIcon,
  Loader2Icon,
  CopyIcon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  WifiIcon,
  ImageIcon,
  XIcon,
  MessageSquareIcon,
  SmartphoneIcon,
  LockIcon,
} from 'lucide-react'
import { WhatsAppTemplateList } from './whatsapp-template-list'
import { WhatsAppAutomations } from './whatsapp-automations'
import { WhatsAppCreditBar } from './whatsapp-credit-bar'

// ─── Help Image ─────────────────────────────────────────────────────

function HelpImage({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-sage hover:text-forest hover:underline text-xs font-medium transition-colors"
      >
        <ImageIcon className="size-3" />
        ver imagem
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(false)}>
          <div className="relative max-w-3xl max-h-[90vh] w-full" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute -top-3 -right-3 z-10 flex items-center justify-center size-8 rounded-full bg-white shadow-lg text-charcoal hover:bg-cream transition-colors"
            >
              <XIcon className="size-4" />
            </button>
            <img src={src} alt={alt} className="w-full rounded-lg shadow-2xl" />
          </div>
        </div>
      )}
    </>
  )
}

// ─── Schema ──────────────────────────────────────────────────────────

const ALLOWED_ROLES = ['owner', 'practitioner', 'receptionist', 'financial'] as const

type WhatsAppMode = 'floraclin' | 'own'

const whatsappSettingsSchema = z.object({
  whatsapp_mode: z.enum(['floraclin', 'own']),
  whatsapp_phone_number_id: z.string().optional(),
  whatsapp_business_account_id: z.string().optional(),
  whatsapp_access_token: z.string().optional(),
  whatsapp_allowed_roles: z.array(z.enum(ALLOWED_ROLES)).min(1, 'Selecione pelo menos um perfil'),
})

type WhatsAppSettingsInput = z.infer<typeof whatsappSettingsSchema>

type BillingUsage = {
  plan: { name: string; slug: string; features?: Record<string, boolean> }
  usage: {
    whatsapp: { used: number; limit: number; periodEnd?: string }
  }
}

// ─── Constants ───────────────────────────────────────────────────────

const WEBHOOK_URL = 'https://app.floraclin.com/api/webhooks/whatsapp'

const ROLE_LABELS: Record<string, string> = {
  owner: 'Proprietário',
  practitioner: 'Profissional',
  receptionist: 'Recepcionista',
  financial: 'Financeiro',
}

// ─── Component ───────────────────────────────────────────────────────

interface WhatsAppSettingsFormProps {
  initialSettings?: Record<string, unknown> | null
}

export function WhatsAppSettingsForm({ initialSettings }: WhatsAppSettingsFormProps) {
  const updateTenant = useUpdateTenant()
  const [copiedWebhook, setCopiedWebhook] = useState(false)
  const [copiedToken, setCopiedToken] = useState(false)
  const [showAccessToken, setShowAccessToken] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [billingUsage, setBillingUsage] = useState<BillingUsage | null>(null)
  const [billingLoading, setBillingLoading] = useState(true)

  const savedToken = (initialSettings?.whatsapp_access_token as string) || ''
  const verifyToken = (initialSettings?.whatsapp_verify_token as string) || 'floraclin_webhook_verify'

  const {
    register,
    handleSubmit,
    watch,
    control,
    setValue,
    formState: { errors, isDirty },
  } = useForm<WhatsAppSettingsInput>({
    resolver: zodResolver(whatsappSettingsSchema),
    defaultValues: {
      whatsapp_mode: (initialSettings?.whatsapp_mode as WhatsAppMode) || 'floraclin',
      whatsapp_phone_number_id: (initialSettings?.whatsapp_phone_number_id as string) || '',
      whatsapp_business_account_id: (initialSettings?.whatsapp_business_account_id as string) || '',
      whatsapp_access_token: '',
      whatsapp_allowed_roles: (initialSettings?.whatsapp_allowed_roles as typeof ALLOWED_ROLES[number][]) || ['owner'],
    },
  })

  const mode = watch('whatsapp_mode')
  const phoneNumberId = watch('whatsapp_phone_number_id')
  const accessToken = watch('whatsapp_access_token')

  const canUseOwnNumber = billingUsage?.plan?.features?.own_whatsapp_number === true

  useEffect(() => {
    async function fetchBilling() {
      try {
        const res = await fetch('/api/billing/usage')
        if (res.ok) {
          const data = await res.json()
          setBillingUsage(data)
        }
      } catch {
        // Billing data is non-critical for the form
      } finally {
        setBillingLoading(false)
      }
    }
    fetchBilling()
  }, [])

  function maskToken(token: string): string {
    if (!token || token.length <= 4) return token
    return '••••' + token.slice(-4)
  }

  async function handleCopy(text: string, type: 'webhook' | 'token') {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
      if (type === 'webhook') {
        setCopiedWebhook(true)
        setTimeout(() => setCopiedWebhook(false), 2000)
      } else {
        setCopiedToken(true)
        setTimeout(() => setCopiedToken(false), 2000)
      }
      toast.success('Copiado para a área de transferência')
    } catch {
      toast.error('Erro ao copiar')
    }
  }

  async function handleVerifyConnection() {
    setVerifying(true)
    setVerifyResult(null)
    try {
      const res = await fetch('/api/whatsapp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumberId,
          accessToken: accessToken || savedToken,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setVerifyResult({ ok: true, message: 'Conexão verificada com sucesso!' })
      } else {
        setVerifyResult({ ok: false, message: data.error || 'Falha na verificação' })
      }
    } catch {
      setVerifyResult({ ok: false, message: 'Erro de rede ao verificar' })
    } finally {
      setVerifying(false)
    }
  }

  async function onSubmit(data: WhatsAppSettingsInput) {
    try {
      const payload: Record<string, unknown> = {
        _action: 'whatsapp_settings',
        settings: {
          whatsapp_mode: data.whatsapp_mode,
          whatsapp_enabled: true,
          whatsapp_phone_number_id: data.whatsapp_phone_number_id || null,
          whatsapp_business_account_id: data.whatsapp_business_account_id || null,
          whatsapp_allowed_roles: data.whatsapp_allowed_roles,
          ...(data.whatsapp_access_token
            ? { whatsapp_access_token: data.whatsapp_access_token }
            : {}),
        },
      }

      await updateTenant.mutateAsync(payload)
      toast.success('Configurações do WhatsApp atualizadas com sucesso')
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Erro ao atualizar configurações do WhatsApp'
      )
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
      {/* Mode Selector */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="uppercase tracking-wider text-xs font-medium text-mid">
            Modo de envio
          </h3>
          <div className="flex-1 h-px bg-blush/60" />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {/* Option A: FloraClin (Default) */}
          <button
            type="button"
            onClick={() => setValue('whatsapp_mode', 'floraclin', { shouldDirty: true })}
            className={`relative flex items-start gap-3 rounded-[3px] border-2 p-4 text-left transition-colors ${
              mode === 'floraclin'
                ? 'border-forest bg-forest/5'
                : 'border-[#E8ECEF] bg-white hover:border-sage/40'
            }`}
          >
            <div className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2 ${
              mode === 'floraclin' ? 'border-forest' : 'border-mid/40'
            }`}>
              {mode === 'floraclin' && (
                <div className="size-2 rounded-full bg-forest" />
              )}
            </div>
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <MessageSquareIcon className="size-4 text-forest" />
                <span className="text-sm font-medium text-charcoal">
                  FloraClin (Padrão)
                </span>
              </div>
              <p className="text-xs text-mid">
                Use o WhatsApp compartilhado do FloraClin. Incluso no seu plano com créditos mensais de conversas.
              </p>
            </div>
          </button>

          {/* Option B: Own Number */}
          <button
            type="button"
            onClick={() => {
              if (canUseOwnNumber) {
                setValue('whatsapp_mode', 'own', { shouldDirty: true })
              }
            }}
            disabled={!canUseOwnNumber}
            className={`relative flex items-start gap-3 rounded-[3px] border-2 p-4 text-left transition-colors ${
              mode === 'own'
                ? 'border-forest bg-forest/5'
                : !canUseOwnNumber
                  ? 'border-[#E8ECEF] bg-[#F4F6F8] opacity-70 cursor-not-allowed'
                  : 'border-[#E8ECEF] bg-white hover:border-sage/40'
            }`}
          >
            <div className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2 ${
              mode === 'own' ? 'border-forest' : 'border-mid/40'
            }`}>
              {mode === 'own' && (
                <div className="size-2 rounded-full bg-forest" />
              )}
            </div>
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <SmartphoneIcon className="size-4 text-forest" />
                <span className="text-sm font-medium text-charcoal">
                  Número próprio
                </span>
              </div>
              <p className="text-xs text-mid">
                Conecte seu próprio número via WhatsApp Business API. Mensagens saem com o nome da sua clínica.
              </p>
              {!canUseOwnNumber && !billingLoading && (
                <div className="flex items-center gap-1.5 pt-1">
                  <LockIcon className="size-3 text-mid" />
                  <a href="/configuracoes?tab=assinatura" className="text-xs text-sage font-medium hover:text-forest underline underline-offset-2">
                    Requer plano Starter ou superior
                  </a>
                </div>
              )}
            </div>
          </button>
        </div>
      </div>

      {/* FloraClin Mode: Credit Bar */}
      {mode === 'floraclin' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="uppercase tracking-wider text-xs font-medium text-mid">
              Uso de conversas
            </h3>
            <div className="flex-1 h-px bg-blush/60" />
          </div>

          {billingLoading ? (
            <div className="rounded-[3px] border border-[#E8ECEF] bg-white p-4 animate-pulse">
              <div className="h-4 w-48 bg-[#F4F6F8] rounded mb-3" />
              <div className="h-2 w-full bg-[#F4F6F8] rounded" />
            </div>
          ) : billingUsage ? (
            <WhatsAppCreditBar
              used={billingUsage.usage.whatsapp.used}
              total={billingUsage.usage.whatsapp.limit}
              periodEnd={billingUsage.usage.whatsapp.periodEnd ?? ''}
            />
          ) : null}
        </div>
      )}

      {/* Own Number Mode: Setup Instructions + Credentials + Webhook + Templates */}
      {mode === 'own' && (
        <>
          {/* Setup Instructions Accordion */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="uppercase tracking-wider text-xs font-medium text-mid">
                Ajuda
              </h3>
              <div className="flex-1 h-px bg-blush/60" />
              <a
                href="https://wa.me/5547936181734?text=Ol%C3%A1%2C%20preciso%20de%20ajuda%20para%20configurar%20o%20WhatsApp%20Business%20API"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-[3px] border border-forest/20 bg-forest/5 px-3 py-1.5 text-xs font-medium text-forest hover:bg-forest/10 transition-colors"
              >
                <MessageSquareIcon className="size-3.5" />
                Pedir ajuda ao suporte
              </a>
            </div>

            <Accordion>
              <AccordionItem>
                <AccordionTrigger className="text-sm font-medium text-charcoal">
                  Passo a passo: como configurar
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-6 text-sm text-mid">
                    {/* Step 1 */}
                    <div className="space-y-1.5">
                      <p className="font-medium text-charcoal flex items-center gap-2">
                        <span className="flex items-center justify-center size-5 rounded-full bg-forest text-cream text-[10px] font-bold shrink-0">1</span>
                        Criar um aplicativo no Meta
                      </p>
                      <div className="ml-7 space-y-2">
                        <p>
                          Acesse{' '}
                          <a href="https://developers.facebook.com/apps/" target="_blank" rel="noopener noreferrer" className="text-sage hover:underline font-medium">
                            developers.facebook.com/apps
                          </a>{' '}
                          e faça login com a conta do Meta Business da clínica.
                        </p>
                        <p>Clique em <strong>Criar aplicativo</strong> e siga os passos:</p>
                        <ol className="list-decimal list-inside space-y-1 ml-1">
                          <li>
                            <strong>Detalhes do app</strong> — preencha o nome (ex: &quot;Minha Clínica&quot;) e o e-mail de contato.{' '}
                            <HelpImage src="/help/whatsapp-setup/create-app-step1.png" alt="Detalhes do app" />
                          </li>
                          <li>
                            <strong>Casos de uso</strong> — selecione <strong>Conectar-se com clientes pelo WhatsApp</strong>.{' '}
                            <HelpImage src="/help/whatsapp-setup/create-app-step2.png" alt="Casos de uso" />
                          </li>
                          <li>
                            <strong>Empresa</strong> — selecione o portfólio empresarial da sua clínica.{' '}
                            <HelpImage src="/help/whatsapp-setup/create-app-step3.png" alt="Empresa" />
                          </li>
                          <li>
                            <strong>Requisitos</strong> — não precisa alterar nada, apenas clique em <strong>Avançar</strong>.
                          </li>
                          <li>
                            <strong>Visão geral</strong> — revise os dados e clique em <strong>Criar aplicativo</strong>.{' '}
                            <HelpImage src="/help/whatsapp-setup/create-app-step5.png" alt="Visão geral" />
                          </li>
                        </ol>
                      </div>
                    </div>

                    {/* Step 2 */}
                    <div className="space-y-1.5">
                      <p className="font-medium text-charcoal flex items-center gap-2">
                        <span className="flex items-center justify-center size-5 rounded-full bg-forest text-cream text-[10px] font-bold shrink-0">2</span>
                        Configurar o WhatsApp no aplicativo
                      </p>
                      <div className="ml-7 space-y-1">
                        <p>
                          Após criar o app, você verá o painel com a seção <strong>Personalização do app e requisitos</strong>.{' '}
                          <HelpImage src="/help/whatsapp-setup/app-dashboard.png" alt="Painel do aplicativo" />
                        </p>
                        <p>Clique em <strong>Personalizar o caso de uso &quot;Conectar-se com clientes pelo WhatsApp&quot;</strong> e depois em <strong>Comece a usar a API</strong>.</p>
                        <p>Siga o assistente para vincular sua conta do WhatsApp Business e adicionar um número de telefone. Se ainda não tem uma conta, ele vai guiar a criação.</p>
                      </div>
                    </div>

                    {/* Step 3 */}
                    <div className="space-y-1.5">
                      <p className="font-medium text-charcoal flex items-center gap-2">
                        <span className="flex items-center justify-center size-5 rounded-full bg-forest text-cream text-[10px] font-bold shrink-0">3</span>
                        Copiar as credenciais
                      </p>
                      <div className="ml-7 space-y-1">
                        <p>Na tela de <strong>Configuração da API</strong> (dentro do caso de uso do WhatsApp), você encontrará:</p>
                        <ul className="list-disc list-inside ml-2 space-y-0.5">
                          <li><strong>ID do número de telefone</strong> — abaixo do número selecionado</li>
                          <li><strong>ID da conta do WhatsApp Business</strong> — no topo da página</li>
                        </ul>
                        <p>Copie ambos e cole nos campos <strong>Phone Number ID</strong> e <strong>Business Account ID</strong> abaixo.</p>
                      </div>
                    </div>

                    {/* Step 4 */}
                    <div className="space-y-1.5">
                      <p className="font-medium text-charcoal flex items-center gap-2">
                        <span className="flex items-center justify-center size-5 rounded-full bg-forest text-cream text-[10px] font-bold shrink-0">4</span>
                        Gerar um token de acesso permanente
                      </p>
                      <div className="ml-7 space-y-2">
                        <p>
                          Acesse{' '}
                          <a href="https://business.facebook.com/settings/system-users" target="_blank" rel="noopener noreferrer" className="text-sage hover:underline font-medium">
                            Configurações do negócio → Usuários do sistema
                          </a>.
                        </p>
                        <ol className="list-decimal list-inside space-y-1 ml-1">
                          <li>Se não tiver um usuário do sistema, clique em <strong>Adicionar</strong>, dê um nome e selecione a função <strong>Admin</strong>.</li>
                          <li>Clique em <strong>Atribuir ativos</strong> → selecione <strong>Apps</strong> → escolha seu app → ative <strong>Controle total</strong>. Depois selecione <strong>Contas do WhatsApp</strong> → escolha sua conta → ative <strong>Controle total</strong>.</li>
                          <li>Clique em <strong>Gerar token</strong> → selecione seu app → validade <strong>Nunca</strong> → marque as permissões:</li>
                        </ol>
                        <ul className="list-disc list-inside ml-6 space-y-0.5">
                          <li><code className="bg-[#F4F6F8] px-1.5 py-0.5 rounded text-xs">whatsapp_business_messaging</code></li>
                          <li><code className="bg-[#F4F6F8] px-1.5 py-0.5 rounded text-xs">whatsapp_business_management</code></li>
                        </ul>
                        <p className="ml-1">Copie o token gerado (ele só aparece uma vez!) e cole no campo <strong>Access Token</strong> abaixo.</p>
                      </div>
                    </div>

                    {/* Step 5 */}
                    <div className="space-y-1.5">
                      <p className="font-medium text-charcoal flex items-center gap-2">
                        <span className="flex items-center justify-center size-5 rounded-full bg-forest text-cream text-[10px] font-bold shrink-0">5</span>
                        Configurar o Webhook (para receber mensagens)
                      </p>
                      <div className="ml-7 space-y-1">
                        <p>Volte ao painel do app → clique em <strong>Casos de uso</strong> no menu lateral → <strong>Personalizar</strong> → <strong>Configuração</strong>.</p>
                        <p>Na seção <strong>Webhook</strong>, clique em <strong>Editar</strong> e preencha:</p>
                        <ul className="list-disc list-inside ml-2 space-y-0.5">
                          <li><strong>URL de retorno de chamada:</strong> copie da seção &quot;Webhook&quot; mais abaixo nesta página</li>
                          <li><strong>Token de verificação:</strong> copie da seção &quot;Webhook&quot; mais abaixo nesta página</li>
                        </ul>
                        <p>Clique em <strong>Verificar e salvar</strong>.</p>
                      </div>
                    </div>

                    {/* Step 6 */}
                    <div className="space-y-1.5">
                      <p className="font-medium text-charcoal flex items-center gap-2">
                        <span className="flex items-center justify-center size-5 rounded-full bg-forest text-cream text-[10px] font-bold shrink-0">6</span>
                        Ativar os campos do Webhook
                      </p>
                      <div className="ml-7 space-y-1">
                        <p>Ainda na tela do Webhook, abaixo da URL configurada, clique em <strong>Gerenciar</strong> e ative:</p>
                        <ul className="list-disc list-inside ml-2 space-y-0.5">
                          <li><code className="bg-[#F4F6F8] px-1.5 py-0.5 rounded text-xs">messages</code> — para receber e acompanhar mensagens</li>
                          <li><code className="bg-[#F4F6F8] px-1.5 py-0.5 rounded text-xs">message_template_status_update</code> — para atualizar status dos templates</li>
                        </ul>
                      </div>
                    </div>

                    {/* Step 7 */}
                    <div className="space-y-1.5">
                      <p className="font-medium text-charcoal flex items-center gap-2">
                        <span className="flex items-center justify-center size-5 rounded-full bg-forest text-cream text-[10px] font-bold shrink-0">7</span>
                        Testar a conexão
                      </p>
                      <div className="ml-7">
                        <p>Preencha os campos abaixo com as credenciais copiadas e clique em <strong>Testar conexão</strong>. Se aparecer &quot;Conexão verificada&quot;, está tudo pronto!</p>
                      </div>
                    </div>

                    <div className="rounded-[3px] border border-sage/20 bg-sage/5 px-3 py-2.5 text-xs text-mid">
                      Precisa de ajuda?{' '}
                      <a
                        href="https://wa.me/5547936181734?text=Ol%C3%A1%2C%20preciso%20de%20ajuda%20para%20configurar%20o%20WhatsApp%20Business%20API"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-sage hover:text-forest underline underline-offset-2"
                      >
                        Fale com nosso suporte pelo WhatsApp
                      </a>.
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>

          {/* API Credentials */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="uppercase tracking-wider text-xs font-medium text-mid">
                Credenciais da API
              </h3>
              <div className="flex-1 h-px bg-blush/60" />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="whatsapp_phone_number_id">Phone Number ID</Label>
                <Input
                  id="whatsapp_phone_number_id"
                  {...register('whatsapp_phone_number_id')}
                  placeholder="Ex: 123456789012345"
                />
                {errors.whatsapp_phone_number_id && (
                  <p className="text-xs text-red-500">{errors.whatsapp_phone_number_id.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="whatsapp_business_account_id">Business Account ID</Label>
                <Input
                  id="whatsapp_business_account_id"
                  {...register('whatsapp_business_account_id')}
                  placeholder="Ex: 987654321098765"
                />
                {errors.whatsapp_business_account_id && (
                  <p className="text-xs text-red-500">{errors.whatsapp_business_account_id.message}</p>
                )}
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="whatsapp_access_token">Access Token</Label>
                <div className="relative">
                  <Input
                    id="whatsapp_access_token"
                    type={showAccessToken ? 'text' : 'password'}
                    {...register('whatsapp_access_token')}
                    placeholder={savedToken ? maskToken(savedToken) : 'Cole seu token de acesso'}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAccessToken(!showAccessToken)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-mid hover:text-charcoal transition-colors"
                  >
                    {showAccessToken ? (
                      <EyeOffIcon className="h-4 w-4" />
                    ) : (
                      <EyeIcon className="h-4 w-4" />
                    )}
                  </button>
                </div>
                {savedToken && (
                  <p className="text-xs text-mid">
                    Token salvo: {maskToken(savedToken)}. Deixe em branco para manter o atual.
                  </p>
                )}
                {errors.whatsapp_access_token && (
                  <p className="text-xs text-red-500">{errors.whatsapp_access_token.message}</p>
                )}
              </div>
            </div>

            {/* Verify Connection Button */}
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={handleVerifyConnection}
                disabled={verifying || (!phoneNumberId && !savedToken)}
              >
                {verifying ? (
                  <Loader2Icon className="h-4 w-4 animate-spin" />
                ) : (
                  <WifiIcon className="h-4 w-4" />
                )}
                Testar conexão
              </Button>
              {verifyResult && (
                <span
                  className={`text-sm ${verifyResult.ok ? 'text-green-600' : 'text-red-500'}`}
                >
                  {verifyResult.message}
                </span>
              )}
            </div>
          </div>

          {/* Webhook Configuration */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="uppercase tracking-wider text-xs font-medium text-mid">
                Webhook
              </h3>
              <div className="flex-1 h-px bg-blush/60" />
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>URL do Webhook</Label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2 bg-[#F4F6F8] rounded-[3px] border border-[#E8ECEF] px-4 py-2.5 min-w-0">
                    <span className="text-sm font-mono text-charcoal truncate flex-1">
                      {WEBHOOK_URL}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleCopy(WEBHOOK_URL, 'webhook')}
                  >
                    {copiedWebhook ? (
                      <CheckIcon className="h-3.5 w-3.5" />
                    ) : (
                      <CopyIcon className="h-3.5 w-3.5" />
                    )}
                    {copiedWebhook ? 'Copiado' : 'Copiar'}
                  </Button>
                </div>
                <p className="text-xs text-mid">
                  Configure esta URL como Callback URL no painel do Meta for Developers.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Verify Token</Label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2 bg-[#F4F6F8] rounded-[3px] border border-[#E8ECEF] px-4 py-2.5 min-w-0">
                    <span className="text-sm font-mono text-charcoal truncate flex-1">
                      {verifyToken}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleCopy(verifyToken, 'token')}
                  >
                    {copiedToken ? (
                      <CheckIcon className="h-3.5 w-3.5" />
                    ) : (
                      <CopyIcon className="h-3.5 w-3.5" />
                    )}
                    {copiedToken ? 'Copiado' : 'Copiar'}
                  </Button>
                </div>
                <p className="text-xs text-mid">
                  Use este token no campo Verify Token ao configurar o webhook no Meta.
                </p>
              </div>
            </div>
          </div>

          {/* Template Management */}
          <WhatsAppTemplateList
            configured={!!(initialSettings?.whatsapp_phone_number_id)}
            onProvision={async () => {
              const res = await fetch('/api/whatsapp/templates/provision', { method: 'POST' })
              const data = await res.json()
              if (!res.ok) throw new Error(data.error || 'Erro ao provisionar templates')
            }}
          />
        </>
      )}

      {/* Allowed Roles (shown for both modes) */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="uppercase tracking-wider text-xs font-medium text-mid">
            Perfis com Acesso
          </h3>
          <div className="flex-1 h-px bg-blush/60" />
        </div>

        <p className="text-xs text-mid">
          Selecione quais perfis podem enviar e visualizar mensagens do WhatsApp.
        </p>

        <Controller
          control={control}
          name="whatsapp_allowed_roles"
          render={({ field }) => (
            <div className="space-y-3">
              {ALLOWED_ROLES.map((role) => (
                <label
                  key={role}
                  className="flex items-center gap-3 cursor-pointer"
                >
                  <Checkbox
                    checked={field.value.includes(role)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        field.onChange([...field.value, role])
                      } else {
                        field.onChange(field.value.filter((r) => r !== role))
                      }
                    }}
                  />
                  <span className="text-sm text-charcoal">{ROLE_LABELS[role]}</span>
                </label>
              ))}
              {errors.whatsapp_allowed_roles && (
                <p className="text-xs text-red-500">{errors.whatsapp_allowed_roles.message}</p>
              )}
            </div>
          )}
        />
      </div>

      {/* Automations (shown for both modes) */}
      <WhatsAppAutomations />

      {/* Submit */}
      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={updateTenant.isPending || !isDirty}>
          {updateTenant.isPending ? (
            <Loader2Icon className="h-4 w-4 animate-spin" />
          ) : (
            <SaveIcon className="h-4 w-4" />
          )}
          Salvar Configurações
        </Button>
      </div>
    </form>
  )
}
