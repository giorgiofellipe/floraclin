'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ClinicHeader, type ClinicHeaderProps } from '@/components/print/clinic-header'
import { PrintStylesheet } from '@/components/print/print-stylesheet'
import {
  PrintProcedureContent,
  type PrintProcedureContentProps,
} from '@/components/procedures/print-procedure-content'

export interface PrintProcedurePageClientProps {
  tenant: ClinicHeaderProps['tenant']
  procedure: PrintProcedureContentProps['procedure']
  patient: PrintProcedureContentProps['patient']
  applications: PrintProcedureContentProps['applications']
  signature: PrintProcedureContentProps['signature']
}

export function PrintProcedurePageClient({
  tenant,
  procedure,
  patient,
  applications,
  signature,
}: PrintProcedurePageClientProps) {
  const router = useRouter()

  return (
    <>
      <PrintStylesheet />
      <div className="mx-auto max-w-3xl p-6">
        {/* Toolbar — hidden in print */}
        <div className="no-print mb-6 flex items-center justify-between">
          <button
            onClick={() => router.back()}
            className="inline-flex items-center gap-1.5 text-[13px] text-mid hover:text-forest transition-colors"
          >
            <ArrowLeft className="size-3.5" />
            Voltar
          </button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.print()}
            className="text-mid hover:text-charcoal text-[12px] h-8"
          >
            <Printer className="size-3.5 mr-1.5" />
            Imprimir
          </Button>
        </div>

        <div className="print-document rounded-md bg-white p-8 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <ClinicHeader tenant={tenant} />
          <PrintProcedureContent
            procedure={procedure}
            patient={patient}
            applications={applications}
            signature={signature}
          />
        </div>
      </div>
    </>
  )
}
