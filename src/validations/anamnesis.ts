import { z } from 'zod'

// ─── Sub-schemas for JSONB fields ───────────────────────────────────

export const medicationSchema = z.object({
  name: z.string().min(1, 'Nome do medicamento é obrigatório'),
  dosage: z.string().default(''),
  frequency: z.string().default(''),
  reason: z.string().default(''),
})

export const allergySchema = z.object({
  substance: z.string().min(1, 'Substância é obrigatória'),
  reaction: z.string().default(''),
  severity: z.enum(['leve', 'moderada', 'grave']).optional(),
})

export const surgerySchema = z.object({
  procedure: z.string().min(1, 'Procedimento é obrigatório'),
  year: z.string().default(''),
  notes: z.string().default(''),
})

export const skincareItemSchema = z.object({
  product: z.string().min(1, 'Produto é obrigatório'),
  frequency: z.string().default(''),
  notes: z.string().default(''),
})

export const previousTreatmentSchema = z.object({
  procedure: z.string().min(1, 'Procedimento é obrigatório'),
  date: z.string().default(''),
  professional: z.string().default(''),
  notes: z.string().default(''),
  satisfaction: z.enum(['muito_insatisfeito', 'insatisfeito', 'neutro', 'satisfeito', 'muito_satisfeito']).optional(),
})

export const medicalHistorySchema = z.object({
  diabetes: z.boolean().default(false),
  hipertensao: z.boolean().default(false),
  autoimune: z.boolean().default(false),
  cardiovascular: z.boolean().default(false),
  hepatite: z.boolean().default(false),
  hiv: z.boolean().default(false),
  cancer: z.boolean().default(false),
  epilepsia: z.boolean().default(false),
  disturbioCoagulacao: z.boolean().default(false),
  queloides: z.boolean().default(false),
  herpes: z.boolean().default(false),
  outros: z.string().default(''),
})

export const lifestyleSchema = z.object({
  smoking: z.enum(['nao', 'ex_fumante', 'sim_ocasional', 'sim_diario']).optional(),
  alcohol: z.enum(['nao', 'ocasional', 'moderado', 'frequente']).optional(),
  exercise: z.enum(['sedentario', 'leve', 'moderado', 'intenso']).optional(),
  sleep: z.enum(['ruim', 'regular', 'bom', 'excelente']).optional(),
  diet: z.enum(['desequilibrada', 'regular', 'equilibrada', 'restritiva']).optional(),
  sunExposure: z.enum(['minima', 'moderada', 'alta', 'muito_alta']).optional(),
})

// ─── Main anamnesis schema ──────────────────────────────────────────

export const anamnesisSchema = z.object({
  mainComplaint: z.string().default(''),
  patientGoals: z.string().default(''),
  medicalHistory: medicalHistorySchema.default({
    diabetes: false,
    hipertensao: false,
    autoimune: false,
    cardiovascular: false,
    hepatite: false,
    hiv: false,
    cancer: false,
    epilepsia: false,
    disturbioCoagulacao: false,
    queloides: false,
    herpes: false,
    outros: '',
  }),
  medications: z.array(medicationSchema).default([]),
  allergies: z.array(allergySchema).default([]),
  previousSurgeries: z.array(surgerySchema).default([]),
  chronicConditions: z.array(z.string()).default([]),
  isPregnant: z.boolean().default(false),
  isBreastfeeding: z.boolean().default(false),
  lifestyle: lifestyleSchema.default({}),
  skinType: z.enum(['I', 'II', 'III', 'IV', 'V', 'VI']).optional(),
  skinConditions: z.array(z.string()).default([]),
  skincareRoutine: z.array(skincareItemSchema).default([]),
  previousAestheticTreatments: z.array(previousTreatmentSchema).default([]),
  contraindications: z.array(z.string()).default([]),
  facialEvaluationNotes: z.string().default(''),
})

export type AnamnesisFormData = z.infer<typeof anamnesisSchema>
export type AnamnesisFormInput = z.input<typeof anamnesisSchema>
export type Medication = z.infer<typeof medicationSchema>
export type Allergy = z.infer<typeof allergySchema>
export type Surgery = z.infer<typeof surgerySchema>
export type SkincareItem = z.infer<typeof skincareItemSchema>
export type PreviousTreatment = z.infer<typeof previousTreatmentSchema>
export type MedicalHistory = z.infer<typeof medicalHistorySchema>
export type Lifestyle = z.infer<typeof lifestyleSchema>
