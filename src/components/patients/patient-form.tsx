'use client'

import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createPatientSchema, type CreatePatientInput, type UpdatePatientInput } from '@/validations/patient'
import { useCreatePatient, useUpdatePatient } from '@/hooks/mutations/use-patient-mutations'
import type { Patient } from '@/db/queries/patients'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MaskedInput } from '@/components/ui/masked-input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { maskPhone, maskCPF, maskCEP } from '@/lib/masks'
import { DatePicker } from '@/components/ui/date-picker'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet'
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react'

const GENDER_ITEMS: Record<string, string> = {
  feminino: 'Feminino',
  masculino: 'Masculino',
  outro: 'Outro',
  nao_informado: 'Prefiro não informar',
}

const REFERRAL_SOURCE_ITEMS: Record<string, string> = {
  indicacao: 'Indicação',
  instagram: 'Instagram',
  google: 'Google',
  facebook: 'Facebook',
  site: 'Site',
  outro: 'Outro',
}

interface PatientFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  patient?: Patient | null
  /** When true, renders the form inline (no Sheet wrapper) */
  inline?: boolean
  /** Pre-fill data for new patient (from booking link) */
  prefill?: { fullName?: string; phone?: string }
}

export function PatientForm({ open, onOpenChange, patient, inline, prefill }: PatientFormProps) {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)
  const [addressOpen, setAddressOpen] = useState(false)
  const createPatient = useCreatePatient()
  const updatePatientMutation = useUpdatePatient()
  const isPending = createPatient.isPending || updatePatientMutation.isPending

  const isEditing = !!patient

  const address = patient?.address as Record<string, string> | null | undefined

  const patientDefaults = useMemo<CreatePatientInput>(() => ({
    fullName: patient?.fullName ?? prefill?.fullName ?? '',
    phone: patient?.phone ?? prefill?.phone ?? '',
    cpf: patient?.cpf ?? '',
    birthDate: patient?.birthDate ?? '',
    gender: patient?.gender ?? '',
    email: patient?.email ?? '',
    phoneSecondary: patient?.phoneSecondary ?? '',
    occupation: patient?.occupation ?? '',
    referralSource: patient?.referralSource ?? '',
    notes: patient?.notes ?? '',
    address: {
      street: address?.street ?? '',
      number: address?.number ?? '',
      complement: address?.complement ?? '',
      neighborhood: address?.neighborhood ?? '',
      city: address?.city ?? '',
      state: address?.state ?? '',
      zip: address?.zip ?? '',
    },
  }), [patient, address])

  const form = useForm<CreatePatientInput>({
    resolver: zodResolver(createPatientSchema),
    defaultValues: patientDefaults,
  })

  // Reset form when the patient prop changes (e.g. opening edit for a different patient)
  useEffect(() => {
    form.reset(patientDefaults)
  }, [patientDefaults, form])

  async function onSubmit(data: CreatePatientInput) {
    setServerError(null)

    try {
      if (isEditing && patient) {
        await updatePatientMutation.mutateAsync({ id: patient.id, ...data })
      } else {
        await createPatient.mutateAsync(data as Record<string, unknown>)
      }
      onOpenChange(false)
      // Only reset to blank defaults when creating; in edit mode the form will
      // either close (Sheet) or stay with up-to-date data after router.refresh().
      if (!isEditing) {
        form.reset()
      }
      router.refresh()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro ao salvar paciente'
      setServerError(message)
    }
  }

  const formContent = (
    <form onSubmit={form.handleSubmit(onSubmit)} className={inline ? "flex flex-col gap-5" : "flex flex-col gap-5 px-4"} data-testid="patient-form">
      {serverError && (
        <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {serverError}
        </div>
      )}

      {/* ── Informações Pessoais ── */}
      <fieldset className="space-y-4">
        <legend className="text-xs uppercase tracking-wider text-mid font-medium pb-2 border-b border-blush/40 w-full">Informações Pessoais</legend>

        {/* Nome completo */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fullName" className="text-xs uppercase tracking-wider text-mid">Nome completo *</Label>
          <Input
            id="fullName"
            {...form.register('fullName')}
            aria-invalid={!!form.formState.errors.fullName}
            className="border-blush/60 focus:ring-sage/30 transition-shadow"
            data-testid="patient-form-name"
          />
          {form.formState.errors.fullName && (
            <p className="text-xs text-destructive">{form.formState.errors.fullName.message}</p>
          )}
        </div>

        {/* Data de nascimento + Gênero (side by side) */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="birthDate" className="text-xs uppercase tracking-wider text-mid">Data de nascimento</Label>
            <DatePicker
              value={form.watch('birthDate') ?? ''}
              onChange={(v) => form.setValue('birthDate', v)}
              placeholder="Selecionar"
              showYearNavigation
              yearRange={{ from: 1920, to: new Date().getFullYear() }}
              maxDate={new Date().toISOString().split('T')[0]}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs uppercase tracking-wider text-mid">Gênero</Label>
            <Select
              items={GENDER_ITEMS}
              value={form.watch('gender') ?? ''}
              onValueChange={(val) => form.setValue('gender', val ?? '')}
            >
              <SelectTrigger className="w-full border-blush/60 focus:ring-sage/30">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent />
            </Select>
          </div>
        </div>

        {/* CPF */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cpf" className="text-xs uppercase tracking-wider text-mid">CPF</Label>
          <Controller
            control={form.control}
            name="cpf"
            render={({ field }) => (
              <MaskedInput
                id="cpf"
                mask={maskCPF}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                ref={field.ref}
                placeholder="000.000.000-00"
                className="border-blush/60 focus:ring-sage/30 transition-shadow"
              />
            )}
          />
        </div>
      </fieldset>

      {/* ── Contato ── */}
      <fieldset className="space-y-4">
        <legend className="text-xs uppercase tracking-wider text-mid font-medium pb-2 border-b border-blush/40 w-full">Contato</legend>

        {/* Telefone */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="phone" className="text-xs uppercase tracking-wider text-mid">Telefone *</Label>
          <Controller
            control={form.control}
            name="phone"
            render={({ field }) => (
              <MaskedInput
                id="phone"
                mask={maskPhone}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                ref={field.ref}
                aria-invalid={!!form.formState.errors.phone}
                className="border-blush/60 focus:ring-sage/30 transition-shadow"
                data-testid="patient-form-phone"
              />
            )}
          />
          {form.formState.errors.phone && (
            <p className="text-xs text-destructive">{form.formState.errors.phone.message}</p>
          )}
        </div>

        {/* Telefone secundario */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="phoneSecondary" className="text-xs uppercase tracking-wider text-mid">Telefone secundário</Label>
          <Controller
            control={form.control}
            name="phoneSecondary"
            render={({ field }) => (
              <MaskedInput
                id="phoneSecondary"
                mask={maskPhone}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                ref={field.ref}
                className="border-blush/60 focus:ring-sage/30 transition-shadow"
              />
            )}
          />
        </div>

        {/* E-mail */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email" className="text-xs uppercase tracking-wider text-mid">E-mail</Label>
          <Input
            id="email"
            type="email"
            {...form.register('email')}
            aria-invalid={!!form.formState.errors.email}
            className="border-blush/60 focus:ring-sage/30 transition-shadow"
          />
          {form.formState.errors.email && (
            <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
          )}
        </div>
      </fieldset>

      {/* ── Dados Complementares ── */}
      <fieldset className="space-y-4">
        <legend className="text-xs uppercase tracking-wider text-mid font-medium pb-2 border-b border-blush/40 w-full">Dados Complementares</legend>

        {/* Profissão */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="occupation" className="text-xs uppercase tracking-wider text-mid">Profissão</Label>
          <Input id="occupation" {...form.register('occupation')} className="border-blush/60 focus:ring-sage/30 transition-shadow" />
        </div>

        {/* Como nos conheceu */}
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs uppercase tracking-wider text-mid">Como nos conheceu</Label>
          <Select
            items={REFERRAL_SOURCE_ITEMS}
            value={form.watch('referralSource') ?? ''}
            onValueChange={(val) => form.setValue('referralSource', val ?? '')}
          >
            <SelectTrigger className="w-full border-blush/60 focus:ring-sage/30">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent />
          </Select>
        </div>
      </fieldset>

      {/* Endereço - collapsible */}
      <div className="rounded-[3px] border border-[#E8ECEF] overflow-hidden">
        <button
          type="button"
          onClick={() => setAddressOpen(!addressOpen)}
          className="flex w-full items-center justify-between px-4 py-3 text-[10px] uppercase tracking-[0.15em] text-[#7A7A7A] hover:bg-[#F4F6F8] transition-colors"
        >
          <span>Endereço</span>
          <ChevronDownIcon className={`size-4 text-mid transition-transform duration-200 ${addressOpen ? 'rotate-0' : '-rotate-90'}`} />
        </button>

        <div
          className={`grid transition-all duration-200 ease-in-out ${addressOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
        >
          <div className="overflow-hidden">
            <div className="flex flex-col gap-3 border-t border-blush/40 p-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="address.street" className="text-xs uppercase tracking-wider text-mid">Rua</Label>
                <Input id="address.street" {...form.register('address.street')} className="border-blush/60 focus:ring-sage/30 transition-shadow" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="address.number" className="text-xs uppercase tracking-wider text-mid">Número</Label>
                  <Input id="address.number" {...form.register('address.number')} className="border-blush/60 focus:ring-sage/30 transition-shadow" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="address.complement" className="text-xs uppercase tracking-wider text-mid">Complemento</Label>
                  <Input id="address.complement" {...form.register('address.complement')} className="border-blush/60 focus:ring-sage/30 transition-shadow" />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="address.neighborhood" className="text-xs uppercase tracking-wider text-mid">Bairro</Label>
                <Input id="address.neighborhood" {...form.register('address.neighborhood')} className="border-blush/60 focus:ring-sage/30 transition-shadow" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="address.city" className="text-xs uppercase tracking-wider text-mid">Cidade</Label>
                  <Input id="address.city" {...form.register('address.city')} className="border-blush/60 focus:ring-sage/30 transition-shadow" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="address.state" className="text-xs uppercase tracking-wider text-mid">Estado</Label>
                  <Input id="address.state" {...form.register('address.state')} className="border-blush/60 focus:ring-sage/30 transition-shadow" />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="address.zip" className="text-xs uppercase tracking-wider text-mid">CEP</Label>
                <Controller
                  control={form.control}
                  name="address.zip"
                  render={({ field }) => (
                    <MaskedInput
                      id="address.zip"
                      mask={maskCEP}
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      ref={field.ref}
                      placeholder="00000-000"
                      className="border-blush/60 focus:ring-sage/30 transition-shadow"
                    />
                  )}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Observações */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="notes" className="text-xs uppercase tracking-wider text-mid">Observações</Label>
        <Textarea id="notes" {...form.register('notes')} rows={3} className="border-blush/60 focus:ring-sage/30 transition-shadow" />
      </div>

      {inline ? (
        <div className="flex justify-end gap-2 pt-2">
          <Button type="submit" disabled={isPending} className="bg-forest text-cream hover:bg-sage transition-colors" data-testid="patient-form-submit">
            {isPending ? 'Salvando...' : 'Salvar alterações'}
          </Button>
        </div>
      ) : (
        <SheetFooter className="mx-0 px-0 pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="border-sage/30 text-mid hover:bg-petal transition-colors">
            Cancelar
          </Button>
          <Button type="submit" disabled={isPending} className="bg-forest text-cream hover:bg-sage transition-colors" data-testid="patient-form-submit">
            {isPending ? 'Salvando...' : isEditing ? 'Salvar' : 'Cadastrar'}
          </Button>
        </SheetFooter>
      )}
    </form>
  )

  if (inline) {
    return formContent
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pb-2">
          <SheetTitle className="text-xl font-semibold text-[#2A2A2A]">{isEditing ? 'Editar Paciente' : 'Novo Paciente'}</SheetTitle>
          <SheetDescription className="text-mid">
            {isEditing
              ? 'Atualize os dados do paciente.'
              : 'Preencha os dados para cadastrar um novo paciente.'}
          </SheetDescription>
        </SheetHeader>
        {formContent}
      </SheetContent>
    </Sheet>
  )
}
