'use client'

import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SignaturePad } from '@/components/consent/signature-pad'
import { ProfessionalSignatureBlock } from '@/components/professional/professional-signature-block'
import { REGISTRY_TYPES } from '@/validations/professional'
import { useUpdateProfile, type ProfileData } from '@/hooks/queries/use-profile'

const REGISTRY_TYPE_LABELS: Record<string, string> = {
  CRM: 'CRM — Medicina',
  CRO: 'CRO — Odontologia',
  CRBM: 'CRBM — Biomedicina',
  CRF: 'CRF — Farmácia',
  CREFITO: 'CREFITO — Fisioterapia',
  COREN: 'COREN — Enfermagem',
  OTHER: 'Outro',
}

const BR_STATES = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
  'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
  'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const

const BR_STATE_ITEMS: Record<string, string> = BR_STATES.reduce(
  (acc, uf) => {
    acc[uf] = uf
    return acc
  },
  {} as Record<string, string>
)

const MAX_SIGNATURE_BYTES = 500_000

interface ProfessionalSignatureFormProps {
  initialProfile: ProfileData
}

export function ProfessionalSignatureForm({ initialProfile }: ProfessionalSignatureFormProps) {
  const updateProfile = useUpdateProfile()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [signatureData, setSignatureData] = useState<string | null>(
    initialProfile.signatureData
  )
  const [professionalTitle, setProfessionalTitle] = useState<string>(
    initialProfile.professionalTitle ?? ''
  )
  const [registryType, setRegistryType] = useState<string>(
    initialProfile.registryType ?? ''
  )
  const [registryNumber, setRegistryNumber] = useState<string>(
    initialProfile.registryNumber ?? ''
  )
  const [registryState, setRegistryState] = useState<string>(
    initialProfile.registryState ?? ''
  )

  const isPending = updateProfile.isPending

  const previewName = professionalTitle.trim() || initialProfile.fullName || ''
  const previewRegistryLine =
    registryType && registryNumber && registryState
      ? `${registryType}-${registryState} ${registryNumber}`
      : ''

  const canPreview = useMemo(
    () =>
      Boolean(
        signatureData &&
          previewName &&
          previewRegistryLine
      ),
    [signatureData, previewName, previewRegistryLine]
  )

  function handleFilePick() {
    fileInputRef.current?.click()
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
      toast.error('Use uma imagem PNG ou JPEG')
      return
    }
    if (file.size > MAX_SIGNATURE_BYTES) {
      toast.error('Imagem muito grande. Use até 500 KB.')
      return
    }

    const reader = new FileReader()
    reader.onerror = () => toast.error('Falha ao ler o arquivo')
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : null
      if (!result) {
        toast.error('Falha ao ler o arquivo')
        return
      }
      if (!/^data:image\/(png|jpeg);base64,/.test(result)) {
        toast.error('Formato de imagem não suportado')
        return
      }
      if (result.length > MAX_SIGNATURE_BYTES) {
        toast.error('Imagem muito grande após codificação. Use até 500 KB.')
        return
      }
      setSignatureData(result)
    }
    reader.readAsDataURL(file)
  }

  function handleClearSignature() {
    setSignatureData(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (signatureData && signatureData.length > MAX_SIGNATURE_BYTES) {
      toast.error('Assinatura excede 500 KB. Reduza o traço ou use uma imagem menor.')
      return
    }

    const payload = {
      signatureData: signatureData ?? null,
      professionalTitle: professionalTitle.trim() ? professionalTitle.trim() : null,
      registryType: registryType ? registryType : null,
      registryNumber: registryNumber.trim() ? registryNumber.trim() : null,
      registryState: registryState ? registryState : null,
    }

    try {
      await updateProfile.mutateAsync(payload)
      toast.success('Perfil profissional atualizado')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar perfil')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Signature */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="uppercase tracking-wider text-xs font-medium text-mid">
            Assinatura
          </h3>
          <div className="flex-1 h-px bg-blush/60" />
        </div>
        <p className="text-sm text-mid">
          Sua assinatura é aplicada em receitas, atestados e outros documentos clínicos.
          Você pode desenhar abaixo ou enviar uma imagem (PNG ou JPEG, até 500 KB).
        </p>

        <SignaturePad
          key={signatureData === null ? 'empty' : 'with-data'}
          initialData={signatureData}
          onSignatureChange={(data) => setSignatureData(data)}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleFilePick}
          >
            Carregar imagem
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleClearSignature}
            disabled={!signatureData}
          >
            Remover assinatura
          </Button>
        </div>
      </div>

      {/* Professional registry */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="uppercase tracking-wider text-xs font-medium text-mid">
            Registro Profissional
          </h3>
          <div className="flex-1 h-px bg-blush/60" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="professional-title">Como aparecer nos documentos</Label>
            <Input
              id="professional-title"
              value={professionalTitle}
              onChange={(e) => setProfessionalTitle(e.target.value)}
              placeholder={initialProfile.fullName ?? 'Ex.: Dra. Joana Silva'}
              maxLength={100}
            />
            <p className="text-xs text-mid">
              Em branco, usamos seu nome completo: {initialProfile.fullName ?? '—'}.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="registry-type">Conselho</Label>
            <Select
              items={REGISTRY_TYPE_LABELS}
              value={registryType}
              onValueChange={(v) => setRegistryType(v ?? '')}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione o conselho" />
              </SelectTrigger>
              <SelectContent />
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="registry-state">UF</Label>
            <Select
              items={BR_STATE_ITEMS}
              value={registryState}
              onValueChange={(v) => setRegistryState(v ?? '')}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="UF" />
              </SelectTrigger>
              <SelectContent />
            </Select>
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="registry-number">Número do registro</Label>
            <Input
              id="registry-number"
              value={registryNumber}
              onChange={(e) => setRegistryNumber(e.target.value)}
              placeholder="Ex.: 123456"
              maxLength={20}
            />
          </div>
        </div>

        {registryType === '' && (
          <p className="text-xs text-mid">
            Conselhos suportados: {REGISTRY_TYPES.join(', ')}.
          </p>
        )}
      </div>

      {/* Preview */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="uppercase tracking-wider text-xs font-medium text-mid">
            Pré-visualização
          </h3>
          <div className="flex-1 h-px bg-blush/60" />
        </div>
        {canPreview && signatureData ? (
          <div className="rounded-[3px] border border-[#E8ECEF] bg-[#F4F6F8] p-6">
            <ProfessionalSignatureBlock
              signatureDataUrl={signatureData}
              displayName={previewName}
              registryLine={previewRegistryLine}
            />
          </div>
        ) : (
          <div className="rounded-[3px] border border-dashed border-[#E8ECEF] bg-white p-6 text-center text-sm text-mid">
            Preencha assinatura, conselho, UF e número para ver a pré-visualização.
          </div>
        )}
      </div>

      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Salvando...' : 'Salvar'}
        </Button>
      </div>
    </form>
  )
}
