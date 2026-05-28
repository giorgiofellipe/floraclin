'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Download, MessageCircle, Printer, Loader2 } from 'lucide-react'
import { useSendDocumentWhatsapp } from '@/hooks/queries/use-clinical-documents'

export interface DeliveryActionsProps {
  documentId: string
  patientId?: string
  patientHasPhone?: boolean
  className?: string
}

/**
 * Three delivery actions surfaced after a clinical document is issued:
 *  - Imprimir: opens the authenticated print page in a new tab
 *  - Baixar PDF: streams the server-rendered PDF
 *  - Enviar via WhatsApp: confirm dialog → POST /send-whatsapp
 *
 * The print URL is `/documentos/[id]/imprimir` (under the (platform) group,
 * NOT a public /c/ route — PHI is never reachable via UUID alone).
 */
export function DeliveryActions({
  documentId,
  patientId,
  patientHasPhone = true,
  className,
}: DeliveryActionsProps) {
  const sendWhatsapp = useSendDocumentWhatsapp()
  const [confirmOpen, setConfirmOpen] = React.useState(false)

  const printUrl = `/documentos/${documentId}/imprimir`
  const pdfUrl = `/api/clinical-documents/${documentId}/pdf`

  function handlePrint() {
    window.open(printUrl, '_blank', 'noopener')
  }

  function handleDownload() {
    // Force a same-tab navigation to the PDF route; the browser will treat the
    // application/pdf response as a download/inline view depending on user prefs.
    const a = document.createElement('a')
    a.href = pdfUrl
    a.target = '_blank'
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  async function handleSendWhatsapp() {
    setConfirmOpen(false)
    try {
      await sendWhatsapp.mutateAsync({ id: documentId, patientId })
      toast.success('Documento enviado via WhatsApp')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao enviar via WhatsApp')
    }
  }

  return (
    <>
      <div className={`flex flex-wrap items-center gap-2 ${className ?? ''}`}>
        <Button type="button" variant="outline" size="sm" onClick={handlePrint}>
          <Printer className="size-3.5" />
          Imprimir
        </Button>

        <Button type="button" variant="outline" size="sm" onClick={handleDownload}>
          <Download className="size-3.5" />
          Baixar PDF
        </Button>

        <Button
          type="button"
          size="sm"
          onClick={() => setConfirmOpen(true)}
          disabled={sendWhatsapp.isPending || !patientHasPhone}
          title={!patientHasPhone ? 'Paciente sem telefone cadastrado' : undefined}
        >
          {sendWhatsapp.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <MessageCircle className="size-3.5" />
          )}
          Enviar WhatsApp
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enviar documento via WhatsApp</DialogTitle>
            <DialogDescription>
              O documento será enviado como PDF ao paciente. Esta ação é registrada
              no histórico.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
            <Button onClick={handleSendWhatsapp} disabled={sendWhatsapp.isPending}>
              {sendWhatsapp.isPending ? 'Enviando...' : 'Confirmar envio'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
