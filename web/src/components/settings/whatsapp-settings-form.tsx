'use client'

import { useState, useEffect } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
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
} from 'lucide-react'
import { WhatsAppTemplateList } from './whatsapp-template-list'
import { WhatsAppAutomations } from './whatsapp-automations'

// ─── Schema ──────────────────────────────────────────────────────────

const ALLOWED_ROLES = ['owner', 'practitioner', 'receptionist', 'financial'] as const

const whatsappSettingsSchema = z.object({
  whatsapp_enabled: z.boolean(),
  whatsapp_phone_number_id: z.string().optional(),
  whatsapp_business_account_id: z.string().optional(),
  whatsapp_access_token: z.string().optional(),
  whatsapp_allowed_roles: z.array(z.enum(ALLOWED_ROLES)).min(1, 'Selecione pelo menos um perfil'),
})

type WhatsAppSettingsInput = z.infer<typeof whatsappSettingsSchema>

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

  const savedToken = (initialSettings?.whatsapp_access_token as string) || ''
  const verifyToken = (initialSettings?.whatsapp_verify_token as string) || 'floraclin_webhook_verify'

  const {
    register,
    handleSubmit,
    watch,
    control,
    formState: { errors, isDirty },
  } = useForm<WhatsAppSettingsInput>({
    resolver: zodResolver(whatsappSettingsSchema),
    defaultValues: {
      whatsapp_enabled: (initialSettings?.whatsapp_enabled as boolean) ?? false,
      whatsapp_phone_number_id: (initialSettings?.whatsapp_phone_number_id as string) || '',
      whatsapp_business_account_id: (initialSettings?.whatsapp_business_account_id as string) || '',
      whatsapp_access_token: '',
      whatsapp_allowed_roles: (initialSettings?.whatsapp_allowed_roles as typeof ALLOWED_ROLES[number][]) || ['owner'],
    },
  })

  const enabled = watch('whatsapp_enabled')
  const phoneNumberId = watch('whatsapp_phone_number_id')
  const accessToken = watch('whatsapp_access_token')

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
          whatsapp_enabled: data.whatsapp_enabled,
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
      {/* Enable/Disable Toggle */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="uppercase tracking-wider text-xs font-medium text-mid">
            Integração
          </h3>
          <div className="flex-1 h-px bg-blush/60" />
        </div>

        <Controller
          control={control}
          name="whatsapp_enabled"
          render={({ field }) => (
            <div className="flex items-center gap-4 rounded-[3px] border border-[#E8ECEF] bg-white p-4 transition-colors">
              <Switch
                checked={field.value}
                onCheckedChange={field.onChange}
              />
              <div className="space-y-0.5">
                <Label className="text-sm font-medium text-charcoal">
                  {field.value ? 'WhatsApp ativado' : 'WhatsApp desativado'}
                </Label>
                <p className="text-xs text-mid">
                  {field.value
                    ? 'Mensagens serão enviadas e recebidas via WhatsApp Business API.'
                    : 'Ative para configurar o envio e recebimento de mensagens.'}
                </p>
              </div>
            </div>
          )}
        />
      </div>

      {enabled && (
        <>
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

          {/* Allowed Roles */}
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

          {/* Setup Instructions Accordion */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="uppercase tracking-wider text-xs font-medium text-mid">
                Ajuda
              </h3>
              <div className="flex-1 h-px bg-blush/60" />
            </div>

            <Accordion>
              <AccordionItem>
                <AccordionTrigger className="text-sm font-medium text-charcoal">
                  Como configurar o WhatsApp Business API
                </AccordionTrigger>
                <AccordionContent>
                  <ol className="list-decimal list-inside space-y-2 text-sm text-mid">
                    <li>
                      Acesse o{' '}
                      <a
                        href="https://developers.facebook.com/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sage hover:underline"
                      >
                        Meta for Developers
                      </a>{' '}
                      e crie ou selecione um aplicativo do tipo Business.
                    </li>
                    <li>
                      No painel do app, adicione o produto WhatsApp e siga o assistente de configuracao.
                    </li>
                    <li>
                      Copie o <strong>Phone Number ID</strong> e o{' '}
                      <strong>WhatsApp Business Account ID</strong> da secao WhatsApp {'>'} API Setup.
                    </li>
                    <li>
                      Gere um <strong>Access Token permanente</strong> com as permissoes{' '}
                      <code className="bg-[#F4F6F8] px-1.5 py-0.5 rounded text-xs">whatsapp_business_messaging</code>{' '}
                      e{' '}
                      <code className="bg-[#F4F6F8] px-1.5 py-0.5 rounded text-xs">whatsapp_business_management</code>.
                    </li>
                    <li>
                      Na secao Webhooks, configure a <strong>Callback URL</strong> e o{' '}
                      <strong>Verify Token</strong> listados acima.
                    </li>
                    <li>
                      Inscreva-se nos campos <code className="bg-[#F4F6F8] px-1.5 py-0.5 rounded text-xs">messages</code>{' '}
                      e <code className="bg-[#F4F6F8] px-1.5 py-0.5 rounded text-xs">message_template_status_update</code>.
                    </li>
                    <li>
                      Cole as credenciais nos campos acima e clique em &ldquo;Testar conexao&rdquo; para validar.
                    </li>
                  </ol>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>

          {/* Template Management */}
          <WhatsAppTemplateList
            onProvision={async () => {
              const res = await fetch('/api/whatsapp/templates/provision', { method: 'POST' })
              const data = await res.json()
              if (!res.ok) throw new Error(data.error || 'Erro ao provisionar templates')
            }}
          />

          {/* Automations */}
          <WhatsAppAutomations />
        </>
      )}

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
