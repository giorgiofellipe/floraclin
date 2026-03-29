import { z } from 'zod'

export const consentTypes = ['general', 'botox', 'filler', 'biostimulator', 'custom', 'service_contract'] as const
export const acceptanceMethods = ['checkbox', 'signature', 'both'] as const

export const consentTemplateSchema = z.object({
  type: z.enum(consentTypes, {
    message: 'Tipo de consentimento é obrigatório',
  }),
  title: z
    .string()
    .min(3, 'Título deve ter no mínimo 3 caracteres')
    .max(255, 'Título deve ter no máximo 255 caracteres'),
  content: z
    .string()
    .min(10, 'Conteúdo deve ter no mínimo 10 caracteres'),
})

export type ConsentTemplateInput = z.infer<typeof consentTemplateSchema>

export const consentAcceptanceSchema = z.object({
  patientId: z.string().uuid('ID do paciente inválido'),
  consentTemplateId: z.string().uuid('ID do termo inválido'),
  procedureRecordId: z.string().uuid('ID do procedimento inválido').optional(),
  acceptanceMethod: z.enum(acceptanceMethods, {
    message: 'Método de aceite é obrigatório',
  }),
  signatureData: z.string().optional(),
}).refine(
  (data) => {
    if (data.acceptanceMethod === 'signature' || data.acceptanceMethod === 'both') {
      return !!data.signatureData && data.signatureData.startsWith('data:image/')
    }
    return true
  },
  {
    message: 'Assinatura é obrigatória para este método de aceite',
    path: ['signatureData'],
  }
)

export type ConsentAcceptanceInput = z.infer<typeof consentAcceptanceSchema>

// Default consent template texts (modelo sugerido)
export const DEFAULT_CONSENT_TEMPLATES = {
  general: {
    title: 'Termo de Consentimento Livre e Esclarecido — Procedimentos Estéticos',
    content: `TERMO DE CONSENTIMENTO LIVRE E ESCLARECIDO — PROCEDIMENTOS ESTÉTICOS
(modelo sugerido)

Eu, paciente abaixo identificado(a), declaro que fui devidamente informado(a) pelo(a) profissional responsável sobre o procedimento estético ao qual serei submetido(a), incluindo:

1. NATUREZA DO PROCEDIMENTO
Fui informado(a) sobre a natureza, os objetivos, os benefícios esperados e as possíveis alternativas ao procedimento proposto.

2. RISCOS E COMPLICAÇÕES
Compreendo que todo procedimento estético envolve riscos, incluindo, mas não se limitando a: dor, inchaço, hematomas, infecção, reações alérgicas, assimetria, resultados insatisfatórios, necrose tecidual e, em casos raros, complicações mais graves.

3. CUIDADOS PRÉ E PÓS-PROCEDIMENTO
Recebi orientações sobre os cuidados necessários antes e após o procedimento, e me comprometo a segui-los integralmente.

4. RESULTADOS
Compreendo que os resultados podem variar de pessoa para pessoa e que o(a) profissional não pode garantir resultados específicos.

5. FOTOGRAFIAS
Autorizo o registro fotográfico para fins de acompanhamento clínico e documentação do prontuário. As imagens não serão utilizadas para fins comerciais ou publicitários sem minha autorização expressa.

6. DIREITO DE REVOGAÇÃO
Estou ciente de que posso revogar este consentimento a qualquer momento antes da realização do procedimento.

7. ESCLARECIMENTO DE DÚVIDAS
Declaro que todas as minhas dúvidas foram esclarecidas e que tive tempo suficiente para considerar minha decisão.

Ao aceitar este termo, confirmo que li, compreendi e concordo com todas as informações acima.`,
  },
  botox: {
    title: 'Termo de Consentimento — Toxina Botulínica',
    content: `TERMO DE CONSENTIMENTO — APLICAÇÃO DE TOXINA BOTULÍNICA
(modelo sugerido)

Eu, paciente abaixo identificado(a), declaro que fui devidamente informado(a) sobre o procedimento de aplicação de toxina botulínica tipo A, e que compreendo os seguintes aspectos:

1. O PROCEDIMENTO
A toxina botulínica é uma proteína purificada que, quando injetada em pequenas doses nos músculos faciais, promove o relaxamento temporário da musculatura, atenuando rugas e linhas de expressão dinâmicas.

2. INDICAÇÕES
O procedimento está sendo realizado para tratamento de linhas de expressão e/ou rugas dinâmicas nas regiões indicadas pelo(a) profissional.

3. RISCOS E EFEITOS COLATERAIS
Fui informado(a) sobre os possíveis efeitos colaterais, incluindo:
• Dor leve no local da aplicação
• Hematomas e equimoses temporários
• Edema (inchaço) localizado
• Cefaleia (dor de cabeça) transitória
• Ptose palpebral (queda temporária da pálpebra) — raro
• Assimetria facial temporária
• Resultados aquém do esperado
• Reação alérgica — raro
• Sensação de peso ou rigidez na região tratada

4. CONTRAINDICAÇÕES
Declaro que informei ao profissional sobre todas as condições médicas relevantes, incluindo: gestação, amamentação, doenças neuromusculares (miastenia gravis, esclerose lateral amiotrófica), uso de aminoglicosídeos ou anticoagulantes, alergia a componentes da fórmula.

5. DURAÇÃO DO EFEITO
Compreendo que o efeito da toxina botulínica é temporário, com duração média de 3 a 6 meses, podendo variar conforme o metabolismo individual, e que sessões de manutenção serão necessárias.

6. PÓS-PROCEDIMENTO
Recebi orientações sobre os cuidados pós-procedimento:
• Não deitar nas primeiras 4 horas
• Não massagear a região tratada
• Evitar atividade física intensa nas primeiras 24 horas
• Não consumir álcool nas primeiras 24 horas
• Retornar para avaliação em 15 dias

Ao aceitar este termo, confirmo que li, compreendi e concordo com todas as informações acima.`,
  },
  filler: {
    title: 'Termo de Consentimento — Preenchedor / Ácido Hialurônico',
    content: `TERMO DE CONSENTIMENTO — PREENCHIMENTO COM ÁCIDO HIALURÔNICO
(modelo sugerido)

Eu, paciente abaixo identificado(a), declaro que fui devidamente informado(a) sobre o procedimento de preenchimento com ácido hialurônico, e que compreendo os seguintes aspectos:

1. O PROCEDIMENTO
O ácido hialurônico é um polissacarídeo biocompatível e biodegradável, naturalmente presente no organismo humano. Quando injetado na pele ou tecido subcutâneo, promove preenchimento, volumização e/ou hidratação da região tratada.

2. INDICAÇÕES
O procedimento está sendo realizado para: preenchimento de sulcos, restauração de volume facial, contorno e definição de estruturas faciais e/ou melhora da qualidade da pele, conforme avaliação do(a) profissional.

3. RISCOS E EFEITOS COLATERAIS
Fui informado(a) sobre os possíveis efeitos colaterais, incluindo:
• Dor e desconforto durante e após a aplicação
• Edema (inchaço) — comum nos primeiros dias
• Hematomas e equimoses — comuns, resolvem em 7 a 14 dias
• Eritema (vermelhidão) no local
• Nódulos palpáveis ou visíveis
• Assimetria
• Migração do produto
• Efeito Tyndall (coloração azulada quando injetado superficialmente)
• Infecção — raro
• Reação granulomatosa — raro
• Compressão ou oclusão vascular — raro, mas potencialmente grave, podendo levar a necrose tecidual ou comprometimento visual
• Reação alérgica — raro

4. CONTRAINDICAÇÕES
Declaro que informei sobre todas as condições relevantes, incluindo: gestação, amamentação, doenças autoimunes, uso de imunossupressores, infecções ativas na região, alergia a ácido hialurônico, uso de anticoagulantes, histórico de herpes na região facial.

5. DURAÇÃO DO EFEITO
Compreendo que o efeito do preenchimento com ácido hialurônico é temporário, com duração média de 6 a 18 meses, variando conforme o produto utilizado, a região tratada e o metabolismo individual.

6. DISSOLUÇÃO
Fui informado(a) de que o ácido hialurônico pode ser dissolvido com a enzima hialuronidase em caso de complicações ou resultados indesejados.

7. PÓS-PROCEDIMENTO
Recebi orientações sobre os cuidados pós-procedimento:
• Aplicar compressas frias nas primeiras 24 horas
• Não massagear a região, salvo orientação específica do profissional
• Evitar exposição solar intensa por 48 horas
• Evitar atividade física intensa nas primeiras 24 horas
• Comunicar imediatamente qualquer sinal de dor intensa, alteração de cor da pele ou comprometimento visual

Ao aceitar este termo, confirmo que li, compreendi e concordo com todas as informações acima.`,
  },
  biostimulator: {
    title: 'Termo de Consentimento — Bioestimulador de Colágeno',
    content: `TERMO DE CONSENTIMENTO — BIOESTIMULADOR DE COLÁGENO
(modelo sugerido)

Eu, paciente abaixo identificado(a), declaro que fui devidamente informado(a) sobre o procedimento de aplicação de bioestimulador de colágeno, e que compreendo os seguintes aspectos:

1. O PROCEDIMENTO
Os bioestimuladores de colágeno são substâncias injetáveis que estimulam a produção natural de colágeno pelo organismo. Diferentemente dos preenchedores, seu objetivo principal é melhorar a qualidade e firmeza da pele ao longo do tempo, através da neocolagênese (formação de novo colágeno).

2. SUBSTÂNCIAS UTILIZADAS
Os bioestimuladores mais comuns incluem: ácido poli-L-láctico (PLLA), hidroxiapatita de cálcio (CaHA) e policaprolactona (PCL). O(a) profissional me informou sobre a substância específica que será utilizada no meu tratamento.

3. INDICAÇÕES
O procedimento está sendo realizado para: tratamento de flacidez cutânea, melhora da qualidade da pele, restauração de volume perdido pelo envelhecimento e/ou estímulo de colágeno, conforme avaliação do(a) profissional.

4. RISCOS E EFEITOS COLATERAIS
Fui informado(a) sobre os possíveis efeitos colaterais, incluindo:
• Dor e desconforto durante e após a aplicação
• Edema (inchaço) — comum nos primeiros dias
• Hematomas e equimoses
• Eritema (vermelhidão)
• Nódulos subcutâneos — podem ocorrer e geralmente são resolvidos com massagem
• Assimetria
• Granulomas — raro
• Infecção — raro
• Reação alérgica — raro
• Migração do produto — raro

5. CONTRAINDICAÇÕES
Declaro que informei sobre todas as condições relevantes, incluindo: gestação, amamentação, doenças autoimunes, uso de imunossupressores, infecções ativas, doenças do colágeno, tendência a cicatrizes queloides, alergia a componentes da fórmula.

6. EXPECTATIVA DE RESULTADOS
Compreendo que:
• Os resultados do bioestimulador são graduais e progressivos, podendo levar de 30 a 90 dias para se manifestar
• Múltiplas sessões podem ser necessárias para atingir o resultado desejado
• Os resultados são duradouros (12 a 24 meses), mas não permanentes
• A resposta individual varia conforme idade, qualidade da pele e estilo de vida

7. PÓS-PROCEDIMENTO
Recebi orientações sobre os cuidados pós-procedimento:
• Realizar massagens na região tratada conforme orientação do profissional (especialmente para PLLA)
• Evitar exposição solar intensa por 48 horas
• Evitar atividade física intensa nas primeiras 24 a 48 horas
• Manter hidratação adequada
• Retornar para avaliação conforme agendamento

Ao aceitar este termo, confirmo que li, compreendi e concordo com todas as informações acima.`,
  },
  service_contract: {
    title: 'Contrato de Prestacao de Servicos Esteticos',
    content: `CONTRATO DE PRESTACAO DE SERVICOS

Pelo presente instrumento, {{nome_paciente}}, CPF {{cpf_paciente}}, declara que contrata os servicos esteticos descritos abaixo, prestados pela clinica {{clinica}}, sob responsabilidade do(a) profissional {{profissional}}.

1. PROCEDIMENTOS CONTRATADOS
{{procedimentos}}

2. PRODUTOS A SEREM UTILIZADOS
{{produtos}}

3. VALOR E FORMA DE PAGAMENTO
Valor total: {{valor_total}}
Forma de pagamento: {{forma_pagamento}}
{{parcelas}}

4. OBRIGACOES DO CONTRATANTE
O(a) contratante se compromete a:
a) Comparecer nas datas e horarios agendados;
b) Seguir todas as orientacoes pre e pos-procedimento;
c) Informar sobre qualquer condicao de saude relevante;
d) Efetuar o pagamento conforme acordado.

5. OBRIGACOES DO CONTRATADO
A clinica se compromete a:
a) Realizar os procedimentos conforme descrito, utilizando produtos de qualidade e dentro da validade;
b) Fornecer todas as orientacoes necessarias ao paciente;
c) Manter sigilo sobre as informacoes do paciente.

6. CANCELAMENTO E REAGENDAMENTO
Em caso de cancelamento com menos de 24 horas de antecedencia, podera ser cobrada taxa de ate 20% do valor do procedimento. Reagendamentos podem ser feitos com ate 24 horas de antecedencia sem custo adicional.

7. DISPOSICOES GERAIS
Este contrato e regido pelas leis brasileiras. Eventuais disputas serao resolvidas no foro da comarca da clinica.

Data: {{data}}

_______________________________
Assinatura do paciente

_______________________________
Assinatura do profissional`,
  },
} as const
