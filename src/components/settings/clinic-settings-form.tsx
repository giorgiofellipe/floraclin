'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MaskedInput } from '@/components/ui/masked-input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card } from '@/components/ui/card'
import { updateTenantAction } from '@/actions/tenants'
import { DEFAULT_WORKING_HOURS } from '@/lib/constants'
import { toast } from 'sonner'
import type { WorkingHours } from '@/validations/tenant'
import { maskPhone, maskCEP } from '@/lib/masks'

const WEEKDAY_LABELS: Record<string, string> = {
  mon: 'Segunda-feira',
  tue: 'Terça-feira',
  wed: 'Quarta-feira',
  thu: 'Quinta-feira',
  fri: 'Sexta-feira',
  sat: 'Sábado',
  sun: 'Domingo',
}

const WEEKDAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

interface ClinicSettingsFormProps {
  initialData: {
    name: string
    phone?: string | null
    email?: string | null
    address?: Record<string, string> | null
    workingHours?: WorkingHours | null
  }
  /** When embedded in onboarding wizard, hides the save button and exposes data via onChange */
  embedded?: boolean
  onChange?: (data: Record<string, unknown>) => void
}

export function ClinicSettingsForm({ initialData, embedded = false, onChange }: ClinicSettingsFormProps) {
  const [isPending, startTransition] = useTransition()
  const [name, setName] = useState(initialData.name || '')
  const [phone, setPhone] = useState(initialData.phone || '')
  const [email, setEmail] = useState(initialData.email || '')
  const [address, setAddress] = useState({
    street: (initialData.address as Record<string, string>)?.street || '',
    number: (initialData.address as Record<string, string>)?.number || '',
    complement: (initialData.address as Record<string, string>)?.complement || '',
    neighborhood: (initialData.address as Record<string, string>)?.neighborhood || '',
    city: (initialData.address as Record<string, string>)?.city || '',
    state: (initialData.address as Record<string, string>)?.state || '',
    zip: (initialData.address as Record<string, string>)?.zip || '',
  })
  const [workingHours, setWorkingHours] = useState<WorkingHours>(
    (initialData.workingHours as WorkingHours) || DEFAULT_WORKING_HOURS
  )

  function updateAddress(field: string, value: string) {
    const updated = { ...address, [field]: value }
    setAddress(updated)
    onChange?.({ name, phone, email, address: updated, workingHours })
  }

  function updateWorkingHour(day: string, field: string, value: string | boolean) {
    const updated = {
      ...workingHours,
      [day]: { ...workingHours[day as keyof WorkingHours], [field]: value },
    }
    setWorkingHours(updated)
    onChange?.({ name, phone, email, address, workingHours: updated })
  }

  function handleFieldChange(field: string, value: string) {
    if (field === 'name') setName(value)
    if (field === 'phone') setPhone(value)
    if (field === 'email') setEmail(value)
    onChange?.({
      name: field === 'name' ? value : name,
      phone: field === 'phone' ? value : phone,
      email: field === 'email' ? value : email,
      address,
      workingHours,
    })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (embedded) return

    startTransition(async () => {
      const result = await updateTenantAction({
        name,
        phone,
        email,
        address: Object.values(address).some(v => v) ? address : undefined,
        workingHours,
      })

      if (result?.success) {
        toast.success('Configurações atualizadas com sucesso')
      } else {
        toast.error(result?.error || 'Erro ao atualizar configurações')
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Clinic Info */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="uppercase tracking-wider text-xs font-medium text-mid">Informacoes da Clinica</h3>
          <div className="flex-1 h-px bg-blush/60" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="name">Nome da Clinica *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => handleFieldChange('name', e.target.value)}
              placeholder="Nome da clinica"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Telefone</Label>
            <MaskedInput
              id="phone"
              mask={maskPhone}
              value={phone}
              onChange={(e) => handleFieldChange('phone', e.target.value)}
              placeholder="(11) 99999-9999"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => handleFieldChange('email', e.target.value)}
              placeholder="contato@clinica.com"
            />
          </div>
        </div>
      </div>

      {/* Address */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="uppercase tracking-wider text-xs font-medium text-mid">Endereco</h3>
          <div className="flex-1 h-px bg-blush/60" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="street">Rua</Label>
            <Input
              id="street"
              value={address.street}
              onChange={(e) => updateAddress('street', e.target.value)}
              placeholder="Rua / Avenida"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="number">Numero</Label>
            <Input
              id="number"
              value={address.number}
              onChange={(e) => updateAddress('number', e.target.value)}
              placeholder="123"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="complement">Complemento</Label>
            <Input
              id="complement"
              value={address.complement}
              onChange={(e) => updateAddress('complement', e.target.value)}
              placeholder="Sala 101"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="neighborhood">Bairro</Label>
            <Input
              id="neighborhood"
              value={address.neighborhood}
              onChange={(e) => updateAddress('neighborhood', e.target.value)}
              placeholder="Bairro"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="city">Cidade</Label>
            <Input
              id="city"
              value={address.city}
              onChange={(e) => updateAddress('city', e.target.value)}
              placeholder="Cidade"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="state">Estado</Label>
            <Input
              id="state"
              value={address.state}
              onChange={(e) => updateAddress('state', e.target.value)}
              placeholder="SP"
              maxLength={2}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="zip">CEP</Label>
            <MaskedInput
              id="zip"
              mask={maskCEP}
              value={address.zip}
              onChange={(e) => updateAddress('zip', e.target.value)}
              placeholder="00000-000"
            />
          </div>
        </div>
      </div>

      {/* Working Hours */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="uppercase tracking-wider text-xs font-medium text-mid">Horario de Funcionamento</h3>
          <div className="flex-1 h-px bg-blush/60" />
        </div>
        <div className="rounded-[3px] border border-[#E8ECEF] overflow-hidden divide-y divide-gray-100">
          {WEEKDAY_ORDER.map((day) => {
            const schedule = workingHours[day]
            return (
              <div
                key={day}
                className={`flex items-center gap-4 px-4 py-3 transition-colors ${schedule.enabled ? 'bg-white' : 'bg-[#F4F6F8]'}`}
              >
                <div className="flex items-center gap-3 min-w-[160px]">
                  <Switch
                    checked={schedule.enabled}
                    onCheckedChange={(checked) =>
                      updateWorkingHour(day, 'enabled', checked)
                    }
                    size="sm"
                  />
                  <span className={`text-sm font-medium ${schedule.enabled ? 'text-charcoal' : 'text-mid'}`}>
                    {WEEKDAY_LABELS[day]}
                  </span>
                </div>
                {schedule.enabled ? (
                  <div className="flex items-center gap-2">
                    <Input
                      type="time"
                      value={schedule.start}
                      onChange={(e) =>
                        updateWorkingHour(day, 'start', e.target.value)
                      }
                      className="w-[110px] text-sm"
                    />
                    <span className="text-xs text-mid font-medium">ate</span>
                    <Input
                      type="time"
                      value={schedule.end}
                      onChange={(e) =>
                        updateWorkingHour(day, 'end', e.target.value)
                      }
                      className="w-[110px] text-sm"
                    />
                  </div>
                ) : (
                  <span className="text-xs text-mid italic">Fechado</span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {!embedded && (
        <div className="flex justify-end pt-2">
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Salvando...' : 'Salvar Configuracoes'}
          </Button>
        </div>
      )}
    </form>
  )
}
