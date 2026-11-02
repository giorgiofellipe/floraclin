'use client'

import { useState, useCallback } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { PatientHeader } from './patient-header'
import { PatientSectionNav } from './patient-section-nav'
import { resolveSection, type PatientSectionKey } from './patient-sections'
import { PatientSummary } from './patient-summary'
import { PatientAgendaSection } from './patient-agenda-section'
import { PatientDiagramsSection } from './patient-diagrams-section'
import { PatientDataTab } from './patient-data-tab'
import { PatientAnamnesisTab } from './patient-anamnesis-tab'
import { PatientProceduresTab } from './patient-procedures-tab'
import { PatientPhotosTab } from './patient-photos-tab'
import { PatientConsentTab } from './patient-consent-tab'
import { PatientFinancialTab } from './patient-financial-tab'
import { PatientTimelineTab } from './patient-timeline-tab'
import { PatientEvolutionsTab } from './patient-evolutions-tab'
import { PatientPackagesTab } from '@/components/packages/patient-packages-tab'
import { PatientDocumentsTab } from '@/components/clinical-documents/patient-documents-tab'
import { IssueDocumentDialog } from '@/components/clinical-documents/issue-document-dialog'
import { RequestDocumentsDialog } from './request-documents-dialog'
import { PaymentForm } from '@/components/financial/payment-form'
import { AppointmentForm } from '@/components/scheduling/appointment-form'
import { usePractitioners, useAppointmentProcedureTypes } from '@/hooks/queries/use-appointments'
import type { Patient } from '@/db/queries/patients'
import type { Role } from '@/types'

interface PatientDetailContentProps {
  patient: Patient
  activeTab?: string
  hasActiveService?: boolean
  whatsappApiEnabled?: boolean
  role: Role
}

export function PatientDetailContent({
  patient,
  activeTab,
  hasActiveService = false,
  whatsappApiEnabled,
  role,
}: PatientDetailContentProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [showAppointmentForm, setShowAppointmentForm] = useState(false)
  const [showIssueDocument, setShowIssueDocument] = useState(false)
  const [showRequestDocuments, setShowRequestDocuments] = useState(false)
  const { data: practitioners = [] } = usePractitioners()
  const { data: procedureTypes = [] } = useAppointmentProcedureTypes()

  const [section, setSectionState] = useState<PatientSectionKey>(() =>
    resolveSection(activeTab, role),
  )

  const setSection = useCallback(
    (next: PatientSectionKey) => {
      setSectionState(next)
      const params = new URLSearchParams(searchParams.toString())
      if (next === 'resumo') {
        params.delete('tab')
      } else {
        params.set('tab', next)
      }
      const qs = params.toString()
      router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false })
    },
    [router, pathname, searchParams],
  )

  const patientRef = {
    id: patient.id,
    fullName: patient.fullName,
    cpf: patient.cpf,
    birthDate: patient.birthDate,
    phone: patient.phone,
  }

  return (
    <div className="space-y-5 pb-20 md:pb-0">
      <PatientHeader
        patient={patient}
        role={role}
        hasActiveService={hasActiveService}
        whatsappApiEnabled={whatsappApiEnabled}
        onNewAppointment={() => setShowAppointmentForm(true)}
        onNewCharge={() => setShowPaymentForm(true)}
        onNewDocument={() => setShowIssueDocument(true)}
        onRequestDocuments={() => setShowRequestDocuments(true)}
      />

      <div className="space-y-5 md:grid md:grid-cols-[200px_1fr] md:items-start md:gap-5 md:space-y-0">
        <PatientSectionNav active={section} role={role} onChange={setSection} />

        <div className="min-h-[400px] min-w-0 rounded-[3px] bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] md:p-6">
          {section === 'resumo' && (
            <PatientSummary patientId={patient.id} role={role} onNavigate={setSection} />
          )}
          {section === 'atendimentos' && <PatientProceduresTab patientId={patient.id} />}
          {section === 'diagramas' && <PatientDiagramsSection patientId={patient.id} role={role} />}
          {section === 'evolucoes' && (
            <PatientEvolutionsTab
              patientId={patient.id}
              canEdit={role === 'owner' || role === 'practitioner'}
            />
          )}
          {section === 'fotos' && <PatientPhotosTab patientId={patient.id} />}
          {section === 'anamnese' && (
            <PatientAnamnesisTab
              patientId={patient.id}
              patientName={patient.fullName}
              patientPhone={patient.phone}
              whatsappApiEnabled={whatsappApiEnabled}
            />
          )}
          {section === 'agenda' && <PatientAgendaSection patientId={patient.id} />}
          {section === 'financeiro' && (
            <PatientFinancialTab patientId={patient.id} patientName={patient.fullName} />
          )}
          {section === 'pacotes' && (
            <PatientPackagesTab patientId={patient.id} patientName={patient.fullName} />
          )}
          {section === 'termos' && (
            <PatientConsentTab
              patientId={patient.id}
              patientName={patient.fullName}
              patientCpf={patient.cpf}
              patientPhone={patient.phone}
              whatsappApiEnabled={whatsappApiEnabled}
            />
          )}
          {section === 'documentos' && <PatientDocumentsTab patient={patientRef} />}
          {section === 'dados' && <PatientDataTab patient={patient} />}
          {section === 'historico' && <PatientTimelineTab patientId={patient.id} />}
        </div>
      </div>

      <PaymentForm
        open={showPaymentForm}
        onClose={() => setShowPaymentForm(false)}
        defaultPatient={patient}
        onSuccess={() => {
          setShowPaymentForm(false)
          setSection('financeiro')
        }}
      />

      <AppointmentForm
        open={showAppointmentForm}
        onOpenChange={setShowAppointmentForm}
        practitioners={practitioners}
        procedureTypes={procedureTypes}
        defaultPatient={patient}
        onSaved={() => setShowAppointmentForm(false)}
      />

      <RequestDocumentsDialog
        patientId={patient.id}
        patientName={patient.fullName}
        open={showRequestDocuments}
        onOpenChange={setShowRequestDocuments}
      />

      <IssueDocumentDialog
        open={showIssueDocument}
        onOpenChange={setShowIssueDocument}
        patient={patientRef}
      />
    </div>
  )
}
