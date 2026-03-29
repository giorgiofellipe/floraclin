export const DEFAULT_PAGE_SIZE = 20

export const APPOINTMENT_STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-[#FFF4EF] text-amber',
  confirmed: 'bg-[#F0F7F1] text-sage',
  in_progress: 'bg-[#FFF4EF] text-amber',
  completed: 'bg-[#F0F7F1] text-sage',
  cancelled: 'bg-red-100 text-red-800',
  no_show: 'bg-[#FFF4EF] text-amber-dark',
}

export const PROCEDURE_CATEGORIES = [
  'botox',
  'filler',
  'biostimulator',
  'peel',
  'skinbooster',
  'laser',
  'microagulhamento',
  'outros',
] as const

export const FITZPATRICK_TYPES = ['I', 'II', 'III', 'IV', 'V', 'VI'] as const

export const DEFAULT_PROCEDURE_TYPES = [
  { name: 'Toxina Botulínica', category: 'botox', estimatedDurationMin: 30 },
  { name: 'Ácido Hialurônico', category: 'filler', estimatedDurationMin: 60 },
  { name: 'Bioestimulador de Colágeno', category: 'biostimulator', estimatedDurationMin: 60 },
  { name: 'Peeling Químico', category: 'peel', estimatedDurationMin: 45 },
  { name: 'Skinbooster', category: 'skinbooster', estimatedDurationMin: 45 },
]

export const DEFAULT_WORKING_HOURS = {
  mon: { start: '08:00', end: '18:00', enabled: true },
  tue: { start: '08:00', end: '18:00', enabled: true },
  wed: { start: '08:00', end: '18:00', enabled: true },
  thu: { start: '08:00', end: '18:00', enabled: true },
  fri: { start: '08:00', end: '18:00', enabled: true },
  sat: { start: '08:00', end: '12:00', enabled: false },
  sun: { start: '08:00', end: '12:00', enabled: false },
}
