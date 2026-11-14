import { describe, expect, it } from 'vitest'
import { DEFAULT_ANAMNESIS_TEMPLATE } from '../default-template'
import { anamnesisAlerts, hasAnamnesisAnswers } from '../summary'
import type { AnamnesisRecord } from '../types'
import type { FormResponses } from '@/lib/forms/types'

function record(responses: FormResponses): AnamnesisRecord {
  return {
    id: 'a1',
    patientId: 'p1',
    templateVersion: 0,
    templateSnapshot: DEFAULT_ANAMNESIS_TEMPLATE.sections,
    responses,
    updatedBy: null,
    createdAt: '2026-11-10T12:00:00Z',
    updatedAt: '2026-11-10T12:00:00Z',
  }
}

describe('anamnesis status card data', () => {
  it('surfaces allergies, health conditions and pregnancy from the default template', () => {
    const alerts = anamnesisAlerts(
      record({
        'anam-allergies': [{ substance: 'Lidocaína', reaction: '' }, { substance: ' ' }],
        'anam-medical-history': { selected: ['Herpes'], other: 'Rosácea' },
        'anam-chronic-conditions': [{ condicao: 'Hipotireoidismo' }],
        'anam-pregnant': 'Sim',
        'anam-breastfeeding': 'Não',
        'anam-smoking': 'Sim, diário',
      }),
    )
    expect(alerts).toEqual(['Alergia: Lidocaína', 'Herpes', 'Rosácea', 'Hipotireoidismo', 'Gestante'])
  })

  // Seeded and real answers write the denial as text; showing it as an alert cries wolf.
  it('does not raise an alert for a written denial', () => {
    expect(
      anamnesisAlerts(
        record({
          'anam-allergies': [{ substance: 'Nenhuma alergia conhecida' }],
          'anam-medical-history': { selected: [], other: 'Não' },
        }),
      ),
    ).toEqual([])
    // A denial followed by detail still names something to check.
    expect(
      anamnesisAlerts(record({ 'anam-allergies': [{ substance: 'Nenhuma conhecida, mas reagiu a lidocaína' }] })),
    ).toEqual(['Alergia: Nenhuma conhecida, mas reagiu a lidocaína'])
  })

  // A row with only blank answers would otherwise show "Anamnese preenchida" and hide the fill options.
  it('treats a saved row with only blank answers as not filled', () => {
    expect(hasAnamnesisAnswers(record({ 'anam-main-complaint': '  ', 'anam-allergies': [{ substance: '' }] }))).toBe(false)
    expect(hasAnamnesisAnswers(record({ 'anam-main-complaint': 'Rugas na testa' }))).toBe(true)
  })
})
