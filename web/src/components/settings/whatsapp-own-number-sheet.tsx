'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { toast } from 'sonner'
import {
  CheckIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  ImageIcon,
  Loader2Icon,
  MessageSquareIcon,
  WifiIcon,
} from 'lucide-react'

const WEBHOOK_URL = 'https://app.floraclin.com/api/webhooks/whatsapp'
const SUPPORT_HREF =
  'https://wa.me/5547936181734?text=Ol%C3%A1%2C%20preciso%20de%20ajuda%20para%20configurar%20o%20WhatsApp%20Business%20API'

const COPIED_FEEDBACK_MS = 2000

const STEPS = ['Prepare o app no Meta', 'Informe os dados da conta', 'Configure o webhook'] as const

export interface OwnNumberCredentials {
  phoneNumberId: string
  businessAccountId: string
  /** Empty keeps the token already saved. */
  accessToken: string
}

interface WhatsAppOwnNumberSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialPhoneNumberId: string
  initialBusinessAccountId: string
  hasSavedToken: boolean
  verifyToken: string
  onConnect: (credentials: OwnNumberCredentials) => Promise<boolean>
}

function HelpImage({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex min-h-11 items-center gap-1 text-sage hover:text-forest hover:underline text-xs font-medium sm:min-h-0"
      >
        <ImageIcon className="size-3" />
        {open ? 'ocultar imagem' : 'ver imagem'}
      </button>
      {open && <img src={src} alt={alt} className="mt-2 w-full rounded-[3px] border border-topbar-border" />}
    </>
  )
}

function CopyField({ id, label, value, helper }: { id: string; label: string; value: string; helper: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS)
      toast.success('Copiado para a área de transferência')
    } catch {
      toast.error('Erro ao copiar')
    }
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input id={id} readOnly value={value} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-0" onClick={copy}>
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
          {copied ? 'Copiado' : 'Copiar'}
        </Button>
      </div>
      <p className="text-xs text-mid">{helper}</p>
    </div>
  )
}

export function WhatsAppOwnNumberSheet({
  open,
  onOpenChange,
  initialPhoneNumberId,
  initialBusinessAccountId,
  hasSavedToken,
  verifyToken,
  onConnect,
}: WhatsAppOwnNumberSheetProps) {
  const [step, setStep] = useState(0)
  const [phoneNumberId, setPhoneNumberId] = useState(initialPhoneNumberId)
  const [businessAccountId, setBusinessAccountId] = useState(initialBusinessAccountId)
  const [accessToken, setAccessToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [connecting, setConnecting] = useState(false)

  const credentialsFilled = Boolean(phoneNumberId.trim() && businessAccountId.trim() && (accessToken.trim() || hasSavedToken))

  async function handleVerify() {
    setVerifying(true)
    setVerifyResult(null)
    try {
      const res = await fetch('/api/whatsapp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumberId: phoneNumberId.trim(), ...(accessToken.trim() ? { accessToken: accessToken.trim() } : {}) }),
      })
      const data = await res.json().catch(() => ({}))
      setVerifyResult(res.ok
        ? { ok: true, message: 'Conexão verificada.' }
        : { ok: false, message: data.error || 'Falha na verificação. Confira os dados.' })
    } catch {
      setVerifyResult({ ok: false, message: 'Erro de rede ao verificar.' })
    } finally {
      setVerifying(false)
    }
  }

  async function handleConnect() {
    setConnecting(true)
    const ok = await onConnect({
      phoneNumberId: phoneNumberId.trim(),
      businessAccountId: businessAccountId.trim(),
      accessToken: accessToken.trim(),
    })
    setConnecting(false)
    if (ok) onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
      >
        <SheetHeader className="border-b border-topbar-border pr-12">
          <p className="text-xs text-mid">Passo {step + 1} de {STEPS.length}</p>
          <SheetTitle>Conectar número próprio</SheetTitle>
          <SheetDescription>{STEPS[step]}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4 text-sm text-mid space-y-4">
          {step === 0 && (
            <>
              <p>
                Você vai precisar de uma conta no Meta Business da clínica. O processo leva uns 15 minutos.
              </p>
              <ol className="space-y-3 list-decimal pl-5">
                <li>
                  Acesse{' '}
                  <a href="https://developers.facebook.com/apps/" target="_blank" rel="noopener noreferrer" className="text-sage hover:underline font-medium">
                    developers.facebook.com/apps
                  </a>{' '}
                  e entre com a conta do Meta Business da clínica.
                </li>
                <li>
                  Clique em <strong>Criar aplicativo</strong>. Preencha o nome (ex.: &quot;Minha Clínica&quot;) e o e-mail de contato.{' '}
                  <HelpImage src="/help/whatsapp-setup/create-app-step1.png" alt="Detalhes do app" />
                </li>
                <li>
                  Em <strong>Casos de uso</strong>, escolha <strong>Conectar-se com clientes pelo WhatsApp</strong>.{' '}
                  <HelpImage src="/help/whatsapp-setup/create-app-step2.png" alt="Casos de uso" />
                </li>
                <li>
                  Em <strong>Empresa</strong>, escolha o portfólio empresarial da clínica.{' '}
                  <HelpImage src="/help/whatsapp-setup/create-app-step3.png" alt="Empresa" />
                </li>
                <li>
                  Em <strong>Requisitos</strong>, apenas avance. Em <strong>Visão geral</strong>, revise e clique em <strong>Criar aplicativo</strong>.{' '}
                  <HelpImage src="/help/whatsapp-setup/create-app-step5.png" alt="Visão geral" />
                </li>
                <li>
                  No painel do app, clique em <strong>Personalizar o caso de uso</strong> e depois em <strong>Comece a usar a API</strong>. Siga o assistente para vincular a conta do WhatsApp Business e o número da clínica.{' '}
                  <HelpImage src="/help/whatsapp-setup/app-dashboard.png" alt="Painel do aplicativo" />
                </li>
              </ol>
            </>
          )}

          {step === 1 && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="own-phone-number-id">ID do número de telefone</Label>
                <Input
                  id="own-phone-number-id"
                  inputMode="numeric"
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberId(e.target.value)}
                  placeholder="Ex.: 123456789012345"
                />
                <p className="text-xs text-mid">Na tela Configuração da API do app, abaixo do número selecionado.</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="own-business-account-id">ID da conta comercial do WhatsApp</Label>
                <Input
                  id="own-business-account-id"
                  inputMode="numeric"
                  value={businessAccountId}
                  onChange={(e) => setBusinessAccountId(e.target.value)}
                  placeholder="Ex.: 987654321098765"
                />
                <p className="text-xs text-mid">No topo da mesma tela Configuração da API.</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="own-access-token">Token de acesso</Label>
                <div className="relative">
                  <Input
                    id="own-access-token"
                    type={showToken ? 'text' : 'password'}
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                    placeholder={hasSavedToken ? 'Token salvo' : 'Cole o token permanente'}
                    className="pr-11"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    aria-label={showToken ? 'Ocultar token' : 'Mostrar token'}
                    onClick={() => setShowToken((v) => !v)}
                    className="absolute right-0 top-1/2 -translate-y-1/2 flex size-11 items-center justify-center text-mid hover:text-charcoal"
                  >
                    {showToken ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                  </button>
                </div>
                <p className="text-xs text-mid">
                  {hasSavedToken ? 'Deixe em branco para manter o token salvo. ' : ''}
                  Gere em{' '}
                  <a href="https://business.facebook.com/settings/system-users" target="_blank" rel="noopener noreferrer" className="text-sage hover:underline font-medium">
                    Usuários do sistema
                  </a>
                  . Se ainda não tiver um usuário do sistema, clique em <strong>Adicionar</strong> e escolha a função <strong>Admin</strong>. Em <strong>Atribuir ativos</strong>, dê ao usuário <strong>Controle total</strong> do app e da conta do WhatsApp, clique em <strong>Gerar token</strong>, validade <strong>Nunca</strong>, com as permissões{' '}
                  <code className="bg-content-bg px-1 rounded">whatsapp_business_messaging</code> e{' '}
                  <code className="bg-content-bg px-1 rounded">whatsapp_business_management</code>. O token aparece só uma vez.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="outline" className="min-h-11 sm:min-h-0" onClick={handleVerify} disabled={verifying || !credentialsFilled}>
                  {verifying ? <Loader2Icon className="size-4 animate-spin" /> : <WifiIcon className="size-4" />}
                  Testar conexão
                </Button>
                {verifyResult && (
                  <span role="status" className={`text-xs ${verifyResult.ok ? 'text-green-700' : 'text-red-600'}`}>
                    {verifyResult.message}
                  </span>
                )}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <p>
                No painel do app, abra <strong>Casos de uso</strong>, <strong>Personalizar</strong> e <strong>Configuração</strong>. Na seção <strong>Webhook</strong>, clique em <strong>Editar</strong> e cole os dois valores abaixo. Depois clique em <strong>Verificar e salvar</strong>.
              </p>
              <CopyField
                id="own-webhook-url"
                label="URL de retorno de chamada"
                value={WEBHOOK_URL}
                helper="Por onde o FloraClin recebe as respostas dos pacientes."
              />
              <CopyField
                id="own-verify-token"
                label="Token de verificação"
                value={verifyToken}
                helper="O Meta usa este código para confirmar que o endereço é do FloraClin."
              />
              <p>
                Ainda no Webhook, clique em <strong>Gerenciar</strong> e ative os campos{' '}
                <code className="bg-content-bg px-1 rounded text-xs">messages</code> e{' '}
                <code className="bg-content-bg px-1 rounded text-xs">message_template_status_update</code>.
              </p>
            </>
          )}

          <p className="rounded-[3px] border border-sage/20 bg-sage/5 px-3 py-2.5 text-xs">
            Travou em algum passo?{' '}
            <a href={SUPPORT_HREF} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-sage hover:text-forest underline underline-offset-2">
              <MessageSquareIcon className="size-3" />
              Fale com o suporte pelo WhatsApp
            </a>
          </p>
        </div>

        <SheetFooter className="flex-row justify-between border-t border-topbar-border">
          <Button
            type="button"
            variant="outline"
            className="min-h-11 sm:min-h-0"
            onClick={() => (step === 0 ? onOpenChange(false) : setStep(step - 1))}
          >
            {step === 0 ? 'Cancelar' : 'Voltar'}
          </Button>
          {step < STEPS.length - 1 ? (
            <Button
              type="button"
              className="min-h-11 sm:min-h-0 bg-forest text-cream hover:bg-sage"
              disabled={step === 1 && !credentialsFilled}
              onClick={() => setStep(step + 1)}
            >
              Continuar
            </Button>
          ) : (
            <Button
              type="button"
              className="min-h-11 sm:min-h-0 bg-forest text-cream hover:bg-sage"
              disabled={connecting || !credentialsFilled}
              onClick={handleConnect}
            >
              {connecting && <Loader2Icon className="size-4 animate-spin" />}
              Conectar número
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
