/**
 * Clinical content generator for the Clínica Lumé demo seed.
 *
 * Produces the text and structured data that make the clinical record
 * screens (anamnese, prontuário, mapa facial) read like a real practitioner
 * wrote them, instead of Lorem Ipsum. Everything here is a pure function of
 * its arguments -- no `Math.random()`, no `new Date()` -- so a re-run of the
 * seed against the same inputs produces identical content.
 *
 * Shapes are matched against `web/src/db/schema.ts`:
 * - `anamneses.allergies` / `anamneses.medications` are `jsonb` arrays, so
 *   `DemoAnamnesis` returns them as `string[]`.
 * - `diagram_points` stores `x`/`y` as `decimal(5,2)` in the 0-100 relative
 *   range the editor uses (`web/src/components/face-diagram/types.ts`),
 *   `quantity_unit` as a free-text column that the app only ever writes 'U'
 *   or 'mL' into (`QuantityUnit` in `web/src/types/index.ts`), and
 *   `product_name` / `active_ingredient` / `technique` / `depth` / `notes`
 *   as free text with `sort_order` an integer starting at 0.
 */

import type { SeededPatient } from './types'

/** Number of patients that get a full clinical record (anamnese, procedure
 * notes, face diagram) instead of just an appointment history. Keeping this
 * small bounds how much hand-tuned clinical prose the seed needs. */
export const FEATURED_PATIENT_COUNT = 6

export interface DemoAnamnesis {
  /** Maps onto `anamneses.allergies` (jsonb array). Never empty -- "nenhuma
   * alergia conhecida" is itself a value, not an omission. */
  allergies: string[]
  /** Maps onto `anamneses.medications` (jsonb array). */
  medications: string[]
  /** A short clinical-history paragraph in Portuguese, unique per patient. */
  history: string
}

export interface DemoProcedureNotes {
  technique: string
  notes: string
  clinicalResponse: string
}

export interface DemoDiagramPoint {
  /** 0-100, relative to the face diagram canvas. */
  x: number
  /** 0-100, relative to the face diagram canvas. */
  y: number
  productName: string
  activeIngredient: string
  quantity: number
  quantityUnit: 'U' | 'mL'
  technique: string
  depth: string
  notes: string
  sortOrder: number
}

// ─── Anamnesis ────────────────────────────────────────────────────────

const ALLERGY_OPTIONS: string[][] = [
  ['Nenhuma alergia conhecida'],
  ['Alergia a dipirona sódica'],
  ['Alergia a frutos do mar', 'Rinite alérgica sazonal'],
  ['Alergia a látex'],
  ['Alergia a ácido acetilsalicílico (AAS)'],
  ['Nenhuma alergia relatada pela paciente'],
  ['Alergia a sulfa'],
  ['Alergia a corantes de esmalte e perfumes, sem relação com procedimentos injetáveis'],
]

const MEDICATION_OPTIONS: string[][] = [
  ['Nenhuma medicação de uso contínuo'],
  ['Anticoncepcional oral (Selene), uso contínuo'],
  ['Losartana potássica 50mg, 1x ao dia'],
  ['Sertralina 50mg, uso contínuo'],
  ['Levotiroxina sódica 25mcg em jejum'],
  ['Vitamina D 7.000UI, uso semanal'],
  ['Isotretinoína 20mg, suspensa há 6 meses antes do procedimento'],
  ['Complexo polivitamínico, uso esporádico'],
]

/**
 * One short paragraph per template, each written so it reads like a real
 * chart note rather than a form field. Half reference the patient by first
 * name; that plus the rotating allergy/medication pools is what keeps every
 * featured patient's anamnesis text distinct (`history` alone already
 * differs for each of the `FEATURED_PATIENT_COUNT` patients, since there are
 * more templates than featured patients).
 */
const HISTORY_TEMPLATES: Array<(firstName: string) => string> = [
  (firstName) =>
    `${firstName} procurou a clínica após pesquisar sobre harmonização orofacial nas redes sociais, relatando insatisfação com a projeção do terço médio da face e desejo por um resultado natural, sem queixas sistêmicas relevantes.`,
  (firstName) =>
    `${firstName} já realizou toxina botulínica em terço superior há aproximadamente 8 meses em outra clínica, refere boa resposta ao tratamento anterior e retorna para manutenção e avaliação de preenchimento labial.`,
  () =>
    `Paciente sem histórico de procedimentos estéticos injetáveis prévios, relata rotina de cuidados com a pele baseada em protetor solar e ácido hialurônico tópico, buscando neste primeiro atendimento uma avaliação global da face.`,
  (firstName) =>
    `${firstName} relata flacidez facial progressiva percebida após emagrecimento recente, sem comorbidades associadas, com expectativa de resultado gradual e pouco artificial.`,
  () =>
    `Histórico de acne na adolescência com cicatrizes residuais em região malar, sem uso de isotretinoína no último ano, interesse em associar bioestimulador de colágeno a procedimentos de preenchimento.`,
  (firstName) =>
    `${firstName} chegou à clínica por indicação de uma paciente já atendida, sem histórico de reações alérgicas a procedimentos estéticos, relata ansiedade leve com agulhas mas se manteve colaborativa durante a anamnese.`,
  (firstName) =>
    `${firstName} relata rotina de treinos intensos e exposição solar frequente, com queixa principal de assimetria mandibular leve percebida em fotos, sem uso de anticoagulantes.`,
  () =>
    `Paciente encaminhada pela dermatologista para avaliação conjunta de bioestimulador e skinbooster, com pele fotoenvelhecida e histórico de protocolo de peeling químico há 1 ano, sem intercorrências.`,
]

/**
 * Builds an `index`-th varied anamnesis for `patient`. Deterministic: the
 * same `(patient, index)` pair always produces the same text, so re-running
 * the seed never drifts the clinical record content.
 */
export function buildAnamnesis(patient: SeededPatient, index: number): DemoAnamnesis {
  const firstName = patient.fullName.trim().split(/\s+/)[0] ?? patient.fullName

  const allergies = ALLERGY_OPTIONS[index % ALLERGY_OPTIONS.length]
  const medications = MEDICATION_OPTIONS[(index + 3) % MEDICATION_OPTIONS.length]
  const history = HISTORY_TEMPLATES[index % HISTORY_TEMPLATES.length](firstName)

  return { allergies, medications, history }
}

// ─── Procedure notes ──────────────────────────────────────────────────

const TOXINA_PRODUCTS = [
  'Botox (onabotulinumtoxinA)',
  'Dysport (abobotulinumtoxinA)',
  'Xeomin (incobotulinumtoxinA)',
]

const MALAR_FILLER_PRODUCTS = ['Juvederm Voluma', 'Restylane Lyft', 'Belotero Volume']
const LIP_FILLER_PRODUCTS = ['Juvederm Volbella', 'Restylane Kysse', 'Belotero Balance']
const UNDER_EYE_FILLER_PRODUCTS = ['Juvederm Volbella', 'Restylane Eyelight', 'Belotero Soft']

type ProcedureNoteBuilder = (index: number) => DemoProcedureNotes

const PROCEDURE_NOTE_BUILDERS: Record<string, ProcedureNoteBuilder> = {
  'Toxina botulínica completa': (index) => {
    const product = TOXINA_PRODUCTS[index % TOXINA_PRODUCTS.length]
    return {
      technique:
        'Aplicação intramuscular seriada em testa, glabela e região orbicular (pés de galinha), pontos de 2U a 4U espaçados conforme a dinâmica muscular observada em contração.',
      notes: `Aplicadas 46U de ${product}, distribuídas em testa (10U), glabela (20U) e pés de galinha bilateralmente (8U de cada lado). Assepsia com clorexidina alcoólica, sem intercorrências durante a aplicação.`,
      clinicalResponse:
        'Retorno agendado em 14 dias para avaliação de simetria; paciente orientada sobre início de efeito em 3 a 5 dias e pico em 2 semanas.',
    }
  },
  'Toxina botulínica parcial (glabela/testa)': (index) => {
    const product = TOXINA_PRODUCTS[(index + 1) % TOXINA_PRODUCTS.length]
    return {
      technique:
        'Aplicação intramuscular seriada limitada a testa e glabela, poupando a região orbicular.',
      notes: `Aplicadas 30U de ${product} em testa (10U) e glabela (20U), respeitando a dinâmica frontal para reduzir o risco de ptose de sobrancelha.`,
      clinicalResponse:
        'Sem hematomas ou reações imediatas; retorno agendado em 14 dias para reforço pontual, se necessário.',
    }
  },
  'Preenchimento de olheiras': (index) => {
    const product = UNDER_EYE_FILLER_PRODUCTS[index % UNDER_EYE_FILLER_PRODUCTS.length]
    return {
      technique:
        'Técnica de microcânula 25G no plano supraperiosteal, com aspiração negativa prévia em cada ponto.',
      notes: `Aplicado 1ml de ${product} na região das olheiras (sulco lacrimal), 0,5ml de cada lado, com leve subcorreção prevendo reabsorção parcial de líquido nas primeiras 48h.`,
      clinicalResponse:
        'Discreto edema esperado, sem equimoses relevantes. Orientada compressa gelada e retorno em 21 dias.',
    }
  },
  'Preenchimento malar': (index) => {
    const product = MALAR_FILLER_PRODUCTS[index % MALAR_FILLER_PRODUCTS.length]
    return {
      technique:
        'Técnica de bolus profundo em plano supraperiosteal com agulha 27G, seguida de moldagem manual.',
      notes: `Aplicados 2ml de ${product} na região malar, 1ml de cada lado, buscando projeção e definição do terço médio sem exagero de volume.`,
      clinicalResponse:
        'Boa distribuição do produto à palpação, sem assimetrias residuais. Retorno em 30 dias para avaliação fotográfica.',
    }
  },
  'Preenchimento labial': (index) => {
    const product = LIP_FILLER_PRODUCTS[index % LIP_FILLER_PRODUCTS.length]
    return {
      technique:
        'Técnica linear retrógrada com agulha 30G, respeitando a proporção entre terço superior e inferior do lábio.',
      notes: `Aplicado 1ml de ${product} nos lábios, 0,5ml no lábio superior e 0,5ml no inferior, priorizando definição do arco do cupido sobre volume.`,
      clinicalResponse:
        'Edema leve esperado nas primeiras 24 a 48h. Sem sangramento ou hematomas durante a aplicação.',
    }
  },
  'Harmonização facial completa': (index) => {
    const toxinaProduct = TOXINA_PRODUCTS[index % TOXINA_PRODUCTS.length]
    const fillerProduct = MALAR_FILLER_PRODUCTS[(index + 1) % MALAR_FILLER_PRODUCTS.length]
    return {
      technique:
        'Protocolo combinado: toxina botulínica em terço superior seguida de preenchimento com ácido hialurônico em malar, mento e lábios, planejado a partir de análise facial completa.',
      notes: `Sessão combinada com 35U de ${toxinaProduct} em testa e glabela, associadas a 4ml de ${fillerProduct} distribuídos entre malar (2ml), mento (1ml) e lábios (1ml).`,
      clinicalResponse:
        'Paciente tolerou bem o protocolo estendido; orientada sobre o cronograma de resultado (toxina em 2 semanas, preenchimento imediato com acomodação em 15 dias).',
    }
  },
  'Bioestimulador de colágeno (Sculptra)': () => ({
    technique:
      'Diluição de 2 frascos de Sculptra em 8ml de água para injeção, com 24h de hidratação prévia, aplicação em técnica de leque no plano subcutâneo profundo.',
    notes:
      'Aplicados 2 frascos de Sculptra (ácido poli-L-lático) distribuídos em região malar, têmporas e mandíbula, seguidos de massagem vigorosa conforme protocolo (regra dos 5 minutos, 5 vezes ao dia, por 5 dias).',
    clinicalResponse:
      'Sem formação de nódulos palpáveis ao final da aplicação. Retorno programado em 30 dias para a próxima sessão do protocolo.',
  }),
  Skinbooster: () => ({
    technique:
      'Microinjeções intradérmicas com técnica de múltiplas pápulas, agulha 32G, pontos espaçados a cada 1cm (técnica BAP).',
    notes:
      'Aplicados 2ml de Profhilo (ácido hialurônico de baixa reticulação) distribuídos em pontos-padrão da face, com foco em qualidade e hidratação da pele.',
    clinicalResponse:
      'Pápulas reabsorvidas em poucas horas, como esperado; sem eritema além do previsto para o procedimento.',
  }),
  'Limpeza de pele profunda': () => ({
    technique:
      'Higienização, esfoliação enzimática, extração manual de comedões e finalização com máscara calmante.',
    notes:
      'Realizada limpeza de pele com ácido salicílico 2% para desobstrução dos poros, seguida de extração manual e alta hidratação com ácido hialurônico tópico.',
    clinicalResponse:
      'Pele com aspecto uniforme ao final do procedimento, sem sinais de irritação. Orientado uso de protetor solar reforçado nas 48h seguintes.',
  }),
}

/**
 * Builds technique/notes/clinical-response text for a catalogue procedure,
 * naming the actual product, quantity and technique used. `index` rotates
 * the product pick (e.g. Botox vs. Dysport) so repeat procedures across the
 * seed don't all read identically; the clinical facts (dose, area) stay
 * fixed per procedure since that's what a real chart would record.
 */
export function buildProcedureNotes(procedureName: string, index: number): DemoProcedureNotes {
  const builder = PROCEDURE_NOTE_BUILDERS[procedureName]
  if (!builder) {
    throw new Error(`demo-seed clinical: unknown procedure "${procedureName}"`)
  }
  return builder(index)
}

// ─── Face diagram points ──────────────────────────────────────────────

type PointSeed = Omit<DemoDiagramPoint, 'sortOrder'>

function withSortOrder(points: PointSeed[]): DemoDiagramPoint[] {
  return points.map((point, sortOrder) => ({ ...point, sortOrder }))
}

const TOXINA_PRODUCT = TOXINA_PRODUCTS[0]
const TOXINA_INGREDIENT = 'Toxina botulínica tipo A'

const TESTA_POINTS: PointSeed[] = [
  { x: 50, y: 12, productName: TOXINA_PRODUCT, activeIngredient: TOXINA_INGREDIENT, quantity: 4, quantityUnit: 'U', technique: 'Intramuscular', depth: 'muscular frontal', notes: 'Ponto central do frontal' },
  { x: 63, y: 14, productName: TOXINA_PRODUCT, activeIngredient: TOXINA_INGREDIENT, quantity: 3, quantityUnit: 'U', technique: 'Intramuscular', depth: 'muscular frontal', notes: 'Frontal, lado direito' },
  { x: 37, y: 14, productName: TOXINA_PRODUCT, activeIngredient: TOXINA_INGREDIENT, quantity: 3, quantityUnit: 'U', technique: 'Intramuscular', depth: 'muscular frontal', notes: 'Frontal, lado esquerdo' },
]

const GLABELA_POINTS: PointSeed[] = [
  { x: 54, y: 23, productName: TOXINA_PRODUCT, activeIngredient: TOXINA_INGREDIENT, quantity: 8, quantityUnit: 'U', technique: 'Intramuscular', depth: 'muscular (corrugador)', notes: 'Corrugador do supercílio, lado direito' },
  { x: 46, y: 23, productName: TOXINA_PRODUCT, activeIngredient: TOXINA_INGREDIENT, quantity: 8, quantityUnit: 'U', technique: 'Intramuscular', depth: 'muscular (corrugador)', notes: 'Corrugador do supercílio, lado esquerdo' },
  { x: 50, y: 26, productName: TOXINA_PRODUCT, activeIngredient: TOXINA_INGREDIENT, quantity: 4, quantityUnit: 'U', technique: 'Intramuscular', depth: 'muscular (prócero)', notes: 'Prócero, linha glabelar' },
]

const CROWS_FEET_POINTS: PointSeed[] = [
  { x: 82, y: 33, productName: TOXINA_PRODUCT, activeIngredient: TOXINA_INGREDIENT, quantity: 8, quantityUnit: 'U', technique: 'Intramuscular', depth: 'muscular (orbicular)', notes: 'Pé de galinha, lado direito' },
  { x: 18, y: 33, productName: TOXINA_PRODUCT, activeIngredient: TOXINA_INGREDIENT, quantity: 8, quantityUnit: 'U', technique: 'Intramuscular', depth: 'muscular (orbicular)', notes: 'Pé de galinha, lado esquerdo' },
]

const MALAR_PRODUCT = MALAR_FILLER_PRODUCTS[0]
const HYALURONIC_INGREDIENT = 'Ácido hialurônico'

const MALAR_POINTS: PointSeed[] = [
  { x: 72, y: 45, productName: MALAR_PRODUCT, activeIngredient: HYALURONIC_INGREDIENT, quantity: 1, quantityUnit: 'mL', technique: 'Bolus profundo', depth: 'supraperiosteal', notes: 'Malar, lado direito' },
  { x: 28, y: 45, productName: MALAR_PRODUCT, activeIngredient: HYALURONIC_INGREDIENT, quantity: 1, quantityUnit: 'mL', technique: 'Bolus profundo', depth: 'supraperiosteal', notes: 'Malar, lado esquerdo' },
]

const UNDER_EYE_POINTS: PointSeed[] = [
  { x: 65, y: 36, productName: UNDER_EYE_FILLER_PRODUCTS[0], activeIngredient: HYALURONIC_INGREDIENT, quantity: 0.5, quantityUnit: 'mL', technique: 'Microcânula', depth: 'supraperiosteal', notes: 'Olheira, lado direito' },
  { x: 35, y: 36, productName: UNDER_EYE_FILLER_PRODUCTS[0], activeIngredient: HYALURONIC_INGREDIENT, quantity: 0.5, quantityUnit: 'mL', technique: 'Microcânula', depth: 'supraperiosteal', notes: 'Olheira, lado esquerdo' },
]

const LIP_POINTS: PointSeed[] = [
  { x: 50, y: 76, productName: LIP_FILLER_PRODUCTS[0], activeIngredient: HYALURONIC_INGREDIENT, quantity: 0.5, quantityUnit: 'mL', technique: 'Linear retrógrada', depth: 'dérmico profundo', notes: 'Lábio superior' },
  { x: 50, y: 82, productName: LIP_FILLER_PRODUCTS[0], activeIngredient: HYALURONIC_INGREDIENT, quantity: 0.5, quantityUnit: 'mL', technique: 'Linear retrógrada', depth: 'dérmico profundo', notes: 'Lábio inferior' },
]

const SCULPTRA_PRODUCT = 'Sculptra'
const SCULPTRA_INGREDIENT = 'Ácido poli-L-lático'

const BIOESTIMULADOR_POINTS: PointSeed[] = [
  { x: 72, y: 45, productName: SCULPTRA_PRODUCT, activeIngredient: SCULPTRA_INGREDIENT, quantity: 1, quantityUnit: 'mL', technique: 'Técnica de leque', depth: 'subcutâneo profundo', notes: 'Malar, lado direito' },
  { x: 28, y: 45, productName: SCULPTRA_PRODUCT, activeIngredient: SCULPTRA_INGREDIENT, quantity: 1, quantityUnit: 'mL', technique: 'Técnica de leque', depth: 'subcutâneo profundo', notes: 'Malar, lado esquerdo' },
  { x: 85, y: 20, productName: SCULPTRA_PRODUCT, activeIngredient: SCULPTRA_INGREDIENT, quantity: 0.5, quantityUnit: 'mL', technique: 'Técnica de leque', depth: 'subcutâneo profundo', notes: 'Têmpora, lado direito' },
  { x: 15, y: 20, productName: SCULPTRA_PRODUCT, activeIngredient: SCULPTRA_INGREDIENT, quantity: 0.5, quantityUnit: 'mL', technique: 'Técnica de leque', depth: 'subcutâneo profundo', notes: 'Têmpora, lado esquerdo' },
  { x: 78, y: 68, productName: SCULPTRA_PRODUCT, activeIngredient: SCULPTRA_INGREDIENT, quantity: 1, quantityUnit: 'mL', technique: 'Técnica de leque', depth: 'subcutâneo profundo', notes: 'Mandíbula, lado direito' },
  { x: 22, y: 68, productName: SCULPTRA_PRODUCT, activeIngredient: SCULPTRA_INGREDIENT, quantity: 1, quantityUnit: 'mL', technique: 'Técnica de leque', depth: 'subcutâneo profundo', notes: 'Mandíbula, lado esquerdo' },
]

const SKINBOOSTER_PRODUCT = 'Profhilo'
const SKINBOOSTER_INGREDIENT = 'Ácido hialurônico de baixa reticulação'

const SKINBOOSTER_POINTS: PointSeed[] = [
  { x: 50, y: 15, productName: SKINBOOSTER_PRODUCT, activeIngredient: SKINBOOSTER_INGREDIENT, quantity: 0.5, quantityUnit: 'mL', technique: 'Microinjeções (BAP)', depth: 'dérmico', notes: 'Testa' },
  { x: 70, y: 50, productName: SKINBOOSTER_PRODUCT, activeIngredient: SKINBOOSTER_INGREDIENT, quantity: 0.5, quantityUnit: 'mL', technique: 'Microinjeções (BAP)', depth: 'dérmico', notes: 'Bochecha, lado direito' },
  { x: 30, y: 50, productName: SKINBOOSTER_PRODUCT, activeIngredient: SKINBOOSTER_INGREDIENT, quantity: 0.5, quantityUnit: 'mL', technique: 'Microinjeções (BAP)', depth: 'dérmico', notes: 'Bochecha, lado esquerdo' },
  { x: 50, y: 88, productName: SKINBOOSTER_PRODUCT, activeIngredient: SKINBOOSTER_INGREDIENT, quantity: 0.5, quantityUnit: 'mL', technique: 'Microinjeções (BAP)', depth: 'dérmico', notes: 'Queixo' },
]

/**
 * `x`/`y` are all in the 0-100 relative range the face diagram editor uses.
 * Toxina points sit on testa/glabela/pés de galinha and carry `U` doses;
 * preenchimento points sit on lábios/malar/olheiras and carry `mL` doses,
 * matching the anatomy of each procedure. "Limpeza de pele profunda" is not
 * injectable, so it maps to no diagram at all.
 */
const POINTS_BY_PROCEDURE: Record<string, PointSeed[]> = {
  'Toxina botulínica completa': [...TESTA_POINTS, ...GLABELA_POINTS, ...CROWS_FEET_POINTS],
  'Toxina botulínica parcial (glabela/testa)': [...TESTA_POINTS, ...GLABELA_POINTS],
  'Preenchimento de olheiras': UNDER_EYE_POINTS,
  'Preenchimento malar': MALAR_POINTS,
  'Preenchimento labial': LIP_POINTS,
  'Harmonização facial completa': [
    { x: 50, y: 12, productName: TOXINA_PRODUCT, activeIngredient: TOXINA_INGREDIENT, quantity: 5, quantityUnit: 'U', technique: 'Intramuscular', depth: 'muscular frontal', notes: 'Frontal, ponto central' },
    { x: 54, y: 23, productName: TOXINA_PRODUCT, activeIngredient: TOXINA_INGREDIENT, quantity: 15, quantityUnit: 'U', technique: 'Intramuscular', depth: 'muscular (corrugador)', notes: 'Glabela, lado direito' },
    { x: 46, y: 23, productName: TOXINA_PRODUCT, activeIngredient: TOXINA_INGREDIENT, quantity: 15, quantityUnit: 'U', technique: 'Intramuscular', depth: 'muscular (corrugador)', notes: 'Glabela, lado esquerdo' },
    { x: 72, y: 45, productName: MALAR_PRODUCT, activeIngredient: HYALURONIC_INGREDIENT, quantity: 1, quantityUnit: 'mL', technique: 'Bolus profundo', depth: 'supraperiosteal', notes: 'Malar, lado direito' },
    { x: 28, y: 45, productName: MALAR_PRODUCT, activeIngredient: HYALURONIC_INGREDIENT, quantity: 1, quantityUnit: 'mL', technique: 'Bolus profundo', depth: 'supraperiosteal', notes: 'Malar, lado esquerdo' },
    { x: 50, y: 92, productName: MALAR_PRODUCT, activeIngredient: HYALURONIC_INGREDIENT, quantity: 1, quantityUnit: 'mL', technique: 'Bolus profundo', depth: 'supraperiosteal', notes: 'Mento' },
    { x: 50, y: 79, productName: LIP_FILLER_PRODUCTS[0], activeIngredient: HYALURONIC_INGREDIENT, quantity: 1, quantityUnit: 'mL', technique: 'Linear retrógrada', depth: 'dérmico profundo', notes: 'Lábios' },
  ],
  'Bioestimulador de colágeno (Sculptra)': BIOESTIMULADOR_POINTS,
  Skinbooster: SKINBOOSTER_POINTS,
  'Limpeza de pele profunda': [],
}

/**
 * Builds face-diagram points for a catalogue procedure, in the shape
 * `diagram_points` expects (minus `id`/`tenant_id`/`face_diagram_id`, which
 * the DB writer fills in). Deterministic per `procedureName` -- there is no
 * per-call variation, since the anatomy and standard dosing for a given
 * procedure don't change between patients.
 */
export function buildFaceDiagramPoints(procedureName: string): DemoDiagramPoint[] {
  const points = POINTS_BY_PROCEDURE[procedureName]
  if (!points) {
    throw new Error(`demo-seed clinical: unknown procedure "${procedureName}"`)
  }
  return withSortOrder(points)
}
