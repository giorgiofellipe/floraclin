'use client'

import { cn } from '@/lib/utils'
import type { Role } from '@/types'
import {
  PATIENT_SECTION_GROUPS,
  visibleSections,
  type PatientSectionKey,
} from './patient-sections'

interface PatientSectionNavProps {
  active: PatientSectionKey
  role: Role
  onChange: (key: PatientSectionKey) => void
}

export function PatientSectionNav({ active, role, onChange }: PatientSectionNavProps) {
  const sections = visibleSections(role)

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

  return (
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
  )
}
