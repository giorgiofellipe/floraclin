'use client'

import type * as React from 'react'
import { XCircleIcon } from 'lucide-react'
import type { CalendarBlockRow } from '@/db/queries/calendar'
import { toHhMm } from '@/lib/time-options'

interface CalendarBlockMenuProps {
  block: CalendarBlockRow
  position: { x: number; y: number }
  canDelete: boolean
  onDelete: () => void
  menuRef: React.RefObject<HTMLDivElement | null>
}

// Keeps the menu inside the viewport; width follows min-w-[200px] plus shadow.
const MENU_WIDTH_PX = 220
const MENU_HEIGHT_PX = 100

export function CalendarBlockMenu({ block, position, canDelete, onDelete, menuRef }: CalendarBlockMenuProps) {
  const isManual = block.source === 'manual'
  const heading = isManual && block.title ? block.title : 'Indisponível'
  const range = block.allDay
    ? 'Dia inteiro'
    : `${toHhMm(block.startTime ?? '')} - ${toHhMm(block.endTime ?? '')}`

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[200px] rounded-lg border border-topbar-border bg-white py-1 shadow-lg"
      style={{
        left: Math.min(position.x, window.innerWidth - MENU_WIDTH_PX),
        top: Math.min(position.y, window.innerHeight - MENU_HEIGHT_PX),
      }}
    >
      <div className="px-3 py-1.5 border-b border-topbar-border">
        <p className="text-xs font-medium text-charcoal break-words">{heading}</p>
        <p className="text-[11px] text-mid">
          {range}
          {' · '}
          {block.practitionerName ?? 'Toda a clínica'}
        </p>
      </div>
      {!isManual && <p className="px-3 py-2 text-xs text-mid">Sincronizado do Google Agenda</p>}
      {isManual && canDelete && (
        <button
          type="button"
          className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
          onClick={onDelete}
        >
          <XCircleIcon className="h-3.5 w-3.5" />
          Remover bloqueio
        </button>
      )}
    </div>
  )
}
