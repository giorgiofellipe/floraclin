'use client'

import { ChevronRight } from 'lucide-react'
import type { Role } from '@/types'
import { PATIENT_SECTION_GROUPS, visibleSections, type PatientSectionKey } from './patient-sections'

interface PatientSectionListProps {
  role: Role
  onOpen: (key: PatientSectionKey) => void
}

export function PatientSectionList({ role, onOpen }: PatientSectionListProps) {
  const sections = visibleSections(role)

  return (
    <nav aria-label="Seções do paciente" data-testid="patient-section-list" className="space-y-5 md:hidden">
      {PATIENT_SECTION_GROUPS.map((group) => {
        const items = sections.filter((s) => s.group === group.key)
        if (items.length === 0) return null
        return (
          <section key={group.key}>
            <h2 className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wide text-mid/70">
              {group.label}
            </h2>
            <ul className="divide-y divide-[#E8ECEF] overflow-hidden rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
              {items.map((section) => {
                const Icon = section.icon
                return (
                  <li key={section.key}>
                    <button
                      type="button"
                      onClick={() => onOpen(section.key)}
                      className="flex min-h-11 w-full cursor-pointer items-center gap-3 px-4 py-3 text-left text-sm font-medium text-charcoal transition-colors active:bg-cream"
                    >
                      <Icon className="size-4 shrink-0 text-sage" />
                      <span className="flex-1">{section.label}</span>
                      <ChevronRight className="size-4 shrink-0 text-mid/60" />
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </nav>
  )
}
