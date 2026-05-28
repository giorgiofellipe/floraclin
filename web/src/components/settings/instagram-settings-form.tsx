'use client'

import { useState } from 'react'
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
import { InstagramSavedRepliesList } from './instagram-saved-replies-list'

// ─── Schema ──────────────────────────────────────────────────────────

const ALLOWED_ROLES = ['owner', 'practitioner', 'receptionist', 'financial'] as const

// Mirror the Zod schema in @/validations/instagram for the client-side
// form. Keeping a local copy lets the form bind enum-typed checkboxes
// while still matching the keys validated by the server.
const instagramSettingsFormSchema = z.object({
  instagram_enabled: z.boolean(),
  instagram_page_id: z.string().optional(),
  instagram_business_account_id: z.string().optional(),
  instagram_page_access_token: z.string().optional(),
  instagram_allowed_roles: z
    .array(z.enum(ALLOWED_ROLES))
    .min(1, 'Selecione pelo menos um perfil'),
})

type InstagramSettingsInput = z.infer<typeof instagramSettingsFormSchema>

// ─── Constants ───────────────────────────────────────────────────────

const WEBHOOK_URL = `${
  process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.floraclin.com.br'
}/api/webhooks/instagram`

const ROLE_LABELS: Record<string, string> = {
  owner: 'Proprietário',
  practitioner: 'Profissional',
  receptionist: 'Recepcionista',
  financial: 'Financeiro',
}

// ─── Component ───────────────────────────────────────────────────────

interface InstagramSettingsFormProps {
  initialSettings?: Record<string, unknown> | null
}

export function InstagramSettingsForm({ initialSettings }: InstagramSettingsFormProps) {
  const updateTenant = useUpdateTenant()
  const [copiedWebhook, setCopiedWebhook] = useState(false)
  const [showAccessToken, setShowAccessToken] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<{
    ok: boolean
    message: string
  } | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    control,
    formState: { errors, isDirty },
  } = useForm<InstagramSettingsInput>({
    resolver: zodResolver(instagramSettingsFormSchema),
    defaultValues: {
      instagram_enabled: (initialSettings?.instagram_enabled as boolean) ?? false,
      instagram_page_id: (initialSettings?.instagram_page_id as string) || '',
      instagram_business_account_id:
        (initialSettings?.instagram_business_account_id as string) || '',
      instagram_page_access_token: '',
      instagram_allowed_roles:
        (initialSettings?.instagram_allowed_roles as typeof ALLOWED_ROLES[number][]) || [
          'owner',
        ],
    },
  })

  const enabled = watch('instagram_enabled')
  const pageId = watch('instagram_page_id')
  const accessToken = watch('instagram_page_access_token')

  async function handleCopy(text: string) {
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
      setCopiedWebhook(true)
      setTimeout(() => setCopiedWebhook(false), 2000)
      toast.success('Copiado para a área de transferência')
    } catch {
      toast.error('Erro ao copiar')
    }
  }

  async function handleVerifyConnection() {
    setVerifying(true)
    setVerifyResult(null)
    try {
      const res = await fetch('/api/instagram/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageId,
          // If the user left the token field empty, the server falls back
          // to the token currently saved for the tenant.
          pageAccessToken: accessToken || undefined,
        }),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        const igId = data.igBusinessAccountId
          ? ` (IG Business Account: ${data.igBusinessAccountId})`
          : ''
        setVerifyResult({
          ok: true,
          message: `Conexão verificada com sucesso!${igId}`,
        })
      } else {
        setVerifyResult({
          ok: false,
          message: data.error || 'Falha na verificação',
        })
      }
    } catch {
      setVerifyResult({ ok: false, message: 'Erro de rede ao verificar' })
    } finally {
      setVerifying(false)
    }
  }

  async function onSubmit(data: InstagramSettingsInput) {
    try {
      const payload: Record<string, unknown> = {
        _action: 'instagram_settings',
        settings: {
          instagram_enabled: data.instagram_enabled,
          instagram_page_id: data.instagram_page_id || null,
          instagram_business_account_id: data.instagram_business_account_id || null,
          instagram_allowed_roles: data.instagram_allowed_roles,
          ...(data.instagram_page_access_token
            ? { instagram_page_access_token: data.instagram_page_access_token }
            : {}),
        },
      }

      await updateTenant.mutateAsync(payload)
      toast.success('Configurações do Instagram atualizadas com sucesso')
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Erro ao atualizar configurações do Instagram',
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
          name="instagram_enabled"
          render={({ field }) => (
            <div className="flex items-center gap-4 rounded-[3px] border border-[#E8ECEF] bg-white p-4 transition-colors">
              <Switch checked={field.value} onCheckedChange={field.onChange} />
              <div className="space-y-0.5">
                <Label className="text-sm font-medium text-charcoal">
                  {field.value ? 'Instagram ativado' : 'Instagram desativado'}
                </Label>
                <p className="text-xs text-mid">
                  {field.value
                    ? 'Mensagens diretas serão enviadas e recebidas via Instagram Graph API.'
                    : 'Ative para configurar o envio e recebimento de DMs do Instagram.'}
                </p>
              </div>
            </div>
          )}
        />
      </div>

      {enabled && (
        <>
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
                  Como configurar a Instagram Graph API
                </AccordionTrigger>
                <AccordionContent>
                  <ol className="list-decimal list-inside space-y-2 text-sm text-mid">
                    <li>
                      Conecte sua conta do Instagram (Business ou Creator) a uma{' '}
                      <strong>Página do Facebook</strong>.
                    </li>
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
                      Adicione o produto <strong>Instagram</strong> ao aplicativo
                      e ative as permissões{' '}
                      <code className="bg-[#F4F6F8] px-1.5 py-0.5 rounded text-xs">
                        pages_messaging
                      </code>
                      ,{' '}
                      <code className="bg-[#F4F6F8] px-1.5 py-0.5 rounded text-xs">
                        instagram_basic
                      </code>
                      ,{' '}
                      <code className="bg-[#F4F6F8] px-1.5 py-0.5 rounded text-xs">
                        instagram_manage_messages
                      </code>
                      .
                    </li>
                    <li>
                      Gere um <strong>Page Access Token</strong> permanente da
                      Página do Facebook vinculada ao Instagram.
                    </li>
                    <li>
                      Copie o <strong>Page ID</strong> da Página do Facebook e o{' '}
                      <strong>Instagram Business Account ID</strong> em
                      Configurações {'>'} Página {'>'} Instagram.
                    </li>
                    <li>
                      Configure a <strong>Callback URL</strong> abaixo e
                      inscreva-se nos campos{' '}
                      <code className="bg-[#F4F6F8] px-1.5 py-0.5 rounded text-xs">
                        messages
                      </code>
                      ,{' '}
                      <code className="bg-[#F4F6F8] px-1.5 py-0.5 rounded text-xs">
                        messaging_postbacks
                      </code>
                      ,{' '}
                      <code className="bg-[#F4F6F8] px-1.5 py-0.5 rounded text-xs">
                        messaging_seen
                      </code>{' '}
                      e{' '}
                      <code className="bg-[#F4F6F8] px-1.5 py-0.5 rounded text-xs">
                        messaging_reactions
                      </code>
                      .
                    </li>
                    <li>
                      Cole as credenciais nos campos abaixo e clique em
                      &ldquo;Testar conexão&rdquo; para validar.
                    </li>
                  </ol>
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
                <Label htmlFor="instagram_page_id">Page ID</Label>
                <Input
                  id="instagram_page_id"
                  {...register('instagram_page_id')}
                  placeholder="Ex: 123456789012345"
                />
                {errors.instagram_page_id && (
                  <p className="text-xs text-red-500">
                    {errors.instagram_page_id.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="instagram_business_account_id">
                  IG Business Account ID
                </Label>
                <Input
                  id="instagram_business_account_id"
                  {...register('instagram_business_account_id')}
                  placeholder="Ex: 987654321098765"
                />
                {errors.instagram_business_account_id && (
                  <p className="text-xs text-red-500">
                    {errors.instagram_business_account_id.message}
                  </p>
                )}
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="instagram_page_access_token">
                  Page Access Token
                </Label>
                <div className="relative">
                  <Input
                    id="instagram_page_access_token"
                    type={showAccessToken ? 'text' : 'password'}
                    {...register('instagram_page_access_token')}
                    placeholder="Cole seu token de acesso"
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
                <p className="text-xs text-mid">
                  Deixe em branco para manter o token atual.
                </p>
                {errors.instagram_page_access_token && (
                  <p className="text-xs text-red-500">
                    {errors.instagram_page_access_token.message}
                  </p>
                )}
              </div>
            </div>

            {/* Verify Connection Button */}
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={handleVerifyConnection}
                disabled={verifying || !pageId}
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
                  className={`text-sm ${
                    verifyResult.ok ? 'text-green-600' : 'text-red-500'
                  }`}
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
                  onClick={() => handleCopy(WEBHOOK_URL)}
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
                Configure esta URL como Callback URL no painel do Meta for
                Developers (produto Instagram).
              </p>
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
              Selecione quais perfis podem enviar e visualizar DMs do Instagram.
            </p>

            <Controller
              control={control}
              name="instagram_allowed_roles"
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
                      <span className="text-sm text-charcoal">
                        {ROLE_LABELS[role]}
                      </span>
                    </label>
                  ))}
                  {errors.instagram_allowed_roles && (
                    <p className="text-xs text-red-500">
                      {errors.instagram_allowed_roles.message}
                    </p>
                  )}
                </div>
              )}
            />
          </div>

          {/* Saved Replies */}
          <InstagramSavedRepliesList />
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
