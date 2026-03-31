'use client'

import { Button } from '@/components/ui/button'
import { useLedgerExportUrl } from '@/hooks/queries/use-ledger'
import { DownloadIcon } from 'lucide-react'

interface LedgerExportProps {
  filters: {
    type?: string
    dateFrom: string
    dateTo: string
    paymentMethod?: string
    patientId?: string
    categoryId?: string
  }
}

export function LedgerExport({ filters }: LedgerExportProps) {
  const exportUrl = useLedgerExportUrl(filters)

  return (
    <a href={exportUrl} download target="_blank" rel="noopener noreferrer">
      <Button
        variant="outline"
        size="sm"
        className="border-sage/30 text-charcoal hover:bg-[#F0F7F1] transition-colors"
      >
        <DownloadIcon data-icon="inline-start" />
        Exportar CSV
      </Button>
    </a>
  )
}
