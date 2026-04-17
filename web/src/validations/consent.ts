import { z } from 'zod'

export const consentTypes = [
  'general',
  'botox',
  'filler',
  'biostimulator',
  'limpeza_pele',
  'enzima',
  'skinbooster',
  'microagulhamento',
  'custom',
  'service_contract',
] as const
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
    content: `TERMO DE CONSENTIMENTO LIVRE E ESCLARECIDO
Autorização e Ciência de Riscos
BIOESTIMULADOR DE COLÁGENO · COLAGENOESTIMULAÇÃO

Este documento assegura que o(a) paciente recebeu informações completas e compreensíveis sobre o procedimento de bioestimulação de colágeno, em cumprimento ao art. 6°, III, do CDC (Lei nº 8.078/1990) e às normas de ética profissional aplicáveis. Por tratar-se de procedimento injetável invasivo com substância bioestimuladora, o consentimento informado tem relevância jurídica e clínica elevada. A assinatura é condição obrigatória para a realização.

Cláusula 1 — DESCRIÇÃO DO PROCEDIMENTO E SUBSTÂNCIA UTILIZADA
O bioestimulador de colágeno é um procedimento injetável minimamente invasivo que utiliza substâncias biocompatíveis para estimular a produção endógena (pelo próprio organismo) de colágeno, elastina e outros componentes da matriz extracelular. O resultado é a melhora progressiva da firmeza, da espessura e da qualidade da pele ao longo de semanas a meses.

O produto indicado para esta sessão é: [ ] Sculptra — Ácido Poli-L-Lático (PLLA)   [ ] Radiesse — Hidroxiapatita de Cálcio (CaHA)   [ ] Outro: __________________________

A aplicação é realizada com agulha fina ou cânula, em planos específicos da face ou do corpo, conforme mapeamento definido pelo profissional. Pode ser utilizada anestesia tópica (creme anestésico) ou anestesia local prévia à aplicação.

Cláusula 2 — OBJETIVOS, RESULTADOS ESPERADOS E NATUREZA PROGRESSIVA
O procedimento visa: aumento da firmeza e elasticidade da pele, redução da flacidez, melhora do volume facial, suavização de rugas e linhas e rejuvenescimento global. Os resultados são graduais e progressivos — o colágeno neoformado se desenvolve ao longo de 4 a 12 semanas após cada sessão, com aperfeiçoamento contínuo por 12 a 24 meses.

ATENÇÃO — RESULTADO NÃO É IMEDIATO
O efeito do bioestimulador não é visível logo após a aplicação. O inchaço inicial do produto se resolve em dias e o resultado estético real começa a aparecer entre 4 e 12 semanas. Não configura falha no procedimento a ausência de efeito imediato. O protocolo completo geralmente requer 2 a 3 sessões com intervalo de 4 a 8 semanas.

Por constituir obrigação de meio, não há garantia de resultado específico. Fatores individuais (genética, tabagismo, exposição solar, hidratação, qualidade do sono) influenciam diretamente a resposta ao tratamento.

Cláusula 3 — RISCOS, EFEITOS ESPERADOS E POSSÍVEIS INTERCORRÊNCIAS
Efeitos esperados e transitórios (fazem parte do processo):
• Edema (inchaço) local por 3 a 7 dias — intensidade variável por área
• Vermelhidão e sensibilidade local nas primeiras 48 horas
• Dor leve ou desconforto durante e após a aplicação
• Hematomas (roxos) no local da punção — podem levar até 14 dias para resolver
• Endurecimento temporário no local (nódulos palpáveis transitórios)
• Irregularidades de superfície iniciais que se resolvem com massagem

Riscos menos comuns, porém possíveis:
• Nódulos persistentes (granulomas) — necessitam acompanhamento e tratamento específico
• Reação inflamatória tardia ao produto (biofilme)
• Assimetria de resultado, corrigível em sessão de retoque
• Reação alérgica ou hipersensibilidade ao produto
• Hiperpigmentação pós-inflamatória em fototipos altos
• Infecção local por quebra de assepsia
• Oclusão vascular (raro) — emergência médica, tratada com protocolo específico
• Resultado insatisfatório ou abaixo da expectativa

Cláusula 4 — CONTRAINDICAÇÕES VERIFICADAS
O(a) paciente confirma que nenhuma das seguintes condições está presente no momento do procedimento, conforme verificado na ficha de avaliação clínica:
• Gestação ou amamentação
• Doença autoimune ativa e não controlada
• Infecção ativa na área a ser tratada
• Histórico de queloides ou cicatrizes hipertróficas
• Alergia conhecida ao produto indicado (PLLA ou CaHA)
• Histórico de granuloma a corpos estranhos
• Tendência comprovada a nódulos com preenchedores anteriores
• Uso de anticoagulante oral sem orientação médica para suspensão

Cláusula 5 — PROTOCOLO DE MASSAGEM E CUIDADOS ESSENCIAIS
Para produtos à base de PLLA (Sculptra), o protocolo de massagem pós-aplicação é obrigatório e determinante para o resultado. O(a) paciente foi orientado(a) sobre:
• Regra dos 5: massagear a área por 5 minutos, 5 vezes ao dia, durante 5 dias após cada sessão
• Aplicar protetor solar FPS 50 diariamente durante todo o protocolo
• Evitar exposição solar intensa, sauna e atividade física intensa nas primeiras 48 horas
• Não pressionar ou manipular a área além da massagem orientada
• Manter hidratação adequada (mínimo 2 litros de água/dia)
• Comunicar imediatamente qualquer nódulo persistente, vermelhidão intensa ou dor crescente
• Retornar para avaliação conforme agendamento do protocolo

A não realização da massagem conforme orientado pode resultar em formação de nódulos e comprometimento do resultado, eximindo o profissional de responsabilidade pelo desfecho.

Cláusula 6 — FOTOGRAFIAS, LGPD E RESPONSABILIDADE
As fotografias clínicas registradas na ficha de avaliação são de uso exclusivo do prontuário, sem fins de divulgação, e ficam armazenadas com segurança conforme exigências da LGPD (Lei nº 13.709/2018).

A responsabilidade civil do profissional é subjetiva (art. 14, §4°, CDC e art. 951, CC), exigindo comprovação de culpa. O(a) paciente reconhece que resultados variam individualmente e que a adesão às orientações pós-procedimento é responsabilidade exclusiva do próprio paciente.

DECLARAÇÃO DE CONSENTIMENTO LIVRE E ESCLARECIDO
Declaro que li e compreendi integralmente este documento, fui informado(a) de forma clara e acessível sobre o procedimento de bioestimulação de colágeno, seus riscos, contraindicações, natureza progressiva dos resultados e obrigações pós-procedimento. Declaro não apresentar nenhuma das contraindicações listadas e que todas as informações fornecidas na ficha de avaliação são verdadeiras. Autorizo livremente a realização do procedimento de BIOESTIMULADOR DE COLÁGENO, consciente de que minha decisão é voluntária.`,
  },
  limpeza_pele: {
    title: 'Termo de Consentimento — Limpeza de Pele Profissional',
    content: `TERMO DE CONSENTIMENTO LIVRE E ESCLARECIDO
Autorização e Ciência de Riscos
LIMPEZA DE PELE PROFISSIONAL

Este documento tem por finalidade garantir que o(a) paciente recebeu informações completas, claras e em linguagem acessível sobre o procedimento de limpeza de pele profissional, seus objetivos, técnicas, riscos e cuidados necessários, em cumprimento ao dever de informação previsto no art. 6°, III, do Código de Defesa do Consumidor (Lei nº 8.078/1990) e aos princípios de bioética e boa prática profissional. A assinatura deste termo é condição para a realização do procedimento.

Cláusula 1 — DESCRIÇÃO DO PROCEDIMENTO
A limpeza de pele profissional é um procedimento estético não invasivo ou minimamente invasivo realizado por profissional habilitado, com o objetivo de promover a higienização profunda da pele, remoção de impurezas, sebo acumulado, células mortas (descamação) e desobstrução dos folículos pilossebáceos (cravos e comedões).

O procedimento pode incluir, conforme avaliação clínica: higienização com produto adequado ao tipo de pele; vapor de ozônio ou vaporizador facial; aplicação de esfoliante químico ou enzimático; extração manual ou com auxílio de equipamentos (comedão extrator, alta frequência); aplicação de máscara calmante, hidratante ou adstringente; finalização com hidratante e protetor solar.

A técnica específica utilizada será definida pelo profissional com base na avaliação clínica realizada na ficha de anamnese e avaliação de pele preenchida anteriormente.

Cláusula 2 — OBJETIVOS E RESULTADOS ESPERADOS
O procedimento visa: limpeza profunda dos poros, redução do acúmulo de comedões, melhora da textura e luminosidade da pele, redução da oleosidade excessiva e promoção do bem-estar cutâneo geral. Os resultados variam individualmente conforme o tipo de pele, grau de oleosidade, histórico de cuidados e adesão às orientações pós-procedimento. Não há garantia de resultado específico, pois procedimentos estéticos constituem obrigação de meio, e não de resultado.

Cláusula 3 — RISCOS, EFEITOS ESPERADOS E POSSÍVEIS INTERCORRÊNCIAS
O(a) paciente declara ter sido informado(a) sobre os seguintes efeitos e riscos inerentes ao procedimento:

Efeitos esperados e transitórios (normais após o procedimento):
• Vermelhidão (eritema) na área tratada, com duração de horas a 2 dias
• Leve edema (inchaço) transitório nas áreas extraídas
• Pequenas marcas ou pontos avermelhados no local das extrações
• Sensação de calor, ardência leve e sensibilidade aumentada
• Ressecamento passageiro após esfoliação
• Sensação de pele "tirante" nas primeiras 24 horas

Riscos menos comuns que podem ocorrer:
• Hiperpigmentação pós-inflamatória (manchas escuras), especialmente em fototipos altos (IV a VI)
• Reação alérgica a produtos utilizados durante o procedimento
• Reativação de herpes labial ou facial em portadores do vírus
• Infecção bacteriana por manipulação inadequada ou cuidado pós insuficiente
• Cicatrizes ou marcas persistentes em peles com tendência a queloides
• Piora temporária da acne (erupção pós-limpeza nas primeiras 48–72h)

IMPORTANTE
A piora temporária das lesões acneicas nas primeiras 48 horas após a limpeza é fenômeno comum (purging), pois o procedimento estimula a migração de impurezas para a superfície. Não configura erro profissional. Em caso de reação intensa ou prolongada, o paciente deve entrar em contato imediato com o profissional.

Cláusula 4 — CONTRAINDICAÇÕES E CONDIÇÕES QUE IMPEDEM O PROCEDIMENTO
O(a) paciente declara ter informado ao profissional sobre todas as condições de saúde e medicamentos em uso. O procedimento não deve ser realizado nas seguintes situações, que foram verificadas na ficha de avaliação:
• Uso de isotretinoína oral (Roacutan) durante o tratamento ou nos últimos 6 meses
• Feridas abertas, infecções ou inflamações ativas na área
• Acne grau IV com nódulos ou cistos extensos (adaptação do protocolo necessária)
• Uso recente de ácidos ou retinol sem suspensão adequada (mínimo 7 dias)
• Herpes labial ou facial ativa
• Gestação (especialmente 1° trimestre) ou amamentação
• Histórico de queloides na região facial
• Rosácea em crise com eritema intenso e difuso

Cláusula 5 — OBRIGAÇÕES E CUIDADOS PÓS-PROCEDIMENTO
O(a) paciente declara ter sido orientado(a) sobre os seguintes cuidados, assumindo o compromisso de segui-los:
• Não manipular, apertar ou coçar a pele nas primeiras 48 horas após o procedimento
• Aplicar protetor solar FPS 30 ou superior diariamente, inclusive em dias nublados, por pelo menos 15 dias
• Evitar exposição solar direta nas primeiras 72 horas
• Não utilizar maquiagem nas primeiras 24 horas
• Suspender o uso de retinol, ácidos e esfoliantes por no mínimo 7 dias após o procedimento
• Utilizar apenas os produtos indicados pelo profissional na rotina pós-procedimento
• Comunicar imediatamente o profissional em caso de reações intensas, prolongadas ou inesperadas
• Manter a próxima sessão conforme intervalo recomendado (mínimo 28 dias)

O descumprimento dessas orientações pode comprometer o resultado e/ou causar complicações, isentando o profissional de responsabilidade pelos efeitos decorrentes da não adesão.

Cláusula 6 — FOTOGRAFIAS E USO DE IMAGEM
As fotografias clínicas registradas na ficha de avaliação são de uso exclusivo do prontuário, sem fins de divulgação, e ficam armazenadas com segurança conforme exigências da LGPD.

Cláusula 7 — RESPONSABILIDADE E BASE LEGAL
O profissional responsável declara ter realizado avaliação clínica prévia, verificado as contraindicações, fornecido todas as informações relevantes e selecionado o protocolo mais adequado ao perfil do(a) paciente. A responsabilidade civil do profissional liberal é subjetiva, conforme o art. 14, §4°, do Código de Defesa do Consumidor e o art. 951 do Código Civil, exigindo comprovação de negligência, imprudência ou imperícia.

O(a) paciente reconhece que resultados estéticos dependem de fatores individuais fora do controle do profissional, incluindo genética, adesão aos cuidados domiciliares, hábitos de vida e resposta biológica individual.

DECLARAÇÃO DE CONSENTIMENTO LIVRE E ESCLARECIDO
Declaro que li ou tive este documento lido para mim em sua totalidade, compreendi todas as informações prestadas pelo(a) profissional responsável, tive a oportunidade de fazer perguntas e obtive respostas satisfatórias a todas elas. Fui informado(a) sobre a natureza do procedimento, seus objetivos, técnicas empregadas, riscos esperados, contraindicações verificadas e cuidados pós-procedimento necessários. Autorizo livremente a realização do procedimento de LIMPEZA DE PELE PROFISSIONAL, consciente de que minha decisão é voluntária, podendo ser revogada antes do início do procedimento sem qualquer ônus.`,
  },
  enzima: {
    title: 'Termo de Consentimento — Lipo de Papada (Enzima Lipolítica)',
    content: `TERMO DE CONSENTIMENTO LIVRE E ESCLARECIDO
Autorização e Ciência de Riscos
LIPO DE PAPADA · APLICAÇÃO DE ENZIMA LIPOLÍTICA SUBMENTONIANA

Por tratar-se de procedimento injetável invasivo com agente lipolítico, este termo possui relevância jurídica e clínica especial. O(a) paciente deve lê-lo integralmente antes de assinar. O consentimento assegura que foram prestadas informações completas sobre mecanismo de ação, riscos, contraindicações e efeitos pós-procedimento, em cumprimento ao art. 6°, III, CDC e à ética profissional aplicável.

Cláusula 1 — DESCRIÇÃO DO PROCEDIMENTO E MECANISMO DE AÇÃO
A lipo de papada por enzima lipolítica consiste na aplicação intradérmica e subcutânea de substâncias com ação lipolítica na região submentoniana (abaixo do queixo), com o objetivo de reduzir o acúmulo de gordura localizada e promover a definição da linha da mandíbula.

O produto indicado nesta sessão é: [ ] Fosfatidilcolina + Deoxicolato de Sódio   [ ] Deoxicolato de Sódio isolado   [ ] Outro: __________________________

O mecanismo de ação envolve a destruição da membrana dos adipócitos (células de gordura), com liberação do conteúdo lipídico que é subsequentemente metabolizado pelo organismo. Este processo gera uma resposta inflamatória local — fisiológica, esperada e necessária para o resultado terapêutico — que se manifesta como edema, calor, vermelhidão e endurecimento temporário da região.

Cláusula 2 — OBJETIVOS E EXPECTATIVAS REALISTAS
O procedimento visa a redução do volume de gordura submentoniana e melhora da definição do contorno mandibular. O(a) paciente foi informado(a) de que:
1. O resultado é progressivo e se torna visível após a resolução completa do edema, geralmente entre 3 e 6 semanas após cada sessão
2. O protocolo completo geralmente exige 2 a 4 sessões, com intervalo mínimo de 4 semanas entre elas
3. O procedimento trata gordura — não substitui tratamento de flacidez cutânea severa, que pode inclusive se acentuar caso a pele não tenha elasticidade adequada
4. A manutenção do resultado está diretamente relacionada ao estilo de vida: alimentação equilibrada e manutenção do peso
5. Não há garantia de resultado específico — o procedimento constitui obrigação de meio

Cláusula 3 — EFEITOS PÓS-PROCEDIMENTO ESPERADOS — LEIA COM ATENÇÃO

ATENÇÃO — EFEITOS INTENSOS SÃO NORMAIS E ESPERADOS
O edema pós-aplicação de enzima lipolítica submentoniana pode ser significativo e visível por 5 a 15 dias. Hematomas extensos são comuns. O endurecimento da região é esperado. Esses efeitos são parte do processo inflamatório lipolítico e não configuram erro ou complicação. O(a) paciente deve estar ciente antes de realizar o procedimento.

Efeitos esperados e transitórios:
• Edema (inchaço) intenso por 5 a 15 dias — pode parecer que a papada "aumentou"
• Calor, vermelhidão e sensação de ardência local por 24 a 72 horas
• Hematomas (equimoses) extensos na região submentoniana e pescoço
• Endurecimento e formação de nódulos transitórios que se dissolvem espontaneamente
• Dor e desconforto à palpação por até 2 semanas
• Sensação de dormência temporária na região (parestesia transitória)
• Dificuldade para engolir nos primeiros dias (raramente)
• Prurido (coceira) durante o processo de resolução inflamatória

Riscos menos comuns, porém possíveis:
• Nódulos persistentes que necessitam de tratamento específico (massagem, ultrassom ou corticóide)
• Alopecia (perda de pelo) na área tratada — transitória
• Infecção local
• Acentuação da flacidez em peles com baixa elasticidade
• Lesão temporária de ramo do nervo marginal da mandíbula — sorriso assimétrico transitório (resolve em semanas)
• Necrose cutânea por aplicação superficial inadequada
• Resultado assimétrico — corrigível em sessão de retoque
• Reação alérgica sistêmica (rara)

Cláusula 4 — CONTRAINDICAÇÕES CONFIRMADAS
O(a) paciente confirma que nenhuma das seguintes condições está presente, conforme declarado na ficha de avaliação:
• Gestação ou amamentação
• Doença hepática ativa
• Alergia a fosfatidilcolina ou deoxicolato de sódio
• Cirurgia na área nos últimos 6 meses
• Dislipidemia grave não controlada
• Histórico de trombose venosa profunda ou embolia
• Infecção ativa na região submentoniana
• Uso de anticoagulante oral sem suspensão médica autorizada

Cláusula 5 — CUIDADOS PÓS-PROCEDIMENTO OBRIGATÓRIOS
• Aplicar compressas frias (nunca gelo direto) nas primeiras 24 horas para reduzir o edema
• Não pressionar, esfregar ou massagear a região sem orientação específica do profissional
• Evitar atividade física intensa por 48 a 72 horas
• Não consumir álcool nas primeiras 48 horas
• Manter cabeça elevada ao dormir nas primeiras noites (evitar deitar com a cabeça completamente plana)
• Usar protetor solar FPS 50 na região submentoniana e pescoço diariamente
• Manter alimentação equilibrada e peso estável durante o protocolo
• Retornar ao profissional se notar assimetria persistente, nódulos endurecidos após 4 semanas ou sintomas neurológicos (assimetria do sorriso)
• Não realizar outros procedimentos na região por pelo menos 4 semanas

Cláusula 6 — FOTOGRAFIAS, LGPD E RESPONSABILIDADE CIVIL
A responsabilidade civil do profissional é subjetiva (art. 14, §4°, CDC). O(a) paciente reconhece que os efeitos pós-procedimento descritos neste documento são esperados e não constituem erro profissional, desde que ocorram dentro dos parâmetros clínicos normais. A não adesão às orientações pós-procedimento isenta o profissional de responsabilidade pelos efeitos decorrentes.

DECLARAÇÃO DE CONSENTIMENTO LIVRE E ESCLARECIDO
Declaro que recebi explicações claras e compreensíveis sobre o procedimento de lipo de papada por enzima lipolítica, incluindo seu mecanismo de ação, os efeitos pós-procedimento esperados (especialmente o edema intenso e os hematomas), os riscos possíveis, as contraindicações e os cuidados necessários. Confirmo que as informações prestadas na ficha de avaliação são verdadeiras e que não tenho nenhuma das contraindicações listadas. Fui informado(a) de que o resultado não é imediato e de que o sucesso do protocolo depende parcialmente da minha adesão aos cuidados. Autorizo livremente a realização do procedimento de LIPO DE PAPADA POR ENZIMA LIPOLÍTICA, consciente de todos os riscos e efeitos aqui descritos.`,
  },
  skinbooster: {
    title: 'Termo de Consentimento — Skinbooster',
    content: `TERMO DE CONSENTIMENTO LIVRE E ESCLARECIDO
Autorização e Ciência de Riscos
SKINBOOSTER · HIDRATAÇÃO PROFUNDA INTRADÉRMICA

Este documento assegura que o(a) paciente foi informado(a) de forma clara, completa e em linguagem compreensível sobre o procedimento de skinbooster, seus objetivos, técnica de aplicação, riscos e cuidados, em cumprimento ao art. 6°, III, do CDC (Lei nº 8.078/1990). Por tratar-se de procedimento injetável com ácido hialurônico não reticulado, o consentimento informado é condição obrigatória para sua realização.

Cláusula 1 — DESCRIÇÃO DO PROCEDIMENTO E SUBSTÂNCIA UTILIZADA
O skinbooster é um procedimento de hidratação profunda intradérmica que consiste na aplicação de ácido hialurônico não reticulado (de baixa viscosidade) diretamente na camada dérmica da pele, por meio de microinjeções. Diferentemente dos preenchedores volumizadores, o skinbooster não tem função de volumização — seu objetivo é promover hidratação profunda, melhora da qualidade da pele, luminosidade e uniformidade.

O produto indicado nesta sessão é: [ ] Profhilo   [ ] Restylane Skinbooster   [ ] Juvederm Volite   [ ] Outro: __________________________

A técnica de aplicação pode ser: [ ] Microbolhas intradérmicas   [ ] Pontos BAP (para Profhilo)   [ ] Retroinjeção linear   [ ] Combinada

Pode ser utilizado creme anestésico tópico previamente à aplicação para maior conforto do paciente.

Cláusula 2 — OBJETIVOS E RESULTADOS ESPERADOS
O procedimento visa: hidratação profunda e duradoura da pele, restauração do brilho e luminosidade, melhora da textura e elasticidade cutânea, suavização de linhas finas de desidratação e uniformização do tônus da pele. Para o Profhilo, há ainda efeito bioestimulador adicional sobre fibroblastos dérmicos.

Os resultados são progressivos: uma melhora inicial é perceptível após 2 a 4 semanas, com resultado pleno após completar o protocolo de 2 a 3 sessões (dependendo do produto). A durabilidade média é de 6 a 12 meses, variando com fatores individuais como tabagismo, exposição solar, hidratação e estilo de vida.

O procedimento constitui obrigação de meio, sem garantia de resultado específico.

Cláusula 3 — RISCOS, EFEITOS ESPERADOS E POSSÍVEIS INTERCORRÊNCIAS
Efeitos esperados e transitórios após a aplicação:
• Microedemas (bolinhas) no local das injeções — desaparecem em 24 a 72 horas
• Sensibilidade e leve dor à palpação nas primeiras 24 horas
• Leve edema facial transitório
• Vermelhidão difusa (eritema) que cede em horas a 2 dias
• Hematomas pontuais no local das punções — resolvem em 3 a 10 dias
• Sensação de pressão ou "peso" na área tratada nas primeiras 48 horas

Riscos menos comuns, porém possíveis:
• Reação alérgica ao ácido hialurônico ou à lidocaína (se produto com anestésico)
• Nódulos palpáveis transitórios — geralmente se resolvem espontaneamente
• Hiperpigmentação pós-inflamatória em fototipos mais altos (IV a VI)
• Infecção local por manipulação inadequada ou falha na assepsia
• Reativação de herpes labial ou facial em portadores do vírus
• Oclusão vascular (extremamente raro) — emergência clínica com protocolo de reversão com hialuronidase
• Resultado abaixo do esperado em peles com comprometimento severo
• Efeito Tyndall — tonalidade azulada em aplicação muito superficial (corrigível)

Cláusula 4 — CONTRAINDICAÇÕES CONFIRMADAS
O(a) paciente confirma que as seguintes condições foram verificadas e nenhuma está presente no momento do procedimento:
• Gestação ou amamentação
• Uso de isotretinoína oral (Roacutan) em qualquer dose
• Herpes ativa na área de tratamento
• Doença autoimune ativa não controlada
• Alergia a ácido hialurônico ou lidocaína
• Acne inflamada ativa e extensa na área de aplicação
• Infecção ou ferida aberta na região
• Uso de anticoagulante oral sem suspensão médica autorizada

PORTADORES DE HERPES
Pacientes com histórico de herpes labial ou facial recorrente devem informar o profissional. A profilaxia com antiviral oral pode ser necessária antes do procedimento para evitar reativação. Esta decisão deve ser tomada em conjunto com o médico responsável.

Cláusula 5 — CUIDADOS PÓS-PROCEDIMENTO
• Não tocar, pressionar ou massagear a área tratada nas primeiras 6 horas
• Não aplicar maquiagem nas primeiras 24 horas
• Aplicar protetor solar FPS 50 diariamente, incluindo nos dias sem sol
• Evitar exposição solar direta e calor excessivo (sauna, banho quente prolongado) por 48 horas
• Evitar atividade física intensa nas primeiras 24 horas
• Manter hidratação adequada — beber pelo menos 2 litros de água por dia
• Suspender retinol e ácidos por 5 dias antes e após o procedimento
• Comunicar imediatamente o profissional em caso de dor crescente, calor intenso, palidez ou alteração de coloração na área — sinais de possível oclusão vascular (emergência)
• Retornar conforme protocolo agendado para avaliação e próxima sessão

Cláusula 6 — REVERSIBILIDADE E DISSOLUÇÃO COM HIALURONIDASE
O ácido hialurônico utilizado no skinbooster é reversível — pode ser dissolvido com a aplicação de hialuronidase, enzima que quebra a molécula de hialurônico. Em casos de resultado insatisfatório, nódulos persistentes ou, principalmente, em emergência vascular, a dissolução pode ser realizada pelo profissional habilitado.

O(a) paciente declara ter sido informado(a) sobre esta possibilidade e sobre o protocolo de emergência disponível em caso de intercorrência vascular.

Cláusula 7 — FOTOGRAFIAS, LGPD E RESPONSABILIDADE
A responsabilidade do profissional é subjetiva (art. 14, §4°, CDC e art. 951, CC). O resultado estético final é influenciado por fatores individuais biológicos e comportamentais, incluindo tabagismo, hidratação, qualidade do sono e exposição solar, que estão fora do controle do profissional. A não adesão às orientações pós-procedimento isenta o profissional de responsabilidade pelos efeitos decorrentes.

DECLARAÇÃO DE CONSENTIMENTO LIVRE E ESCLARECIDO
Declaro que li e compreendi integralmente este documento, recebi do(a) profissional responsável informações claras sobre o skinbooster — seu mecanismo de ação, objetivos, efeitos esperados, riscos, contraindicações, reversibilidade com hialuronidase e cuidados pós-procedimento. Confirmo que as informações fornecidas na ficha de avaliação são verdadeiras, que não tenho nenhuma das contraindicações listadas e que tive a oportunidade de esclarecer todas as minhas dúvidas. Autorizo livremente a realização do procedimento de SKINBOOSTER, consciente de todos os riscos e efeitos aqui descritos, e de que o resultado não é imediato nem garantido.`,
  },
  microagulhamento: {
    title: 'Termo de Consentimento — Microagulhamento (Indução Percutânea de Colágeno)',
    content: `TERMO DE CONSENTIMENTO LIVRE E ESCLARECIDO
Autorização e Ciência de Riscos
MICROAGULHAMENTO · INDUÇÃO PERCUTÂNEA DE COLÁGENO (IPC)

Por tratar-se de procedimento invasivo com perfuração da barreira cutânea, este Termo de Consentimento Informado possui relevância jurídica e clínica elevada. O(a) paciente deve lê-lo integralmente antes de assinar. O consentimento assegura que foram prestadas informações completas, claras e acessíveis sobre o microagulhamento, em cumprimento ao art. 6°, III, do Código de Defesa do Consumidor (Lei nº 8.078/1990) e às normas de ética e boa prática profissional aplicáveis.

Cláusula 1 — DESCRIÇÃO DO PROCEDIMENTO E MECANISMO DE AÇÃO
O microagulhamento (Indução Percutânea de Colágeno — IPC) é um procedimento estético minimamente invasivo que consiste na criação de microcanais na pele por meio de um dispositivo com microagulhas (dermaroller, dermapen ou dispositivo similar) de comprimento variável (0,25 mm a 2,5 mm), calibrado conforme o objetivo terapêutico e a região a ser tratada.

O mecanismo de ação baseia-se na lesão controlada da derme, que desencadeia uma cascata de cicatrização natural com liberação de fatores de crescimento e síntese de colágeno tipo I, III e elastina. Os microcanais criados também permitem a penetração de ativos tópicos em profundidade superior à absorção passiva (drug delivery), potencializando os efeitos dos produtos aplicados durante o procedimento.

O procedimento é realizado com anestesia tópica (creme anestésico aplicado previamente). O dispositivo, a profundidade e o número de passagens são definidos pelo profissional com base na avaliação clínica individual.

Cláusula 2 — OBJETIVOS TERAPÊUTICOS E NATUREZA DOS RESULTADOS
O microagulhamento pode ser indicado para: rejuvenescimento facial global, tratamento de cicatrizes de acne atróficas, redução de poros dilatados, melhora de textura e luminosidade, tratamento de estrias, uniformização de manchas e discromias, tratamento de alopecia androgenética e melhora da absorção de ativos tópicos.

Os resultados são progressivos e cumulativos: cada sessão estimula um ciclo de neocolagênese que se completa em 4 a 6 semanas. O resultado pleno do protocolo se evidencia após a conclusão de todas as sessões recomendadas e continua a amadurecer por 3 a 6 meses adicionais. O protocolo padrão varia de 3 a 6 sessões, com intervalo de 4 a 6 semanas, dependendo da indicação.

O procedimento constitui obrigação de meio — não há garantia de resultado específico, pois a resposta biológica individual varia conforme genética, saúde sistêmica, adesão ao pós-procedimento e fatores de estilo de vida.

Cláusula 3 — EFEITOS ESPERADOS E RISCOS DO PROCEDIMENTO
Efeitos normais e esperados após o procedimento:
• Eritema (vermelhidão) intensa nas primeiras 24–48h — semelhante à queimadura solar leve
• Sensação de ardência, calor e sensibilidade aumentada por 24 a 48h
• Micropontos de sangramento durante a aplicação (profundidades acima de 1 mm)
• Edema (inchaço) leve a moderado, especialmente ao redor dos olhos, nas primeiras 24–72h
• Descamação fina da pele entre 2 e 5 dias após o procedimento
• Ressecamento temporário da pele durante a fase de descamação

Riscos menos comuns, porém possíveis:
• Hiperpigmentação pós-inflamatória (HPI) — especialmente em fototipos IV a VI e exposição solar precoce pós-procedimento
• Infecção bacteriana por falha na assepsia ou cuidados domiciliares inadequados
• Reação alérgica a ativos aplicados durante o procedimento
• Piora temporária do melasma se exposição solar ocorrer no pós-procedimento
• Reativação de herpes labial ou facial em portadores — profilaxia antiviral pode ser necessária
• Formação de queloides ou cicatrizes hipertróficas em pacientes predispostos
• Mília (pequenos cistos brancos) transitórios pela regeneração cutânea
• Resultado abaixo da expectativa, especialmente em cicatrizes muito profundas ou antigas

ATENÇÃO — MELASMA E MICROAGULHAMENTO
Pacientes com melasma devem ser informados que o microagulhamento pode provocar piora temporária do melasma se a inflamação pós-procedimento não for controlada adequadamente. O protocolo deve incluir pré-condicionamento com despigmentantes e proteção solar rigorosa. A decisão de tratar melasma com microagulhamento exige avaliação cuidadosa e expectativas realistas.

Cláusula 4 — CONTRAINDICAÇÕES VERIFICADAS E CONFIRMADAS
O(a) paciente confirma que as seguintes condições foram verificadas na ficha de avaliação e que nenhuma está presente no momento do procedimento:
• Gestação ou amamentação
• Acne ativa severa com nódulos e cistos extensos na área
• Ferida aberta, infecção ativa ou inflamação aguda na área
• Distúrbio de coagulação ou uso de anticoagulante oral
• Exposição solar intensa nos últimos 15 dias
• Uso de isotretinoína oral durante o tratamento ou nos últimos 6 meses
• Herpes ativa na área de tratamento
• Histórico de queloides ou cicatrizes hipertróficas na área
• Doença autoimune ativa não controlada
• Uso de retinol, tretinoína ou ácidos sem suspensão mínima de 7 dias

Cláusula 5 — BIOSSEGURANÇA E DESCARTE DE MATERIAL
O(a) paciente declara ter sido informado(a) de que:
1. Todo material perfurocortante (agulhas, cartuchos de dermapen) utilizado é descartável e de uso único, sendo descartado após cada sessão em conformidade com as normas da ANVISA para resíduos de serviços de saúde
2. O profissional utilizará equipamento de proteção individual (EPI) durante o procedimento
3. A área de tratamento será devidamente higienizada antes e após o procedimento com produtos antissépticos adequados
4. Em caso de portadores de doenças transmissíveis (HIV, Hepatite B/C), o protocolo de biossegurança será reforçado, sem qualquer discriminação ou prejuízo ao atendimento

Cláusula 6 — CUIDADOS PÓS-PROCEDIMENTO OBRIGATÓRIOS
O(a) paciente declara ter sido orientado(a) sobre os seguintes cuidados e assume o compromisso de segui-los:
• Não tocar, esfregar ou coçar a pele nas primeiras 24 horas
• Não aplicar maquiagem nas primeiras 24 a 48 horas (conforme orientação do profissional)
• Usar apenas os produtos indicados pelo profissional nos primeiros 5 dias — nada além do que foi prescrito
• Aplicar protetor solar FPS 50 ou superior obrigatoriamente a partir do dia seguinte, todos os dias, reaplicando a cada 2 horas em exposição solar
• Evitar exposição solar direta por no mínimo 15 dias após o procedimento
• Evitar sauna, banho quente prolongado e atividade física intensa nas primeiras 48 horas
• Suspender retinol, ácidos e esfoliantes por no mínimo 7 dias após o procedimento
• Manter hidratação facial com o produto indicado, mesmo que a pele esteja oleosa
• Não realizar outros procedimentos na área por no mínimo 4 semanas
• Comunicar imediatamente o profissional em caso de sinais de infecção (dor crescente, pus, vermelhidão progressiva), herpes reativada ou qualquer reação inesperada
• Retornar para avaliação e próxima sessão conforme protocolo agendado

O descumprimento dessas orientações — especialmente a proteção solar — pode causar hiperpigmentação pós-inflamatória e comprometer o resultado, eximindo o profissional de responsabilidade pelos efeitos decorrentes da não adesão.

Cláusula 7 — FOTOGRAFIAS, LGPD E PROTEÇÃO DE DADOS
Em caso de autorização, garanto que dados de identificação (nome, CPF, rosto reconhecível sem consentimento específico) não serão expostos sem nova autorização expressa, em conformidade com a LGPD — Lei nº 13.709/2018. As fotografias clínicas do prontuário são de uso exclusivo do registro médico/estético, com armazenamento seguro.

Cláusula 8 — RESPONSABILIDADE CIVIL E BASE LEGAL
O profissional responsável declara ter: realizado avaliação clínica prévia completa; verificado todas as contraindicações; informado o(a) paciente sobre o procedimento, seus riscos e cuidados necessários; e selecionado o protocolo mais adequado ao perfil individual do(a) paciente. A responsabilidade civil do profissional liberal é subjetiva, nos termos do art. 14, §4°, do CDC e do art. 951 do Código Civil, exigindo comprovação de negligência, imprudência ou imperícia.

O(a) paciente reconhece que: (i) os efeitos transitórios descritos na Cláusula 3 são esperados e não configuram erro profissional; (ii) resultados variam individualmente; (iii) a não adesão às orientações pós-procedimento é de sua exclusiva responsabilidade.

DECLARAÇÃO DE CONSENTIMENTO LIVRE E ESCLARECIDO
Declaro que li integralmente este documento ou tive seu conteúdo explicado em linguagem acessível pelo(a) profissional responsável. Compreendi o mecanismo de ação do microagulhamento, seus objetivos, os efeitos esperados após o procedimento (vermelhidão, descamação, sensibilidade), os riscos possíveis listados — incluindo hiperpigmentação pós-inflamatória em meu fototipo, risco de reativação de herpes e formação de queloides —, as contraindicações verificadas, o protocolo de biossegurança e os cuidados pós-procedimento obrigatórios. Confirmo que todas as informações fornecidas na ficha de avaliação são verdadeiras e que não tenho nenhuma das contraindicações listadas. Tive a oportunidade de fazer perguntas e fui respondido(a) de forma satisfatória. Autorizo livremente a realização do procedimento de MICROAGULHAMENTO (INDUÇÃO PERCUTÂNEA DE COLÁGENO), consciente de todos os riscos aqui descritos e de que o resultado é progressivo e influenciado por fatores individuais e comportamentais.`,
  },
  service_contract: {
    title: 'Contrato de Prestação de Serviços Estéticos',
    content: `CONTRATO DE PRESTAÇÃO DE SERVIÇOS

Pelo presente instrumento, {{nome_paciente}}, CPF {{cpf_paciente}}, declara que contrata os serviços estéticos descritos abaixo, prestados pela clínica {{clinica}}, sob responsabilidade do(a) profissional {{profissional}}.

1. PROCEDIMENTOS CONTRATADOS
{{procedimentos}}

2. PRODUTOS A SEREM UTILIZADOS
{{produtos}}

3. VALOR E FORMA DE PAGAMENTO
Valor total: {{valor_total}}
Forma de pagamento: {{forma_pagamento}}
{{parcelas}}

4. OBRIGAÇÕES DO CONTRATANTE
O(a) contratante se compromete a:
a) Comparecer nas datas e horários agendados;
b) Seguir todas as orientações pré e pós-procedimento;
c) Informar sobre qualquer condição de saúde relevante;
d) Efetuar o pagamento conforme acordado.

5. OBRIGAÇÕES DO CONTRATADO
A clínica se compromete a:
a) Realizar os procedimentos conforme descrito, utilizando produtos de qualidade e dentro da validade;
b) Fornecer todas as orientações necessárias ao paciente;
c) Manter sigilo sobre as informações do paciente.

6. CANCELAMENTO E REAGENDAMENTO
Em caso de cancelamento com menos de 24 horas de antecedência, poderá ser cobrada taxa de até 20% do valor do procedimento. Reagendamentos podem ser feitos com até 24 horas de antecedência sem custo adicional.

7. DISPOSIÇÕES GERAIS
Este contrato é regido pelas leis brasileiras. Eventuais disputas serão resolvidas no foro da comarca da clínica.

Data: {{data}}`,
  },
} as const
