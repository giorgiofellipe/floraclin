'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { Role } from '@/types'
import {
  MOBILE_NAV_ENTRIES,
  PATIENT_SECTION_GROUPS,
  visibleSections,
  type PatientSectionKey,
} from './patient-sections'

interface PatientSectionNavProps {
  active: PatientSectionKey
  role: Role
  onChange: (key: PatientSectionKey) => void
}

type MobileEntry = (typeof MOBILE_NAV_ENTRIES)[number]

export function PatientSectionNav({ active, role, onChange }: PatientSectionNavProps) {
  const sections = visibleSections(role)
  const [openEntry, setOpenEntry] = useState<MobileEntry | null>(null)

  const itemClass = (isActive: boolean) =>
    cn(
      'flex w-full cursor-pointer items-center gap-2.5 rounded-[3px] px-3 py-2 text-left text-[13px] font-medium transition-colors',
      isActive ? 'bg-sage/10 text-forest' : 'text-mid hover:bg-cream hover:text-charcoal',
    )

  const renderItem = (section: (typeof sections)[number], onSelect: () => void) => {
    const Icon = section.icon
    const isActive = active === section.key
    return (
      <button
        key={section.key}
        type="button"
        onClick={onSelect}
        data-testid={`patient-section-${section.key}`}
        aria-current={isActive ? 'page' : undefined}
        className={itemClass(isActive)}
      >
        <Icon className={cn('size-4', isActive ? 'text-sage' : 'text-mid/60')} />
        {section.label}
      </button>
    )
  }

  const activeEntry = MOBILE_NAV_ENTRIES.find((e) =>
    e.key === 'resumo'
      ? active === 'resumo'
      : sections.some((s) => s.key === active && s.group && e.groups.includes(s.group)),
  )

  return (
    <>
      <nav
        aria-label="Seções do paciente"
        className="hidden md:block w-full self-start rounded-[3px] bg-white p-2 shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
      >
        {sections
          .filter((s) => s.group === null)
          .map((s) => renderItem(s, () => onChange(s.key)))}
        {PATIENT_SECTION_GROUPS.map((group) => (
          <div key={group.key} className="mt-3">
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-mid/70">
              {group.label}
            </p>
            {sections
              .filter((s) => s.group === group.key)
              .map((s) => renderItem(s, () => onChange(s.key)))}
          </div>
        ))}
      </nav>

      <nav
        aria-label="Seções do paciente"
        className="md:hidden fixed bottom-0 inset-x-0 z-40 flex border-t bg-white pb-[env(safe-area-inset-bottom)]"
      >
        {MOBILE_NAV_ENTRIES.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => (entry.key === 'resumo' ? onChange('resumo') : setOpenEntry(entry))}
            aria-current={activeEntry?.key === entry.key ? 'page' : undefined}
            aria-haspopup={entry.key === 'resumo' ? undefined : 'dialog'}
            aria-expanded={entry.key === 'resumo' ? undefined : openEntry?.key === entry.key}
            className={cn(
              'flex-1 cursor-pointer py-3 text-xs font-medium',
              activeEntry?.key === entry.key ? 'text-forest' : 'text-mid',
            )}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      <Sheet open={openEntry !== null} onOpenChange={(open) => !open && setOpenEntry(null)}>
        <SheetContent side="bottom" className="md:hidden p-4">
          <SheetHeader className="p-0">
            <SheetTitle>{openEntry?.label}</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col">
            {openEntry &&
              sections
                .filter((s) => s.group && openEntry.groups.includes(s.group))
                .map((s) =>
                  renderItem(s, () => {
                    onChange(s.key)
                    setOpenEntry(null)
                  }),
                )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
