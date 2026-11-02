'use client'

import { useState } from 'react'
import { Loader2Icon, SaveIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SectionTitle } from './section-title'
import { CertificateCard } from './certificate-card'
import {
  NfseApiError,
  useNfseCertificate,
  useNfseSettings,
  useSaveNfseSettings,
} from '@/hooks/queries/use-nfse-settings'
import { NFSE_SERVICE_PRESETS } from '@/lib/nfse/presets'
import type {
  NfseEmissionMode,
  NfseFiscalSettingsInput,
  NfseServiceCodes,
  NfseServicePresetId,
  NfseSettingsPublic,
} from '@/lib/nfse/types'

const ADVANCED = 'advanced'

const SIMPLES_OPTION_ITEMS: Record<string, string> = {
  '1': 'Não optante',
  '2': 'MEI',
  '3': 'ME ou EPP',
}

const SIMPLES_REGIME_ITEMS: Record<string, string> = {
  '1': 'Tributos federais e municipal pelo Simples',
  '2': 'Tributos federais pelo Simples e ISS pelo regime normal',
  '3': 'Tributos federais e municipal pelo regime normal',
}

const SERVICE_ITEMS: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(NFSE_SERVICE_PRESETS).map(([id, preset]) => [id, preset.label]),
  ),
  [ADVANCED]: 'Avançado',
}

const EMISSION_MODE_ITEMS: Record<NfseEmissionMode, string> = {
  ask: 'Perguntar após cada pagamento',
  always: 'Emitir sempre automaticamente',
}

const TRIB_ISSQN_ITEMS: Record<string, string> = {
  '1': 'Tributável no município',
  '2': 'Tributável fora do município',
  '3': 'Isenta',
  '4': 'Imune',
}

const EMPTY_CODES: NfseServiceCodes = {
  cTribNac: '',
  cNBS: '',
  tribISSQN: 1,
  cIndOp: '',
  CST: '',
  cClassTrib: '',
}

const ADVANCED_FIELDS: { key: Exclude<keyof NfseServiceCodes, 'tribISSQN'>; label: string }[] = [
  { key: 'cTribNac', label: 'Código de tributação nacional' },
  { key: 'cNBS', label: 'Código NBS' },
  { key: 'cIndOp', label: 'Indicador de operação' },
  { key: 'CST', label: 'CST' },
  { key: 'cClassTrib', label: 'Classificação tributária' },
]

interface FormState {
  municipalityCode: string
  municipalRegistration: string
  simplesNacionalOption: 1 | 2 | 3
  simplesNacionalRegime: 1 | 2 | 3 | null
  simplesNacionalTaxRate: string
  service: NfseServicePresetId | typeof ADVANCED | ''
  advancedCodes: NfseServiceCodes
  issRate: string
  issWithheld: boolean
  emissionMode: NfseEmissionMode
  emailPatient: boolean
}

function rateText(value: number | null): string {
  return value === null ? '' : String(value)
}

function toFormState(data: NfseSettingsPublic | null, suggestedCode: string | null): FormState {
  const configured = data?.configured === true
  return {
    municipalityCode: data?.municipalityCode || suggestedCode || '',
    municipalRegistration: data?.municipalRegistration ?? '',
    simplesNacionalOption: data?.simplesNacionalOption ?? 3,
    simplesNacionalRegime: data?.simplesNacionalRegime ?? null,
    simplesNacionalTaxRate: rateText(data?.simplesNacionalTaxRate ?? null),
    service: configured ? (data?.servicePreset ?? ADVANCED) : '',
    advancedCodes: data?.advancedCodes ?? EMPTY_CODES,
    issRate: rateText(data?.issRate ?? null),
    issWithheld: data?.issWithheld ?? false,
    emissionMode: data?.emissionMode ?? 'ask',
    emailPatient: data?.emailPatient ?? false,
  }
}

function parseRate(text: string): number | null {
  const trimmed = text.trim().replace(',', '.')
  if (trimmed === '') return null
  const value = Number(trimmed)
  return Number.isNaN(value) ? null : value
}

function toInput(form: FormState): NfseFiscalSettingsInput {
  const isSimples = form.simplesNacionalOption === 3
  const isAdvanced = form.service === ADVANCED
  return {
    municipalityCode: form.municipalityCode,
    municipalRegistration: form.municipalRegistration.trim() || null,
    simplesNacionalOption: form.simplesNacionalOption,
    simplesNacionalRegime: isSimples ? form.simplesNacionalRegime : null,
    simplesNacionalTaxRate: isSimples ? parseRate(form.simplesNacionalTaxRate) : null,
    servicePreset: form.service === ADVANCED || form.service === '' ? null : form.service,
    advancedCodes: isAdvanced ? form.advancedCodes : null,
    issRate: parseRate(form.issRate),
    issWithheld: form.issWithheld,
    emissionMode: form.emissionMode,
    emailPatient: form.emailPatient,
  }
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-xs text-red-500">{message}</p> : null
}

function FiscalSettingsForm({
  data,
  suggestedCode,
}: {
  data: NfseSettingsPublic | null
  suggestedCode: string | null
}) {
  const save = useSaveNfseSettings()
  const [form, setForm] = useState<FormState>(() => toFormState(data, suggestedCode))
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined>>({})

  const patch = (changes: Partial<FormState>) => setForm((prev) => ({ ...prev, ...changes }))
  const patchCodes = (changes: Partial<NfseServiceCodes>) =>
    setForm((prev) => ({ ...prev, advancedCodes: { ...prev.advancedCodes, ...changes } }))
  const error = (path: string) => fieldErrors[path]?.[0]

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setFieldErrors({})
    try {
      await save.mutateAsync(toInput(form))
      toast.success('Configurações de nota fiscal salvas')
    } catch (err) {
      if (err instanceof NfseApiError && err.fieldErrors) setFieldErrors(err.fieldErrors)
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar as configurações')
    }
  }

  const municipalityName =
    data?.municipalityName && data.municipalityCode === form.municipalityCode
      ? data.municipalityName
      : null

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <div className="space-y-4">
        <SectionTitle>Prestador</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="nfse-municipality">Código do município (IBGE)</Label>
            <Input
              id="nfse-municipality"
              inputMode="numeric"
              maxLength={7}
              value={form.municipalityCode}
              onChange={(e) => patch({ municipalityCode: e.target.value.replace(/\D/g, '') })}
            />
            {municipalityName && <p className="text-xs text-mid">{municipalityName}</p>}
            <FieldError message={error('municipalityCode')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nfse-im">Inscrição municipal</Label>
            <Input
              id="nfse-im"
              maxLength={15}
              value={form.municipalRegistration}
              onChange={(e) => patch({ municipalRegistration: e.target.value })}
            />
            <FieldError message={error('municipalRegistration')} />
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <SectionTitle>Simples Nacional</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Enquadramento</Label>
            <Select
              items={SIMPLES_OPTION_ITEMS}
              value={String(form.simplesNacionalOption)}
              onValueChange={(v: string | null) => {
                if (v) patch({ simplesNacionalOption: Number(v) as 1 | 2 | 3 })
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent />
            </Select>
            <FieldError message={error('simplesNacionalOption')} />
          </div>
          {form.simplesNacionalOption === 3 && (
            <>
              <div className="space-y-2">
                <Label>Regime de apuração</Label>
                <Select
                  items={SIMPLES_REGIME_ITEMS}
                  value={form.simplesNacionalRegime ? String(form.simplesNacionalRegime) : ''}
                  onValueChange={(v: string | null) =>
                    patch({ simplesNacionalRegime: v ? (Number(v) as 1 | 2 | 3) : null })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione o regime" />
                  </SelectTrigger>
                  <SelectContent />
                </Select>
                <FieldError message={error('simplesNacionalRegime')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nfse-simples-rate">Alíquota do Simples (%)</Label>
                <Input
                  id="nfse-simples-rate"
                  inputMode="decimal"
                  value={form.simplesNacionalTaxRate}
                  onChange={(e) => patch({ simplesNacionalTaxRate: e.target.value })}
                />
                <FieldError message={error('simplesNacionalTaxRate')} />
              </div>
            </>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <SectionTitle>Serviço e ISS</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Serviço prestado</Label>
            <Select
              items={SERVICE_ITEMS}
              value={form.service || null}
              onValueChange={(v: string | null) => {
                if (v) patch({ service: v as FormState['service'] })
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione o serviço" />
              </SelectTrigger>
              <SelectContent />
            </Select>
            <FieldError message={error('servicePreset')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nfse-iss-rate">Alíquota do ISS (%)</Label>
            <Input
              id="nfse-iss-rate"
              inputMode="decimal"
              value={form.issRate}
              onChange={(e) => patch({ issRate: e.target.value })}
            />
            <FieldError message={error('issRate')} />
          </div>
        </div>

        {form.service === ADVANCED && (
          <div className="grid gap-4 sm:grid-cols-2">
            {ADVANCED_FIELDS.map(({ key, label }) => (
              <div key={key} className="space-y-2">
                <Label htmlFor={`nfse-${key}`}>{label}</Label>
                <Input
                  id={`nfse-${key}`}
                  inputMode="numeric"
                  value={form.advancedCodes[key]}
                  onChange={(e) => patchCodes({ [key]: e.target.value.replace(/\D/g, '') })}
                />
                <FieldError message={error(`advancedCodes.${key}`)} />
              </div>
            ))}
            <div className="space-y-2">
              <Label>Tributação do ISSQN</Label>
              <Select
                items={TRIB_ISSQN_ITEMS}
                value={String(form.advancedCodes.tribISSQN)}
                onValueChange={(v: string | null) => {
                  if (v) patchCodes({ tribISSQN: Number(v) as 1 | 2 | 3 | 4 })
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent />
              </Select>
              <FieldError message={error('advancedCodes.tribISSQN')} />
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          <Switch
            checked={form.issWithheld}
            onCheckedChange={(checked) => patch({ issWithheld: checked })}
          />
          <span className="text-sm text-charcoal">ISS retido pelo tomador</span>
        </div>
      </div>

      <div className="space-y-4">
        <SectionTitle>Emissão</SectionTitle>
        <div className="space-y-2 sm:max-w-sm">
          <Label>Quando emitir</Label>
          <Select
            items={EMISSION_MODE_ITEMS}
            value={form.emissionMode}
            onValueChange={(v: string | null) => {
              if (v) patch({ emissionMode: v as NfseEmissionMode })
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent />
          </Select>
          <FieldError message={error('emissionMode')} />
        </div>
        <div className="flex items-center gap-3">
          <Switch
            checked={form.emailPatient}
            onCheckedChange={(checked) => patch({ emailPatient: checked })}
          />
          <span className="text-sm text-charcoal">Enviar a NFS-e por email ao paciente</span>
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? (
            <Loader2Icon className="h-4 w-4 animate-spin" />
          ) : (
            <SaveIcon className="h-4 w-4" />
          )}
          Salvar
        </Button>
      </div>
    </form>
  )
}

function FiscalSettingsSection({ cnpj }: { cnpj: string }) {
  const { data: settings, isLoading } = useNfseSettings()

  if (isLoading || !settings) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2Icon className="h-5 w-5 animate-spin text-sage" />
      </div>
    )
  }

  return (
    <FiscalSettingsForm
      key={`${cnpj}-${settings.data?.configured ?? false}`}
      data={settings.data}
      suggestedCode={settings.suggestedMunicipalityCode}
    />
  )
}

export function NfseSettingsTab() {
  const { data: certificate } = useNfseCertificate()

  return (
    <div className="space-y-8">
      <CertificateCard />
      {certificate && <FiscalSettingsSection cnpj={certificate.cnpj} />}
    </div>
  )
}
