'use client'

import { useState } from 'react'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useUpdateProfile, type ProfileData } from '@/hooks/queries/use-profile'

interface AccountInfoFormProps {
  initial: ProfileData
}

/**
 * Name + phone editor for the user's own account. Mirrors the basic-info
 * surface that used to live in the avatar-dropdown "Meu Perfil" modal.
 * `email` is read-only — auth identity is managed elsewhere.
 */
export function AccountInfoForm({ initial }: AccountInfoFormProps) {
  const updateProfile = useUpdateProfile()
  const [fullName, setFullName] = useState(initial.fullName ?? '')
  const [phone, setPhone] = useState(initial.phone ?? '')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!fullName.trim()) {
      toast.error('Nome é obrigatório')
      return
    }
    try {
      await updateProfile.mutateAsync({
        fullName: fullName.trim(),
        phone: phone.trim() || null,
      })
      toast.success('Conta atualizada')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="acc-name">Nome completo</Label>
          <Input
            id="acc-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Seu nome completo"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="acc-phone">Telefone</Label>
          <Input
            id="acc-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(11) 99999-9999"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>E-mail</Label>
        <Input value={initial.email ?? ''} readOnly disabled />
        <p className="text-xs text-mid">
          Para alterar o e-mail, fale com o administrador da clínica.
        </p>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={updateProfile.isPending}>
          {updateProfile.isPending ? (
            <Loader2Icon className="h-4 w-4 animate-spin" />
          ) : (
            'Salvar'
          )}
        </Button>
      </div>
    </form>
  )
}
