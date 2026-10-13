import { describe, expect, it } from 'vitest'
import { buildFormResponseSchema } from '@/lib/forms/response-schema'
import { convertLegacyAnamnesis, type LegacyAnamnesisRow } from '../convert-legacy'
import { DEFAULT_ANAMNESIS_TEMPLATE } from '../default-template'

const empty: LegacyAnamnesisRow = {
  main_complaint: null, patient_goals: null, medical_history: null, medications: null, allergies: null,
  previous_surgeries: null, chronic_conditions: null, is_pregnant: false, is_breastfeeding: false,
  lifestyle: null, skincare_routine: null, previous_aesthetic_treatments: null,
}

describe('convertLegacyAnamnesis', () => {
  it.each<[string, Partial<LegacyAnamnesisRow>, Record<string, unknown>]>([
    ['main complaint', { main_complaint: 'Rugas' }, { 'anam-main-complaint': 'Rugas' }],
    ['patient goals', { patient_goals: 'Rejuvenescer' }, { 'anam-patient-goals': 'Rejuvenescer' }],
    [
      'medical history keys to labels plus other',
      { medical_history: { diabetes: true, hipertensao: false, outros: 'Enxaqueca' } },
      { 'anam-medical-history': { selected: ['Diabetes'], other: 'Enxaqueca' } },
    ],
    [
      'medications',
      { medications: [{ name: 'Losartana', dosage: '50mg', frequency: 'Diária', reason: 'Pressão' }] },
      { 'anam-medications': [{ name: 'Losartana', dosage: '50mg', frequency: 'Diária', reason: 'Pressão' }] },
    ],
    [
      'allergy severity key to label',
      { allergies: [{ substance: 'Látex', reaction: 'Urticária', severity: 'grave' }] },
      { 'anam-allergies': [{ substance: 'Látex', reaction: 'Urticária', severity: 'Grave' }] },
    ],
    [
      'previous surgeries',
      { previous_surgeries: [{ procedure: 'Rinoplastia', year: '2019', notes: 'Sem intercorrências' }] },
      { 'anam-previous-surgeries': [{ procedure: 'Rinoplastia', year: '2019', notes: 'Sem intercorrências' }] },
    ],
    ['chronic conditions strings to rows', { chronic_conditions: ['Asma'] }, { 'anam-chronic-conditions': [{ condicao: 'Asma' }] }],
    [
      'skincare routine',
      { skincare_routine: [{ product: 'Protetor', frequency: 'Diária', notes: 'FPS 50' }] },
      { 'anam-skincare-routine': [{ product: 'Protetor', frequency: 'Diária', notes: 'FPS 50' }] },
    ],
    [
      'treatment satisfaction key to label',
      { previous_aesthetic_treatments: [{ procedure: 'Botox', satisfaction: 'muito_satisfeito' }] },
      { 'anam-previous-treatments': [{ procedure: 'Botox', satisfaction: 'Muito satisfeito' }] },
    ],
    ['pregnant true', { is_pregnant: true }, { 'anam-pregnant': 'Sim' }],
    ['breastfeeding true', { is_breastfeeding: true }, { 'anam-breastfeeding': 'Sim' }],
    ['smoking', { lifestyle: { smoking: 'sim_diario' } }, { 'anam-smoking': 'Sim, diário' }],
    ['alcohol', { lifestyle: { alcohol: 'ocasional' } }, { 'anam-alcohol': 'Ocasional' }],
    ['exercise', { lifestyle: { exercise: 'sedentario' } }, { 'anam-exercise': 'Sedentário' }],
    ['sleep', { lifestyle: { sleep: 'bom' } }, { 'anam-sleep': 'Bom' }],
    ['diet', { lifestyle: { diet: 'restritiva' } }, { 'anam-diet': 'Restritiva' }],
    ['sun exposure', { lifestyle: { sunExposure: 'muito_alta' } }, { 'anam-sun-exposure': 'Muito alta' }],
  ])('maps %s', (_name, patch, expected) => {
    expect(convertLegacyAnamnesis({ ...empty, ...patch })).toEqual(expected)
  })

  it('omits legacy defaults and blanks (false booleans never proved an answer of "no")', () => {
    const blank: LegacyAnamnesisRow = {
      ...empty,
      main_complaint: '  ',
      patient_goals: '',
      medical_history: { outros: '' },
      medications: [],
      allergies: [{ substance: '', reaction: ' ' }],
      chronic_conditions: [''],
      lifestyle: { smoking: '', alcohol: 'valor_desconhecido' },
    }
    expect(convertLegacyAnamnesis(blank)).toEqual({})
  })

  it('a fully filled legacy row passes the default template schema unchanged (mapper labels and template options must not drift)', () => {
    const full: LegacyAnamnesisRow = {
      main_complaint: 'Rugas',
      patient_goals: 'Rejuvenescer',
      medical_history: { diabetes: true, hiv: true, disturbioCoagulacao: true, outros: 'Enxaqueca' },
      medications: [{ name: 'Losartana', dosage: '50mg' }],
      allergies: [{ substance: 'Látex', severity: 'moderada' }],
      previous_surgeries: [{ procedure: 'Rinoplastia', year: '2019' }],
      chronic_conditions: ['Asma'],
      is_pregnant: true,
      is_breastfeeding: true,
      lifestyle: { smoking: 'ex_fumante', alcohol: 'moderado', exercise: 'intenso', sleep: 'regular', diet: 'equilibrada', sunExposure: 'minima' },
      skincare_routine: [{ product: 'Protetor' }],
      previous_aesthetic_treatments: [{ procedure: 'Botox', satisfaction: 'neutro' }],
    }
    const converted = convertLegacyAnamnesis(full)
    const parsed = buildFormResponseSchema(DEFAULT_ANAMNESIS_TEMPLATE.sections, { enforceRequired: false }).safeParse(converted)
    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual(converted)
  })
})
