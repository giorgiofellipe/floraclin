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
import {
  useClinicalDocument,
  usePatientDocuments,
  type PatientDocumentRow,
} from '@/hooks/queries/use-clinical-documents'
import { formatDateTime } from '@/lib/utils'
import { IssueDocumentDialog } from './issue-document-dialog'
import { DeliveryActions } from './delivery-actions'
import { DocumentPreview } from './document-preview'

const KIND_LABEL: Record<string, string> = {
  receita: 'Receita',
  atestado: 'Atestado',
}

/**
 * Two-state delivery badge. Print and download aren't real "delivered to
 * patient" events (the user might preview without sending), so the only
 * meaningful signal is whether the document was sent via WhatsApp.
 */
function deliveryBadge(d: PatientDocumentRow): { label: string; className: string } {
  if (d.whatsappMessageId) {
    return {
      label: 'Enviado por WhatsApp',
      className: 'bg-[#F0F7F1] text-sage border-sage/20',
    }
  }
  return {
    label: 'Não enviado',
    className: 'bg-[#F4F6F8] text-mid border-[#E8ECEF]',
  }
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
            const badge = deliveryBadge(d)
            const kindLabel = KIND_LABEL[d.kind] ?? d.kind
            return (
              <li
                key={d.id}
                className="rounded-[3px] border border-[#E8ECEF] bg-white p-3 transition-colors hover:border-sage/30 hover:bg-petal/20"
              >
                <button
                  type="button"
                  onClick={() => setOpenedDoc(d)}
                  className="flex w-full cursor-pointer items-start justify-between gap-3 text-left"
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
        <DialogContent className="max-h-[90vh] w-[95vw] sm:max-w-6xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{openedDoc?.title}</DialogTitle>
            <DialogDescription>
              {openedDoc &&
                `${KIND_LABEL[openedDoc.kind] ?? openedDoc.kind} · ${openedDoc.practitionerName} · ${formatDateTime(openedDoc.issuedAt)}`}
            </DialogDescription>
          </DialogHeader>
          {openedDoc && (
            <HistoryPreview
              documentId={openedDoc.id}
              fallback={openedDoc}
              patientHasPhone={Boolean(patient.phone)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

interface HistoryPreviewProps {
  documentId: string
  fallback: PatientDocumentRow
  patientHasPhone: boolean
}

/**
 * Loads the full document (body + patient + tenant context + signature snapshot)
 * and renders the same `<DocumentPreview>` used in the issuance wizard. The
 * snapshot from the row at issue time is the source of truth — we never re-fetch
 * the practitioner's current signature here.
 */
function HistoryPreview({ documentId, fallback, patientHasPhone }: HistoryPreviewProps) {
  const { data: doc, isLoading, error } = useClinicalDocument(documentId)

  if (isLoading) {
    return (
      <div className="space-y-3 py-2">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-10 w-1/2" />
      </div>
    )
  }

  if (error || !doc) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-mid">
          Não foi possível carregar o conteúdo completo. Use as ações abaixo
          para reabrir, baixar ou reenviar.
        </p>
        <DeliveryActions
          documentId={documentId}
          patientId={fallback.id}
          patientHasPhone={patientHasPhone}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <DocumentPreview
        kind={doc.kind}
        title={doc.title}
        body={doc.body}
        verificationCode={doc.verificationCode}
        patient={{
          fullName: doc.patient.fullName,
          cpf: doc.patient.cpf,
          birthDate: doc.patient.birthDate,
        }}
        practitioner={{
          displayName: doc.professionalSnapshot.name,
          registryLine: doc.professionalSnapshot.registryLine,
          signatureDataUrl: doc.professionalSnapshot.signatureDataUrl,
        }}
        tenant={{
          name: doc.tenant.name,
          phone: doc.tenant.phone,
          email: doc.tenant.email,
          logoUrl: doc.tenant.logoUrl,
          address: (doc.tenant.address as DocumentPreviewTenantAddress) ?? null,
        }}
        date={new Date(doc.issuedAt)}
      />
      <DeliveryActions
        documentId={doc.id}
        patientId={doc.patientId}
        patientHasPhone={patientHasPhone}
      />
    </div>
  )
}

type DocumentPreviewTenantAddress = {
  street?: string
  number?: string
  complement?: string
  neighborhood?: string
  city?: string
  state?: string
  zip?: string
} | null
