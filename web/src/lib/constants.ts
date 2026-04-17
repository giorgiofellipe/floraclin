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
  'enzima',
  'limpeza_pele',
  'outros',
] as const

export const PROCEDURE_CATEGORY_LABELS: Record<string, string> = {
  botox: 'Toxina Botulínica',
  filler: 'Preenchimento',
  biostimulator: 'Bioestimulador',
  peel: 'Peeling',
  skinbooster: 'Skinbooster',
  laser: 'Laser',
  microagulhamento: 'Microagulhamento',
  enzima: 'Enzima Lipolítica',
  limpeza_pele: 'Limpeza de Pele',
  outros: 'Outros',
}

export const FITZPATRICK_TYPES = ['I', 'II', 'III', 'IV', 'V', 'VI'] as const

export const DEFAULT_PROCEDURE_TYPES = [
  { name: 'Toxina Botulínica', category: 'botox', estimatedDurationMin: 30 },
  { name: 'Ácido Hialurônico', category: 'filler', estimatedDurationMin: 60 },
  { name: 'Bioestimulador de Colágeno', category: 'biostimulator', estimatedDurationMin: 60 },
  { name: 'Peeling Químico', category: 'peel', estimatedDurationMin: 45 },
  { name: 'Skinbooster', category: 'skinbooster', estimatedDurationMin: 45 },
  { name: 'Microagulhamento', category: 'microagulhamento', estimatedDurationMin: 60 },
  { name: 'Lipo de Papada', category: 'enzima', estimatedDurationMin: 45 },
  { name: 'Limpeza de Pele Profissional', category: 'limpeza_pele', estimatedDurationMin: 60 },
]

export const DEFAULT_PRODUCTS = [
  // Toxinas botulínicas
  { name: 'Botox Allergan 100U', category: 'botox', activeIngredient: 'Toxina botulínica tipo A', defaultUnit: 'U', origin: 'importado' },
  { name: 'Dysport 300U', category: 'botox', activeIngredient: 'Toxina botulínica tipo A', defaultUnit: 'U', origin: 'importado' },
  { name: 'Botulift 100U', category: 'botox', activeIngredient: 'Toxina botulínica tipo A', defaultUnit: 'U', origin: 'nacional' },
  { name: 'Xeomin 100U', category: 'botox', activeIngredient: 'Toxina botulínica tipo A', defaultUnit: 'U', origin: 'importado' },
  // Preenchedores
  { name: 'Juvederm Ultra XC', category: 'filler', activeIngredient: 'Ácido hialurônico', defaultUnit: 'mL', origin: 'importado' },
  { name: 'Juvederm Voluma XC', category: 'filler', activeIngredient: 'Ácido hialurônico', defaultUnit: 'mL', origin: 'importado' },
  { name: 'Restylane Lyft', category: 'filler', activeIngredient: 'Ácido hialurônico', defaultUnit: 'mL', origin: 'importado' },
  { name: 'Biogelis', category: 'filler', activeIngredient: 'Ácido hialurônico', defaultUnit: 'mL', origin: 'nacional' },
  // Bioestimuladores
  { name: 'Sculptra', category: 'biostimulator', activeIngredient: 'Ácido poli-L-láctico', defaultUnit: 'mL', origin: 'importado' },
  { name: 'Rennova Elleva', category: 'biostimulator', activeIngredient: 'Ácido poli-L-láctico', defaultUnit: 'mL', origin: 'nacional' },
  { name: 'Radiesse', category: 'biostimulator', activeIngredient: 'Hidroxiapatita de cálcio', defaultUnit: 'mL', origin: 'importado' },
  { name: 'Ellansé', category: 'biostimulator', activeIngredient: 'Policaprolactona', defaultUnit: 'mL', origin: 'importado' },
  // Skinboosters
  { name: 'Restylane Skinbooster Vital', category: 'skinbooster', activeIngredient: 'Ácido hialurônico', defaultUnit: 'mL', origin: 'importado' },
  { name: 'Profhilo', category: 'skinbooster', activeIngredient: 'Ácido hialurônico híbrido', defaultUnit: 'mL', origin: 'importado' },
  { name: 'Skinvive', category: 'skinbooster', activeIngredient: 'Ácido hialurônico', defaultUnit: 'mL', origin: 'importado' },
] as const

export type DefaultProductOrigin = 'nacional' | 'importado'

export const CONSENT_TYPE_LABELS: Record<string, string> = {
  general: 'Consentimento Geral',
  botox: 'Toxina Botulínica',
  filler: 'Preenchedor / Ácido Hialurônico',
  biostimulator: 'Bioestimulador',
  limpeza_pele: 'Limpeza de Pele',
  enzima: 'Enzima Lipolítica',
  skinbooster: 'Skinbooster',
  microagulhamento: 'Microagulhamento',
  custom: 'Personalizado',
  service_contract: 'Contrato de Serviço',
}

export const PROCEDURE_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-[#F4F6F8] text-[#7A7A7A]',
  planned: 'bg-[#FFF4EF] text-[#D4845A]',
  approved: 'bg-[#F0F7F1] text-[#4A6B52]',
  executed: 'bg-[#F0F7F1] text-[#2A2A2A]',
  cancelled: 'bg-[#F4F6F8] text-[#7A7A7A]',
}

export const PROCEDURE_STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  planned: 'Planejado',
  approved: 'Aprovado',
  executed: 'Executado',
  cancelled: 'Cancelado',
}

export const DEFAULT_WORKING_HOURS = {
  mon: { start: '08:00', end: '18:00', enabled: true },
  tue: { start: '08:00', end: '18:00', enabled: true },
  wed: { start: '08:00', end: '18:00', enabled: true },
  thu: { start: '08:00', end: '18:00', enabled: true },
  fri: { start: '08:00', end: '18:00', enabled: true },
  sat: { start: '08:00', end: '12:00', enabled: false },
  sun: { start: '08:00', end: '12:00', enabled: false },
}
