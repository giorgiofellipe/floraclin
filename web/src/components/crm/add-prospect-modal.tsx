'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { MaskedInput } from '@/components/ui/masked-input'
import { maskPhone } from '@/lib/masks'
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface AddProspectModalProps {
  open: boolean
  onClose: () => void
  onCreated: () => void
}

const SOURCE_ITEMS: Record<string, string> = {
  manual: 'Manual',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  indicacao: 'Indicação',
  outro: 'Outro',
}

export function AddProspectModal({ open, onClose, onCreated }: AddProspectModalProps) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [source, setSource] = useState('manual')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSaving(true)

    try {
      const res = await fetch('/api/crm/prospects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, source, notes: notes || undefined }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error || 'Erro ao criar lead')
      }

      setName('')
      setPhone('')
      setSource('manual')
      setNotes('')
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo Lead</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="lead-name">Nome *</Label>
            <Input
              id="lead-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome do lead"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="lead-phone">Telefone *</Label>
            <MaskedInput
              id="lead-phone"
              mask={maskPhone}
              value={phone}
              onValueChange={(raw) => setPhone(raw)}
              placeholder="(11) 99999-9999"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="lead-source">Origem</Label>
            <Select items={SOURCE_ITEMS} value={source} onValueChange={(v) => { if (v) setSource(v) }}>
              <SelectTrigger id="lead-source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent />
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="lead-notes">Observações</Label>
            <Textarea
              id="lead-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anotações sobre o lead..."
              rows={3}
            />
          </div>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Criar Lead
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
