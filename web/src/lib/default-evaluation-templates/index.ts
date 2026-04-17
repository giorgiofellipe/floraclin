import type { DefaultTemplateDefinition } from '@/types/evaluation'
import { toxinaBotulinicaSections } from './toxina-botulinica'
import { preenchimentosSections } from './preenchimentos'
import { bioestimuladorSections } from './bioestimulador'
import { skinboosterSections } from './skinbooster'
import { enzimaSections } from './enzima'
import { limpezaPeleSections } from './limpeza-pele'
import { skincareSections } from './skincare'
import { microagulhamentoSections } from './microagulhamento'

export const defaultTemplates: DefaultTemplateDefinition[] = [
  { name: 'Toxina Botulínica', category: 'botox', sections: toxinaBotulinicaSections },
  { name: 'Preenchimentos', category: 'filler', sections: preenchimentosSections },
  { name: 'Bioestimulador de Colágeno', category: 'biostimulator', sections: bioestimuladorSections },
  { name: 'Skinbooster', category: 'skinbooster', sections: skinboosterSections },
  { name: 'Enzima para Gordura', category: 'enzima', sections: enzimaSections },
  { name: 'Limpeza de Pele', category: 'limpeza_pele', sections: limpezaPeleSections },
  { name: 'Skincare Personalizado', category: 'skincare', sections: skincareSections },
  { name: 'Microagulhamento', category: 'microagulhamento', sections: microagulhamentoSections },
]
