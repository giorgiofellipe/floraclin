'use client'

import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FileText, Plus } from 'lucide-react'
import { usePatientDocuments, type PatientDocumentRow } from '@/hooks/queries/use-clinical-documents'
import { formatDateTime } from '@/lib/utils'
import { IssueDocumentDialog } from './issue-document-dialog'
import { DeliveryActions } from './delivery-actions'

const KIND_LABEL: Record<string, string> = {
  receita: 'Receita',
  atestado: 'Atestado',
}

const DELIVERY_BADGE: Record<string, { label: string; className: string }> = {
  download: {
    label: 'Baixado',
    className: 'bg-[#F4F6F8] text-mid border-[#E8ECEF]',
  },
  print: {
    label: 'Impresso',
    className: 'bg-[#F4F6F8] text-mid border-[#E8ECEF]',
  },
  whatsapp: {
    label: 'WhatsApp',
    className: 'bg-[#F0F7F1] text-sage border-sage/20',
  },
  multiple: {
    label: 'Múltiplos canais',
    className: 'bg-blush/40 text-charcoal border-blush',
  },
}

interface PatientDocumentsTabProps {
  patient: {
    id: string
    fullName: string
    cpf: string | null
    birthDate: string | null
    phone: string | null
  }
}

export function PatientDocumentsTab({ patient }: PatientDocumentsTabProps) {
  const { data: docs, isLoading } = usePatientDocuments(patient.id)
  const [issueOpen, setIssueOpen] = React.useState(false)
  const [openedDoc, setOpenedDoc] = React.useState<PatientDocumentRow | null>(null)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium uppercase tracking-wider text-mid">
          Documentos clínicos
        </h3>
        <Button onClick={() => setIssueOpen(true)} size="sm">
          <Plus className="size-3.5" />
          Novo documento
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : !docs || docs.length === 0 ? (
        <div className="rounded-[3px] border border-dashed border-[#E8ECEF] p-8 text-center">
          <FileText className="mx-auto mb-2 size-8 text-mid/40" />
          <p className="text-sm text-mid">
            Nenhum documento emitido para este paciente ainda.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {docs.map((d) => {
            const badge = DELIVERY_BADGE[d.deliveredVia] ?? {
              label: d.deliveredVia,
              className: 'bg-[#F4F6F8] text-mid border-[#E8ECEF]',
            }
            const kindLabel = KIND_LABEL[d.kind] ?? d.kind
            return (
              <li
                key={d.id}
                className="rounded-[3px] border border-[#E8ECEF] bg-white p-3"
              >
                <button
                  type="button"
                  onClick={() => setOpenedDoc(d)}
                  className="flex w-full items-start justify-between gap-3 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        {kindLabel}
                      </Badge>
                      <span className="truncate font-medium text-charcoal">
                        {d.title}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-mid">
                      Emitido por {d.practitionerName} em {formatDateTime(d.issuedAt)}
                    </div>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <IssueDocumentDialog
        open={issueOpen}
        onOpenChange={setIssueOpen}
        patient={patient}
      />

      <Dialog open={!!openedDoc} onOpenChange={(o) => !o && setOpenedDoc(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{openedDoc?.title}</DialogTitle>
            <DialogDescription>
              {openedDoc &&
                `${KIND_LABEL[openedDoc.kind] ?? openedDoc.kind} · ${openedDoc.practitionerName} · ${formatDateTime(openedDoc.issuedAt)}`}
            </DialogDescription>
          </DialogHeader>
          {openedDoc && (
            <div className="space-y-4">
              <p className="text-sm text-mid">
                Use as ações abaixo para reabrir, baixar ou reenviar este documento.
                O conteúdo completo está disponível na visualização de impressão.
              </p>
              <DeliveryActions
                documentId={openedDoc.id}
                patientId={patient.id}
                patientHasPhone={Boolean(patient.phone)}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
