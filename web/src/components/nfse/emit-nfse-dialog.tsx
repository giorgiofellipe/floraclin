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
import type { NfseTakerField } from '@/lib/nfse/taker-address'
import { NfseResultCard } from './nfse-result-card'
import type { NfseCompetenceChoice, NfseEmissionResult } from '@/lib/nfse/types'

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

function toTakerInput(patient: NfsePreviewPatient, form: TakerForm, clinicAddress: boolean): NfseTakerInput {
  if (clinicAddress) return { patientId: patient.patientId, cpf: form.cpf }
  return {
    patientId: patient.patientId,
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

function takerComplete(form: TakerForm, clinicAddress: boolean): boolean {
  if (clinicAddress) return Boolean(form.cpf)
  return Boolean(
    form.cpf && form.zip && form.street.trim() && form.number.trim() && form.neighborhood.trim() && form.city.trim() && form.state.trim(),
  )
}

function usesClinicAddress(patient: NfsePreviewPatient): boolean {
  return patient.addressSource === 'clinic'
}

function initialTaker(patient: NfsePreviewPatient): TakerForm {
  return { ...EMPTY_TAKER, ...patient.current }
}

function needsTaker(patient: NfsePreviewPatient): boolean {
  return patient.missing.length > 0
}

function FormHeader() {
  return (
    <DialogHeader>
      <DialogTitle>Emitir NFS-e</DialogTitle>
      <DialogDescription>Confira os dados antes de emitir a nota fiscal.</DialogDescription>
    </DialogHeader>
  )
}

function EmitNfseForm({ paymentRecordIds, onOpenChange }: Omit<EmitNfseDialogProps, 'open'>) {
  const { data: preview, isLoading, error } = useNfsePreview(paymentRecordIds)
  const emit = useEmitNfse()
  const [competence, setCompetence] = useState<NfseCompetenceChoice>('service')
  const [sendEmailChoice, setSendEmailChoice] = useState<boolean | null>(null)
  const [takers, setTakers] = useState<Record<string, TakerForm>>({})
  const [fillingAddress, setFillingAddress] = useState<Set<string>>(() => new Set())
  const [results, setResults] = useState<NfseEmissionResult[] | null>(null)
  const [retryingId, setRetryingId] = useState<string | null>(null)

  if (isLoading) {
    return (
      <>
        <FormHeader />
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-mid">
          <Loader2Icon className="size-4 animate-spin" />
          Carregando...
        </div>
      </>
    )
  }

  if (error || !preview) {
    return (
      <>
        <FormHeader />
        <p className="text-sm text-red-600">{error?.message ?? 'Erro ao carregar os dados da NFS-e'}</p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </>
    )
  }

  const hasEmail = preview.patients.some((p) => p.email)
  const sendEmail = hasEmail && (sendEmailChoice ?? preview.settings.emailPatient)
  const chosenCompetence = preview.competenceIsPastMonth ? competence : 'service'

  async function handleRetry(failed: NfseEmissionResult) {
    setRetryingId(failed.id)
    try {
      const [retried] = await emit.mutateAsync({
        paymentRecordIds: [failed.paymentRecordId],
        competence: chosenCompetence,
        sendEmail,
      })
      if (retried) setResults((prev) => prev?.map((result) => (result.id === failed.id ? retried : result)) ?? null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao emitir a NFS-e')
    } finally {
      setRetryingId(null)
    }
  }

  if (results) {
    const allIssued = results.every((result) => result.status === 'issued')
    return (
      <>
        <DialogHeader>
          <DialogTitle>{allIssued ? 'NFS-e emitida' : 'Resultado da emissão'}</DialogTitle>
        </DialogHeader>
        <ul className="space-y-2">
          {results.map((result) => (
            <NfseResultCard
              key={result.id}
              result={result}
              retrying={retryingId === result.id}
              onRetry={handleRetry}
            />
          ))}
        </ul>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </>
    )
  }

  const formOf = (p: NfsePreviewPatient) => takers[p.patientId] ?? initialTaker(p)
  const fillsAddress = (p: NfsePreviewPatient) => fillingAddress.has(p.patientId)
  const clinicAddress = (p: NfsePreviewPatient) => usesClinicAddress(p) && !fillsAddress(p)
  const editsTaker = (p: NfsePreviewPatient) => needsTaker(p) || fillsAddress(p)
  const blocked = (p: NfsePreviewPatient) => needsTaker(p) && !p.canEditTaker
  const ready = preview.patients.filter(
    (p) => !blocked(p) && (!editsTaker(p) || takerComplete(formOf(p), clinicAddress(p))),
  )
  const readyIds = ready.flatMap((p) => p.paymentRecordIds)
  const serviceDate = formatBrDate(parseBrDate(preview.defaultCompetence))
  const todayDate = formatBrDate(parseBrDate(brToday()))

  function toggleFillingAddress(patient: NfsePreviewPatient, filling: boolean) {
    setFillingAddress((prev) => {
      const next = new Set(prev)
      if (filling) next.add(patient.patientId)
      else next.delete(patient.patientId)
      return next
    })
  }

  function setField(patient: NfsePreviewPatient, field: keyof TakerForm, value: string) {
    setTakers((prev) => ({ ...prev, [patient.patientId]: { ...(prev[patient.patientId] ?? initialTaker(patient)), [field]: value } }))
  }

  async function handleEmit() {
    const takerInputs = ready
      .filter(editsTaker)
      .map((p) => toTakerInput(p, formOf(p), clinicAddress(p)))
    try {
      const data = await emit.mutateAsync({
        paymentRecordIds: readyIds,
        competence: chosenCompetence,
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
      <FormHeader />
      <div className="space-y-4">
        {preview.patients.map((patient) => {
          const form = formOf(patient)
          const required = (field: keyof TakerForm) =>
            patient.missing.includes(field as NfseTakerField) || (fillsAddress(patient) && field !== 'complement')
          const invalid = (field: keyof TakerForm) => required(field) && !form[field].trim()
          return (
            <div key={patient.patientId} className="space-y-2 rounded-md border border-[#E8ECEF] p-3">
              <p className="text-sm font-medium text-charcoal">
                {patient.patientName}: {formatCurrency(patient.total)}
              </p>
              {clinicAddress(patient) && (
                <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                  <p className="text-mid">Paciente sem endereço cadastrado: a nota usa o endereço da clínica.</p>
                  {patient.canEditTaker && (
                    <button
                      type="button"
                      className="font-medium text-sage underline underline-offset-2 hover:text-forest"
                      onClick={() => toggleFillingAddress(patient, true)}
                    >
                      Preencher endereço do paciente
                    </button>
                  )}
                </div>
              )}
              {fillsAddress(patient) && (
                <button
                  type="button"
                  className="text-xs font-medium text-sage underline underline-offset-2 hover:text-forest"
                  onClick={() => toggleFillingAddress(patient, false)}
                >
                  Usar endereço da clínica
                </button>
              )}
              {blocked(patient) && (
                <p className="text-xs text-amber-700">
                  {usesClinicAddress(patient)
                    ? 'Peça a quem tem acesso ao cadastro para completar o CPF.'
                    : 'Peça a quem tem acesso ao cadastro para completar CPF e endereço.'}
                </p>
              )}
              {editsTaker(patient) && patient.canEditTaker && (
                <div className="grid grid-cols-6 gap-2">
                  <div className="col-span-3 space-y-1">
                    <Label htmlFor={`${patient.patientId}-cpf`} className="text-xs">CPF</Label>
                    <MaskedInput
                      id={`${patient.patientId}-cpf`}
                      mask={maskCPF}
                      value={form.cpf}
                      aria-invalid={invalid('cpf')}
                      onChange={(e) => setField(patient, 'cpf', e.target.value)}
                    />
                  </div>
                  {!clinicAddress(patient) && (
                    <>
                      <div className="col-span-3 space-y-1">
                        <Label htmlFor={`${patient.patientId}-zip`} className="text-xs">CEP</Label>
                        <MaskedInput
                          id={`${patient.patientId}-zip`}
                          mask={maskCEP}
                          value={form.zip}
                          aria-invalid={invalid('zip')}
                          onChange={(e) => setField(patient, 'zip', e.target.value)}
                        />
                      </div>
                      <div className="col-span-4 space-y-1">
                        <Label htmlFor={`${patient.patientId}-street`} className="text-xs">Rua</Label>
                        <Input id={`${patient.patientId}-street`} value={form.street} aria-invalid={invalid('street')} onChange={(e) => setField(patient, 'street', e.target.value)} />
                      </div>
                      <div className="col-span-2 space-y-1">
                        <Label htmlFor={`${patient.patientId}-number`} className="text-xs">Número</Label>
                        <Input id={`${patient.patientId}-number`} value={form.number} aria-invalid={invalid('number')} onChange={(e) => setField(patient, 'number', e.target.value)} />
                      </div>
                      <div className="col-span-3 space-y-1">
                        <Label htmlFor={`${patient.patientId}-complement`} className="text-xs">Complemento</Label>
                        <Input
                          id={`${patient.patientId}-complement`}
                          value={form.complement}
                          onChange={(e) => setField(patient, 'complement', e.target.value)}
                        />
                      </div>
                      <div className="col-span-3 space-y-1">
                        <Label htmlFor={`${patient.patientId}-neighborhood`} className="text-xs">Bairro</Label>
                        <Input
                          id={`${patient.patientId}-neighborhood`}
                          value={form.neighborhood}
                          aria-invalid={invalid('neighborhood')}
                          onChange={(e) => setField(patient, 'neighborhood', e.target.value)}
                        />
                      </div>
                      <div className="col-span-4 space-y-1">
                        <Label htmlFor={`${patient.patientId}-city`} className="text-xs">Cidade</Label>
                        <Input id={`${patient.patientId}-city`} value={form.city} aria-invalid={invalid('city')} onChange={(e) => setField(patient, 'city', e.target.value)} />
                      </div>
                      <div className="col-span-2 space-y-1">
                        <Label htmlFor={`${patient.patientId}-state`} className="text-xs">UF</Label>
                        <Input
                          id={`${patient.patientId}-state`}
                          maxLength={2}
                          value={form.state}
                          aria-invalid={invalid('state')}
                          onChange={(e) => setField(patient, 'state', e.target.value)}
                        />
                      </div>
                    </>
                  )}
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
        {open && <EmitNfseForm paymentRecordIds={paymentRecordIds} onOpenChange={onOpenChange} />}
      </DialogContent>
    </Dialog>
  )
}
