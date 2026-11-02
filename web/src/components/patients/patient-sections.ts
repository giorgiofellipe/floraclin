import {
  User,
  ClipboardList,
  Syringe,
  Camera,
  FileCheck,
  Banknote,
  Clock,
  Package,
  FileText,
  BookOpen,
  LayoutDashboard,
  CalendarDays,
  ScanFace,
  type LucideIcon,
} from 'lucide-react'
import type { Role } from '@/types'

export type PatientSectionKey =
  | 'resumo'
  | 'atendimentos'
  | 'diagramas'
  | 'evolucoes'
  | 'fotos'
  | 'anamnese'
  | 'agenda'
  | 'financeiro'
  | 'pacotes'
  | 'termos'
  | 'documentos'
  | 'dados'
  | 'historico'

export type PatientSectionGroup = 'clinico' | 'administrativo' | 'documentos' | 'paciente'

export const PATIENT_SECTION_GROUPS: { key: PatientSectionGroup; label: string }[] = [
  { key: 'clinico', label: 'Clínico' },
  { key: 'administrativo', label: 'Administrativo' },
  { key: 'documentos', label: 'Documentos' },
  { key: 'paciente', label: 'Paciente' },
]

export const PATIENT_SECTIONS: {
  key: PatientSectionKey
  label: string
  group: PatientSectionGroup | null
  icon: LucideIcon
  requiredRoles?: Role[]
}[] = [
  { key: 'resumo', label: 'Resumo', group: null, icon: LayoutDashboard },
  { key: 'atendimentos', label: 'Atendimentos', group: 'clinico', icon: Syringe },
  { key: 'diagramas', label: 'Diagramas faciais', group: 'clinico', icon: ScanFace },
  { key: 'evolucoes', label: 'Evoluções', group: 'clinico', icon: BookOpen, requiredRoles: ['owner', 'practitioner'] },
  { key: 'fotos', label: 'Fotos', group: 'clinico', icon: Camera },
  { key: 'anamnese', label: 'Anamnese', group: 'clinico', icon: ClipboardList },
  { key: 'agenda', label: 'Agenda', group: 'administrativo', icon: CalendarDays },
  { key: 'financeiro', label: 'Financeiro', group: 'administrativo', icon: Banknote },
  { key: 'pacotes', label: 'Pacotes', group: 'administrativo', icon: Package },
  { key: 'termos', label: 'Termos', group: 'documentos', icon: FileCheck },
  { key: 'documentos', label: 'Documentos', group: 'documentos', icon: FileText },
  { key: 'dados', label: 'Dados', group: 'paciente', icon: User },
  { key: 'historico', label: 'Histórico', group: 'paciente', icon: Clock },
]

export const MOBILE_NAV_ENTRIES: {
  key: 'resumo' | 'clinico' | 'administrativo' | 'outros'
  label: string
  groups: PatientSectionGroup[]
}[] = [
  { key: 'resumo', label: 'Resumo', groups: [] },
  { key: 'clinico', label: 'Clínico', groups: ['clinico'] },
  { key: 'administrativo', label: 'Administrativo', groups: ['administrativo'] },
  { key: 'outros', label: 'Outros', groups: ['documentos', 'paciente'] },
]

export function visibleSections(role: Role): typeof PATIENT_SECTIONS {
  return PATIENT_SECTIONS.filter((s) => !s.requiredRoles || s.requiredRoles.includes(role))
}

export function resolveSection(param: string | null | undefined, role: Role): PatientSectionKey {
  return visibleSections(role).find((s) => s.key === param)?.key ?? 'resumo'
}
