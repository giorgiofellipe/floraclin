'use client'
import * as React from 'react'

export function PrintStylesheet() {
  return (
    <style jsx global>{`
      @media print {
        body { background: white; }
        @page { size: A4; margin: 20mm; }
        nav, aside, .no-print { display: none !important; }
      }
      .print-document { font-family: 'Times New Roman', Times, serif; line-height: 1.6; }
    `}</style>
  )
}
