'use client'

import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createPatientSchema, type CreatePatientInput, type UpdatePatientInput } from '@/validations/patient'
import { createPatientAction, updatePatientAction } from '@/actions/patients'
import type { Patient } from '@/db/queries/patients'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MaskedInput } from '@/components/ui/masked-input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { maskPhone, maskCPF, maskCEP } from '@/lib/masks'
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react'

interface PatientFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  patient?: Patient | null
  /** When true, renders the form inline (no Sheet wrapper) */
  inline?: boolean
}

export function PatientForm({ open, onOpenChange, patient, inline }: PatientFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [serverError, setServerError] = useState<string | null>(null)
  const [addressOpen, setAddressOpen] = useState(false)

  const isEditing = !!patient

  const address = patient?.address as Record<string, string> | null | undefined

  const form = useForm<CreatePatientInput>({
    resolver: zodResolver(createPatientSchema),
    defaultValues: {
      fullName: patient?.fullName ?? '',
      phone: patient?.phone ?? '',
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
    },
  })

  function onSubmit(data: CreatePatientInput) {
    setServerError(null)

    startTransition(async () => {
      let result
      if (isEditing && patient) {
        result = await updatePatientAction({ id: patient.id, ...data } as UpdatePatientInput)
      } else {
        result = await createPatientAction(data)
      }

      if (result?.error) {
        setServerError(result.error)
        if (result.fieldErrors) {
          Object.entries(result.fieldErrors).forEach(([field, errors]) => {
            if (errors?.[0]) {
              form.setError(field as keyof CreatePatientInput, { message: errors[0] })
            }
          })
        }
        return
      }

      if (result?.success) {
        onOpenChange(false)
        form.reset()
        router.refresh()
      }
    })
  }

  const formContent = (
    <form onSubmit={form.handleSubmit(onSubmit)} className={inline ? "flex flex-col gap-4" : "flex flex-col gap-4 px-4"} data-testid="patient-form">
      {serverError && (
        <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {serverError}
        </div>
      )}

      {/* Nome completo */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="fullName">Nome completo *</Label>
        <Input
          id="fullName"
          {...form.register('fullName')}
          aria-invalid={!!form.formState.errors.fullName}
          data-testid="patient-form-name"
        />
        {form.formState.errors.fullName && (
          <p className="text-xs text-destructive">{form.formState.errors.fullName.message}</p>
        )}
      </div>

      {/* Telefone */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="phone">Telefone *</Label>
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
        <Label htmlFor="phoneSecondary">Telefone secundário</Label>
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
            />
          )}
        />
      </div>

      {/* CPF */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cpf">CPF</Label>
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
            />
          )}
        />
      </div>

      {/* E-mail */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">E-mail</Label>
        <Input
          id="email"
          type="email"
          {...form.register('email')}
          aria-invalid={!!form.formState.errors.email}
        />
        {form.formState.errors.email && (
          <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
        )}
      </div>

      {/* Data de nascimento */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="birthDate">Data de nascimento</Label>
        <Input id="birthDate" type="date" {...form.register('birthDate')} />
      </div>

      {/* Gênero */}
      <div className="flex flex-col gap-1.5">
        <Label>Gênero</Label>
        <Select
          value={form.watch('gender') ?? ''}
          onValueChange={(val) => form.setValue('gender', val ?? '')}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Selecione" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="feminino">Feminino</SelectItem>
            <SelectItem value="masculino">Masculino</SelectItem>
            <SelectItem value="outro">Outro</SelectItem>
            <SelectItem value="nao_informado">Prefiro não informar</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Profissão */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="occupation">Profissão</Label>
        <Input id="occupation" {...form.register('occupation')} />
      </div>

      {/* Como nos conheceu */}
      <div className="flex flex-col gap-1.5">
        <Label>Como nos conheceu</Label>
        <Select
          value={form.watch('referralSource') ?? ''}
          onValueChange={(val) => form.setValue('referralSource', val ?? '')}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Selecione" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="indicacao">Indicação</SelectItem>
            <SelectItem value="instagram">Instagram</SelectItem>
            <SelectItem value="google">Google</SelectItem>
            <SelectItem value="facebook">Facebook</SelectItem>
            <SelectItem value="site">Site</SelectItem>
            <SelectItem value="outro">Outro</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Endereço - collapsible */}
      <div className="rounded-lg border">
        <button
          type="button"
          onClick={() => setAddressOpen(!addressOpen)}
          className="flex w-full items-center justify-between p-3 text-sm font-medium hover:bg-muted/50 rounded-lg"
        >
          <span>Endereço</span>
          {addressOpen ? (
            <ChevronDownIcon className="size-4 text-muted-foreground" />
          ) : (
            <ChevronRightIcon className="size-4 text-muted-foreground" />
          )}
        </button>

        {addressOpen && (
          <div className="flex flex-col gap-3 border-t p-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="address.street">Rua</Label>
              <Input id="address.street" {...form.register('address.street')} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="address.number">Número</Label>
                <Input id="address.number" {...form.register('address.number')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="address.complement">Complemento</Label>
                <Input id="address.complement" {...form.register('address.complement')} />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="address.neighborhood">Bairro</Label>
              <Input id="address.neighborhood" {...form.register('address.neighborhood')} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="address.city">Cidade</Label>
                <Input id="address.city" {...form.register('address.city')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="address.state">Estado</Label>
                <Input id="address.state" {...form.register('address.state')} />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="address.zip">CEP</Label>
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
                  />
                )}
              />
            </div>
          </div>
        )}
      </div>

      {/* Observações */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="notes">Observações</Label>
        <Textarea id="notes" {...form.register('notes')} rows={3} />
      </div>

      {inline ? (
        <div className="flex justify-end gap-2 pt-2">
          <Button type="submit" disabled={isPending} data-testid="patient-form-submit">
            {isPending ? 'Salvando...' : 'Salvar alterações'}
          </Button>
        </div>
      ) : (
        <SheetFooter className="mx-0 px-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isPending} data-testid="patient-form-submit">
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
        <SheetHeader>
          <SheetTitle>{isEditing ? 'Editar Paciente' : 'Novo Paciente'}</SheetTitle>
          <SheetDescription>
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
