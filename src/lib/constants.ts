export const DEFAULT_PAGE_SIZE = 20

export const APPOINTMENT_STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-800',
  confirmed: 'bg-green-100 text-green-800',
  in_progress: 'bg-yellow-100 text-yellow-800',
  completed: 'bg-gray-100 text-gray-800',
  cancelled: 'bg-red-100 text-red-800',
  no_show: 'bg-orange-100 text-orange-800',
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
