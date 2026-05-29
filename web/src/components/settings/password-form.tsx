'use client'

import { useState } from 'react'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Self-service password setter. Mirrors the section that used to live in the
 * avatar-dropdown "Meu Perfil" modal. Posts to PUT /api/profile/password.
 *
 * `currentPassword` is optional — first-time setters (e.g., users created
 * with magic-link auth) won't have one.
 */
export function PasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      toast.error('As senhas não conferem')
      return
    }
    if (newPassword.length < 8) {
      toast.error('A senha deve ter pelo menos 8 caracteres')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/profile/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: currentPassword || undefined,
          newPassword,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Erro ao alterar senha')
      }
      toast.success('Senha atualizada')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao alterar senha')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="pw-current">
          Senha atual{' '}
          <span className="text-xs font-normal text-mid">
            (deixe em branco se nunca definiu)
          </span>
        </Label>
        <Input
          id="pw-current"
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          placeholder="Senha atual"
          autoComplete="current-password"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pw-new">Nova senha</Label>
          <Input
            id="pw-new"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Mínimo 8 caracteres"
            autoComplete="new-password"
            minLength={8}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pw-confirm">Confirmar nova senha</Label>
          <Input
            id="pw-confirm"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Repita a nova senha"
            autoComplete="new-password"
            minLength={8}
          />
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={saving || !newPassword}>
          {saving ? <Loader2Icon className="h-4 w-4 animate-spin" /> : 'Atualizar senha'}
        </Button>
      </div>
    </form>
  )
}
