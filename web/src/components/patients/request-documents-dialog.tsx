'use client'

import { useState } from 'react'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { TEMPLATE_TEXT_PARAM_MAX } from '@/lib/whatsapp-blueprints'

interface RequestDocumentsDialogProps {
  patientId: string
  patientName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RequestDocumentsDialog({ patientId, patientName, open, onOpenChange }: RequestDocumentsDialogProps) {
  const [documents, setDocuments] = useState('')
  const [sending, setSending] = useState(false)

  async function handleSend() {
    setSending(true)
    try {
      const res = await fetch(`/api/patients/${patientId}/document-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documents }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao solicitar documentos')
      }
      toast.success('Solicitação enviada por WhatsApp')
      setDocuments('')
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao solicitar documentos')
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Solicitar documentos</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="requested-documents">Documentos para {patientName}</Label>
          <Textarea
            id="requested-documents"
            data-testid="requested-documents"
            value={documents}
            onChange={(e) => setDocuments(e.target.value)}
            placeholder="Ex: RG, CPF e comprovante de endereço."
            maxLength={TEMPLATE_TEXT_PARAM_MAX}
            rows={4}
          />
          <p className="text-xs text-mid">O paciente recebe a lista por WhatsApp.</p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSend} disabled={sending || !documents.trim()}>
            {sending && <Loader2Icon className="size-4 animate-spin" />}
            Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
