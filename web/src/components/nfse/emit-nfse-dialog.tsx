'use client'

import { useState } from 'react'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MaskedInput } from '@/components/ui/masked-input'
import { formatCurrency } from '@/lib/utils'
import { maskCEP, maskCPF } from '@/lib/masks'
import { brToday, formatBrDate, parseBrDate } from '@/lib/dates'
import {
  useEmitNfse,
  useNfsePreview,
  type NfsePreviewPatient,
  type NfseTakerInput,
} from '@/hooks/queries/use-nfse-documents'
import type { NfseCompetenceChoice, NfseProcessResult } from '@/lib/nfse/types'

interface EmitNfseDialogProps {
  paymentRecordIds: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface TakerForm {
  cpf: string
  zip: string
  street: string
  number: string
  complement: string
  neighborhood: string
  city: string
  state: string
}

const EMPTY_TAKER: TakerForm = {
  cpf: '',
  zip: '',
  street: '',
  number: '',
  complement: '',
  neighborhood: '',
  city: '',
  state: '',
}

const RESULT_LABELS: Record<string, string> = {
  issued: 'Emitida',
  pending: 'Na fila',
  processing: 'Processando',
  failed: 'Falhou',
  cancelled: 'Cancelada',
}

function toTakerInput(patientId: string, form: TakerForm): NfseTakerInput {
  return {
    patientId,
    cpf: form.cpf,
    address: {
      zip: form.zip,
      street: form.street.trim(),
      number: form.number.trim(),
      complement: form.complement.trim() || null,
      neighborhood: form.neighborhood.trim(),
      city: form.city.trim(),
      state: form.state.trim().toUpperCase(),
    },
  }
}

function takerComplete(form: TakerForm): boolean {
  return Boolean(
    form.cpf && form.zip && form.street.trim() && form.number.trim() && form.neighborhood.trim() && form.city.trim() && form.state.trim(),
  )
}

function needsTaker(patient: NfsePreviewPatient): boolean {
  return patient.missing.length > 0
}

function EmitNfseForm({ paymentRecordIds, onOpenChange }: Omit<EmitNfseDialogProps, 'open'>) {
  const { data: preview, isLoading, error } = useNfsePreview(paymentRecordIds)
  const emit = useEmitNfse()
  const [competence, setCompetence] = useState<NfseCompetenceChoice>('service')
  const [sendEmailChoice, setSendEmailChoice] = useState<boolean | null>(null)
  const [takers, setTakers] = useState<Record<string, TakerForm>>({})
  const [results, setResults] = useState<NfseProcessResult[] | null>(null)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-mid">
        <Loader2Icon className="size-4 animate-spin" />
        Carregando...
      </div>
    )
  }

  if (error || !preview) {
    return (
      <>
        <p className="text-sm text-red-600">{error?.message ?? 'Erro ao carregar os dados da NFS-e'}</p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </>
    )
  }

  if (results) {
    return (
      <>
        <ul className="space-y-2 text-sm">
          {results.map((result, index) => (
            <li key={result.id} className="rounded-md border border-[#E8ECEF] px-3 py-2">
              <span className="font-medium text-charcoal">
                {results.length > 1 ? `NFS-e ${index + 1}: ` : ''}
                {RESULT_LABELS[result.status] ?? result.status}
              </span>
              {result.errorMessage && <p className="mt-1 text-xs text-red-600">{result.errorMessage}</p>}
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </>
    )
  }

  const hasEmail = preview.patients.some((p) => p.email)
  const sendEmail = hasEmail && (sendEmailChoice ?? preview.settings.emailPatient)
  const blocked = (p: NfsePreviewPatient) => needsTaker(p) && !p.canEditTaker
  const ready = preview.patients.filter((p) => !blocked(p) && (!needsTaker(p) || takerComplete(takers[p.patientId] ?? EMPTY_TAKER)))
  const readyIds = ready.flatMap((p) => p.paymentRecordIds)
  const serviceDate = formatBrDate(parseBrDate(preview.defaultCompetence))
  const todayDate = formatBrDate(parseBrDate(brToday()))

  function setField(patientId: string, field: keyof TakerForm, value: string) {
    setTakers((prev) => ({ ...prev, [patientId]: { ...(prev[patientId] ?? EMPTY_TAKER), [field]: value } }))
  }

  async function handleEmit() {
    const takerInputs = ready
      .filter(needsTaker)
      .map((p) => toTakerInput(p.patientId, takers[p.patientId] ?? EMPTY_TAKER))
    try {
      const data = await emit.mutateAsync({
        paymentRecordIds: readyIds,
        competence: preview!.competenceIsPastMonth ? competence : 'service',
        sendEmail,
        takers: takerInputs.length > 0 ? takerInputs : undefined,
      })
      setResults(data)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao emitir a NFS-e')
    }
  }

  return (
    <>
      <div className="space-y-4">
        {preview.patients.map((patient) => {
          const form = takers[patient.patientId] ?? EMPTY_TAKER
          return (
            <div key={patient.patientId} className="space-y-2 rounded-md border border-[#E8ECEF] p-3">
              <p className="text-sm font-medium text-charcoal">
                {patient.patientName}: {formatCurrency(patient.total)}
              </p>
              {blocked(patient) && (
                <p className="text-xs text-amber-700">
                  Peça a quem tem acesso ao cadastro para completar CPF e endereço.
                </p>
              )}
              {needsTaker(patient) && patient.canEditTaker && (
                <div className="grid grid-cols-6 gap-2">
                  <div className="col-span-3 space-y-1">
                    <Label className="text-xs">CPF</Label>
                    <MaskedInput
                      mask={maskCPF}
                      value={form.cpf}
                      aria-invalid={patient.missing.includes('cpf') && !form.cpf}
                      onChange={(e) => setField(patient.patientId, 'cpf', e.target.value)}
                    />
                  </div>
                  <div className="col-span-3 space-y-1">
                    <Label className="text-xs">CEP</Label>
                    <MaskedInput
                      mask={maskCEP}
                      value={form.zip}
                      aria-invalid={patient.missing.includes('zip') && !form.zip}
                      onChange={(e) => setField(patient.patientId, 'zip', e.target.value)}
                    />
                  </div>
                  <div className="col-span-4 space-y-1">
                    <Label className="text-xs">Rua</Label>
                    <Input value={form.street} onChange={(e) => setField(patient.patientId, 'street', e.target.value)} />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Número</Label>
                    <Input value={form.number} onChange={(e) => setField(patient.patientId, 'number', e.target.value)} />
                  </div>
                  <div className="col-span-3 space-y-1">
                    <Label className="text-xs">Complemento</Label>
                    <Input
                      value={form.complement}
                      onChange={(e) => setField(patient.patientId, 'complement', e.target.value)}
                    />
                  </div>
                  <div className="col-span-3 space-y-1">
                    <Label className="text-xs">Bairro</Label>
                    <Input
                      value={form.neighborhood}
                      onChange={(e) => setField(patient.patientId, 'neighborhood', e.target.value)}
                    />
                  </div>
                  <div className="col-span-4 space-y-1">
                    <Label className="text-xs">Cidade</Label>
                    <Input value={form.city} onChange={(e) => setField(patient.patientId, 'city', e.target.value)} />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">UF</Label>
                    <Input
                      maxLength={2}
                      value={form.state}
                      onChange={(e) => setField(patient.patientId, 'state', e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {preview.competenceIsPastMonth && (
          <div className="space-y-2">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="nfse-competence"
                className="mt-1"
                checked={competence === 'service'}
                onChange={() => setCompetence('service')}
              />
              <span>
                <span className="font-medium text-charcoal">Data do serviço ({serviceDate})</span>
                <span className="block text-xs text-mid">O ISS dessa competência pode ter juros e multa.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="nfse-competence"
                className="mt-1"
                checked={competence === 'today'}
                onChange={() => setCompetence('today')}
              />
              <span>
                <span className="font-medium text-charcoal">Hoje ({todayDate})</span>
                <span className="block text-xs text-mid">
                  Esta competência não corresponde à data em que o serviço foi prestado, como exigem as regras
                  nacionais, e pode gerar multa do município.
                </span>
              </span>
            </label>
          </div>
        )}

        <label className={hasEmail ? 'flex items-center gap-2 text-sm' : 'flex items-center gap-2 text-sm text-mid'}>
          <Checkbox
            checked={sendEmail}
            disabled={!hasEmail}
            onCheckedChange={(checked) => setSendEmailChoice(Boolean(checked))}
          />
          Enviar por email
        </label>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Agora não
        </Button>
        <Button disabled={emit.isPending || readyIds.length === 0} onClick={handleEmit}>
          {emit.isPending && <Loader2Icon className="size-4 animate-spin" />}
          Emitir
        </Button>
      </DialogFooter>
    </>
  )
}

export function EmitNfseDialog({ paymentRecordIds, open, onOpenChange }: EmitNfseDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Emitir NFS-e</DialogTitle>
          <DialogDescription>Confira os dados antes de emitir a nota fiscal.</DialogDescription>
        </DialogHeader>
        {open && <EmitNfseForm paymentRecordIds={paymentRecordIds} onOpenChange={onOpenChange} />}
      </DialogContent>
    </Dialog>
  )
}
