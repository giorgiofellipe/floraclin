'use client'

import * as React from 'react'
import { PlusIcon, XIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { usePatientSearch, useRecentPatients } from '@/hooks/queries/use-patients'
import { useDebounced } from '@/hooks/use-debounced'
import { maskPhone } from '@/lib/masks'
import { formatBrPhone } from '@/lib/phone'
import { cn, redactCPF } from '@/lib/utils'

/** A patient picked from the clinic, or a name typed in (with a phone, it becomes a new patient on save). */
export type PatientChoice =
  | { kind: 'existing'; id: string; fullName: string }
  | { kind: 'new'; fullName: string; phone: string }

interface PatientPickerProps {
  id: string
  value: PatientChoice | null
  onChange: (value: PatientChoice | null) => void
  /** Opened from a patient's page: the patient is fixed. */
  locked?: boolean
  autoFocus?: boolean
  labelClassName?: string
}

const RESULT_LIMIT = 20
const MIN_PHONE_DIGITS = 10

const CHIP = 'inline-flex min-h-9 max-w-full items-center rounded-full border border-sage/25 bg-white px-3 text-[13px] text-charcoal transition-colors hover:border-sage/50 hover:bg-confirmed-bg max-sm:min-h-11'

export function PatientPicker({ id, value, onChange, locked = false, autoFocus = false, labelClassName }: PatientPickerProps) {
  const [search, setSearch] = React.useState(value?.kind === 'new' ? value.fullName : '')
  const [forceNew, setForceNew] = React.useState(false)
  const debounced = useDebounced(search, 250)
  const results = usePatientSearch(debounced)
  const recent = useRecentPatients({ enabled: !locked })

  // The parent can reset the choice (form reopened, quick card handed over); follow it.
  const typedName = value?.kind === 'new' ? value.fullName : ''
  React.useEffect(() => {
    setSearch(typedName)
  }, [typedName])

  const searching = search.trim().length >= 2
  // A failed search is not "no matches": offering to register then would duplicate patients.
  const settled = searching && debounced === search && !results.isFetching && results.isSuccess
  const matches = results.data ?? []
  const showPhone = value?.kind === 'new' && (forceNew || (settled && matches.length === 0))

  const pick = (patient: { id: string; fullName: string }) => {
    setSearch('')
    setForceNew(false)
    onChange({ kind: 'existing', id: patient.id, fullName: patient.fullName })
  }

  const handleSearchChange = (text: string) => {
    setSearch(text)
    setForceNew(false)
    const phone = value?.kind === 'new' ? value.phone : ''
    onChange(text.trim().length > 0 ? { kind: 'new', fullName: text, phone } : null)
  }

  if (value?.kind === 'existing') {
    return (
      <div className="grid gap-2" role="group" aria-labelledby={`${id}-label`}>
        <span id={`${id}-label`} className={cn('text-sm font-medium leading-none', labelClassName)}>Paciente</span>
        <div className="flex min-h-10 items-center justify-between gap-2 rounded-lg border border-sage/25 bg-confirmed-bg px-3 py-1.5">
          <span id={id} className="truncate text-sm font-medium text-charcoal">{value.fullName}</span>
          {!locked && (
            <button
              type="button"
              className="-mr-2 flex size-9 shrink-0 items-center justify-center rounded-full text-mid hover:bg-white hover:text-charcoal max-sm:size-11"
              aria-label="Trocar paciente"
              onClick={() => onChange(null)}
              data-testid="patient-picker-clear"
            >
              <XIcon className="size-4" />
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={id} className={labelClassName}>Paciente</Label>
      <Input
        id={id}
        placeholder="Buscar por nome ou telefone"
        value={search}
        autoComplete="off"
        autoFocus={autoFocus}
        onChange={(e) => handleSearchChange(e.target.value)}
        data-testid="patient-picker-search"
      />

      {!searching && (recent.data?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Pacientes recentes" role="group">
          {recent.data!.map((p) => (
            <button key={p.id} type="button" className={CHIP} onClick={() => pick(p)} data-testid="patient-recent-chip">
              <span className="truncate">{p.fullName}</span>
            </button>
          ))}
        </div>
      )}

      {searching && matches.length > 0 && !forceNew && (
        <ul className="max-h-48 divide-y divide-sage/10 overflow-y-auto rounded-lg border border-sage/15" data-testid="patient-picker-results">
          {matches.slice(0, RESULT_LIMIT).map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="flex min-h-10 w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-confirmed-bg max-sm:min-h-11"
                onClick={() => pick(p)}
              >
                <span className="min-w-0 flex-1 truncate">{p.fullName}</span>
                {p.phone && <span className="shrink-0 text-xs text-mid">{formatBrPhone(p.phone)}</span>}
                {p.cpf && <span className="shrink-0 text-xs text-mid">{redactCPF(p.cpf)}</span>}
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              className="flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-forest hover:bg-confirmed-bg max-sm:min-h-11"
              onClick={() => setForceNew(true)}
            >
              <PlusIcon className="size-3.5" />
              <span className="truncate">Cadastrar &ldquo;{search.trim()}&rdquo;</span>
            </button>
          </li>
        </ul>
      )}

      {searching && results.isError && (
        <p className="text-[13px] text-red-700" role="alert">Não foi possível buscar pacientes. Tente de novo.</p>
      )}

      {showPhone && value?.kind === 'new' && (
        <div className="grid gap-1.5 rounded-lg bg-confirmed-bg p-3" data-testid="patient-picker-new">
          <p className="text-[13px] text-charcoal">
            Novo paciente: <span className="font-medium">{value.fullName.trim()}</span>
          </p>
          <Label htmlFor={`${id}-phone`} className="text-xs text-mid">Telefone</Label>
          <Input
            id={`${id}-phone`}
            inputMode="tel"
            placeholder="(11) 99999-9999"
            value={maskPhone(value.phone)}
            onChange={(e) => onChange({ ...value, phone: maskPhone(e.target.value) })}
            data-testid="patient-picker-phone"
          />
          <p className="text-[12px] text-mid">Sem telefone, o horário fica reservado só com o nome.</p>
        </div>
      )}
    </div>
  )
}

/** Turns a choice into the appointment fields, creating the patient first when a phone was given. */
export async function resolvePatientChoice(
  choice: PatientChoice | null,
  createPatient: (input: { fullName: string; phone: string }) => Promise<unknown>,
): Promise<{ patientId: string | null; bookingName?: string }> {
  if (!choice) return { patientId: null }
  if (choice.kind === 'existing') return { patientId: choice.id, bookingName: choice.fullName }
  const fullName = choice.fullName.trim()
  const digits = choice.phone.replace(/\D/g, '').length
  if (digits > 0 && digits < MIN_PHONE_DIGITS) throw new Error('Telefone incompleto: informe DDD e número, ou deixe em branco.')
  if (digits >= MIN_PHONE_DIGITS) {
    const result = (await createPatient({ fullName, phone: choice.phone })) as { data: { id: string } }
    return { patientId: result.data.id, bookingName: fullName }
  }
  return { patientId: null, bookingName: fullName || undefined }
}
