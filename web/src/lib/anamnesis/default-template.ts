import type { FormListColumn, FormQuestion, FormSection } from '@/lib/forms/types'
import type { AnamnesisTemplate } from './types'

const text = (id: string, label: string, required = false): FormListColumn =>
  required ? { id, label, kind: 'text', required } : { id, label, kind: 'text' }
const select = (id: string, label: string, options: string[]): FormListColumn => ({ id, label, kind: 'select', options })

type QuestionInput = Omit<FormQuestion, 'required' | 'order'>

function section(id: string, title: string, order: number, questions: QuestionInput[]): FormSection {
  return {
    id,
    title,
    order,
    questions: questions.map((q, index) => ({ ...q, required: false, order: index })),
  }
}

const radio = (id: string, label: string, options: string[]): QuestionInput => ({ id, label, type: 'radio', options })
const list = (id: string, label: string, columns: FormListColumn[]): QuestionInput => ({ id, label, type: 'list', columns })
const YES_NO = ['Sim', 'Não']

export const DEFAULT_ANAMNESIS_TEMPLATE: AnamnesisTemplate = {
  version: 0,
  sections: [
    section('anam-sec-complaint', 'Queixa principal e objetivos', 0, [
      { id: 'anam-main-complaint', label: 'Queixa principal', type: 'text' },
      { id: 'anam-patient-goals', label: 'Objetivos do paciente', type: 'text' },
    ]),
    section('anam-sec-medical-history', 'Histórico médico', 1, [
      {
        id: 'anam-medical-history',
        label: 'Condições de saúde',
        type: 'checkbox_with_other',
        options: [
          'Diabetes', 'Hipertensão', 'Doença autoimune', 'Doença cardiovascular', 'Hepatite', 'HIV/AIDS',
          'Câncer', 'Epilepsia', 'Distúrbio de coagulação', 'Queloides', 'Herpes',
        ],
      },
    ]),
    section('anam-sec-medications', 'Medicamentos em uso', 2, [
      list('anam-medications', 'Medicamentos', [
        text('name', 'Nome', true), text('dosage', 'Dosagem'), text('frequency', 'Frequência'), text('reason', 'Motivo'),
      ]),
    ]),
    section('anam-sec-allergies', 'Alergias', 3, [
      list('anam-allergies', 'Alergias', [
        text('substance', 'Substância', true), text('reaction', 'Reação'),
        select('severity', 'Gravidade', ['Leve', 'Moderada', 'Grave']),
      ]),
    ]),
    section('anam-sec-surgeries', 'Cirurgias anteriores', 4, [
      list('anam-previous-surgeries', 'Cirurgias', [
        text('procedure', 'Procedimento', true), text('year', 'Ano'), text('notes', 'Observações'),
      ]),
    ]),
    section('anam-sec-chronic', 'Condições crônicas', 5, [
      list('anam-chronic-conditions', 'Condições crônicas', [text('condicao', 'Condição', true)]),
    ]),
    section('anam-sec-pregnancy', 'Gestação / Amamentação', 6, [
      radio('anam-pregnant', 'Gestante?', YES_NO),
      radio('anam-breastfeeding', 'Amamentando?', YES_NO),
    ]),
    section('anam-sec-lifestyle', 'Estilo de vida', 7, [
      radio('anam-smoking', 'Tabagismo', ['Não', 'Ex-fumante', 'Sim, ocasional', 'Sim, diário']),
      radio('anam-alcohol', 'Álcool', ['Não', 'Ocasional', 'Moderado', 'Frequente']),
      radio('anam-exercise', 'Exercício físico', ['Sedentário', 'Leve', 'Moderado', 'Intenso']),
      radio('anam-sleep', 'Qualidade do sono', ['Ruim', 'Regular', 'Bom', 'Excelente']),
      radio('anam-diet', 'Alimentação', ['Desequilibrada', 'Regular', 'Equilibrada', 'Restritiva']),
      radio('anam-sun-exposure', 'Exposição solar', ['Mínima', 'Moderada', 'Alta', 'Muito alta']),
    ]),
    section('anam-sec-skincare', 'Rotina de cuidados com a pele', 8, [
      list('anam-skincare-routine', 'Produtos', [
        text('product', 'Produto', true), text('frequency', 'Frequência'), text('notes', 'Observações'),
      ]),
    ]),
    section('anam-sec-treatments', 'Tratamentos estéticos anteriores', 9, [
      list('anam-previous-treatments', 'Tratamentos', [
        text('procedure', 'Procedimento', true), text('date', 'Data'), text('professional', 'Profissional'),
        text('notes', 'Observações'),
        select('satisfaction', 'Satisfação', ['Muito insatisfeito', 'Insatisfeito', 'Neutro', 'Satisfeito', 'Muito satisfeito']),
      ]),
    ]),
  ],
}
