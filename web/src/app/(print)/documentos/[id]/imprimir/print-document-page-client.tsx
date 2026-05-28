'use client'

import * as React from 'react'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Printer } from 'lucide-react'
import { PrintStylesheet } from '@/components/print/print-stylesheet'
import { PrintDocument } from '@/components/clinical-documents/print-document'
import type { ClinicalDocumentWithContext } from '@/db/queries/clinical-documents'

interface PrintDocumentPageClientProps {
  doc: ClinicalDocumentWithContext
}

export function PrintDocumentPageClient({ doc }: PrintDocumentPageClientProps) {
  useEffect(() => {
    // Auto-open the print dialog after the page settles, unless the user
    // navigated here just to preview (we can't tell — opt-in via query param).
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('auto') !== 'false') {
      const timer = window.setTimeout(() => window.print(), 400)
      return () => window.clearTimeout(timer)
    }
  }, [])

  return (
    <>
      <PrintStylesheet />
      <div className="bg-[#F4F6F8] py-6">
        <div className="no-print mx-auto mb-4 flex max-w-[820px] items-center justify-between px-4">
          <h1 className="text-sm font-medium uppercase tracking-wider text-mid">
            Pré-visualização
          </h1>
          <Button onClick={() => window.print()} size="sm">
            <Printer className="size-3.5" />
            Imprimir
          </Button>
        </div>
        <PrintDocument doc={doc} />
      </div>
    </>
  )
}
