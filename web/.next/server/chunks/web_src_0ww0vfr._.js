module.exports=[633854,e=>{"use strict";var o=e.i(69217),a=e.i(552692),t=e.i(880285),s=e.i(650111),n=e.i(524303),i=e.i(636108);async function r(e){let o=new TextEncoder().encode(e);return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",o))).map(e=>e.toString(16).padStart(2,"0")).join("")}async function c(e){return(await o.db.select().from(a.consentTemplates).where((0,t.and)((0,t.eq)(a.consentTemplates.tenantId,e),(0,t.eq)(a.consentTemplates.isActive,!0))).orderBy(a.consentTemplates.type,(0,s.desc)(a.consentTemplates.version))).reduce((e,o)=>(e[o.type]||(e[o.type]=[]),e[o.type].push(o),e),{})}async function d(e,s){let[n]=await o.db.select().from(a.consentTemplates).where((0,t.and)((0,t.eq)(a.consentTemplates.id,s),(0,t.eq)(a.consentTemplates.tenantId,e))).limit(1);return n??null}async function m(e,t){let[s]=await o.db.insert(a.consentTemplates).values({tenantId:e,type:t.type,title:t.title,content:t.content,version:1,isActive:!0}).returning();return s}async function x(e,o,s){let i=await d(e,o);if(!i)throw Error("Termo não encontrado");return(0,n.withTransaction)(async n=>{await n.update(a.consentTemplates).set({isActive:!1,updatedAt:new Date}).where((0,t.and)((0,t.eq)(a.consentTemplates.id,o),(0,t.eq)(a.consentTemplates.tenantId,e)));let[r]=await n.insert(a.consentTemplates).values({tenantId:e,type:i.type,title:s.title??i.title,content:s.content,version:i.version+1,isActive:!0}).returning();return r})}async function l(e,t,s){await Promise.all([(0,i.verifyTenantOwnership)(e,a.patients,t.patientId,"Patient"),...t.procedureRecordId?[(0,i.verifyTenantOwnership)(e,a.procedureRecords,t.procedureRecordId,"Procedure record")]:[]]);let n=await d(e,t.consentTemplateId);if(!n)throw Error("Termo não encontrado");let c="service_contract"===n.type&&s.renderedContent?s.renderedContent:n.content,m=await r(c),[x]=await o.db.insert(a.consentAcceptances).values({tenantId:e,patientId:t.patientId,consentTemplateId:t.consentTemplateId,procedureRecordId:t.procedureRecordId??null,acceptanceMethod:t.acceptanceMethod,signatureData:t.signatureData??null,contentHash:m,contentSnapshot:c,acceptedAt:new Date,ipAddress:s.ipAddress??null,userAgent:s.userAgent??null}).returning();return x}async function p(e,n){return await o.db.select({id:a.consentAcceptances.id,acceptanceMethod:a.consentAcceptances.acceptanceMethod,signatureData:a.consentAcceptances.signatureData,contentHash:a.consentAcceptances.contentHash,contentSnapshot:a.consentAcceptances.contentSnapshot,acceptedAt:a.consentAcceptances.acceptedAt,procedureRecordId:a.consentAcceptances.procedureRecordId,templateTitle:a.consentTemplates.title,templateType:a.consentTemplates.type,templateVersion:a.consentTemplates.version}).from(a.consentAcceptances).innerJoin(a.consentTemplates,(0,t.eq)(a.consentAcceptances.consentTemplateId,a.consentTemplates.id)).where((0,t.and)((0,t.eq)(a.consentAcceptances.tenantId,e),(0,t.eq)(a.consentAcceptances.patientId,n))).orderBy((0,s.desc)(a.consentAcceptances.acceptedAt))}async function u(e,n,i,r){let[c]=await o.db.select({id:a.consentAcceptances.id,acceptedAt:a.consentAcceptances.acceptedAt,acceptanceMethod:a.consentAcceptances.acceptanceMethod,templateTitle:a.consentTemplates.title,templateType:a.consentTemplates.type}).from(a.consentAcceptances).innerJoin(a.consentTemplates,(0,t.eq)(a.consentAcceptances.consentTemplateId,a.consentTemplates.id)).where((0,t.and)((0,t.eq)(a.consentAcceptances.tenantId,e),(0,t.eq)(a.consentAcceptances.patientId,n),(0,t.eq)(a.consentAcceptances.procedureRecordId,i),(0,t.eq)(a.consentTemplates.type,r))).orderBy((0,s.desc)(a.consentAcceptances.acceptedAt)).limit(1);return c??null}e.s(["acceptConsent",0,l,"createConsentTemplate",0,m,"getConsentForProcedure",0,u,"getConsentHistory",0,p,"getConsentTemplateById",0,d,"listConsentTemplates",0,c,"updateConsentTemplate",0,x])},786939,e=>{"use strict";var o=e.i(78091);let a=o.z.object({type:o.z.enum(["general","botox","filler","biostimulator","custom","service_contract"],{message:"Tipo de consentimento é obrigatório"}),title:o.z.string().min(3,"Título deve ter no mínimo 3 caracteres").max(255,"Título deve ter no máximo 255 caracteres"),content:o.z.string().min(10,"Conteúdo deve ter no mínimo 10 caracteres")}),t=o.z.object({patientId:o.z.string().uuid("ID do paciente inválido"),consentTemplateId:o.z.string().uuid("ID do termo inválido"),procedureRecordId:o.z.string().uuid("ID do procedimento inválido").optional(),acceptanceMethod:o.z.enum(["checkbox","signature","both"],{message:"Método de aceite é obrigatório"}),signatureData:o.z.string().optional()}).refine(e=>"signature"!==e.acceptanceMethod&&"both"!==e.acceptanceMethod||!!e.signatureData&&e.signatureData.startsWith("data:image/"),{message:"Assinatura é obrigatória para este método de aceite",path:["signatureData"]}),s={general:{title:"Termo de Consentimento Livre e Esclarecido — Procedimentos Estéticos",content:`TERMO DE CONSENTIMENTO LIVRE E ESCLARECIDO — PROCEDIMENTOS EST\xc9TICOS
Eu, paciente abaixo identificado(a), declaro que fui devidamente informado(a) pelo(a) profissional respons\xe1vel sobre o procedimento est\xe9tico ao qual serei submetido(a), incluindo:

1. NATUREZA DO PROCEDIMENTO
Fui informado(a) sobre a natureza, os objetivos, os benef\xedcios esperados e as poss\xedveis alternativas ao procedimento proposto.

2. RISCOS E COMPLICA\xc7\xd5ES
Compreendo que todo procedimento est\xe9tico envolve riscos, incluindo, mas n\xe3o se limitando a: dor, incha\xe7o, hematomas, infec\xe7\xe3o, rea\xe7\xf5es al\xe9rgicas, assimetria, resultados insatisfat\xf3rios, necrose tecidual e, em casos raros, complica\xe7\xf5es mais graves.

3. CUIDADOS PR\xc9 E P\xd3S-PROCEDIMENTO
Recebi orienta\xe7\xf5es sobre os cuidados necess\xe1rios antes e ap\xf3s o procedimento, e me comprometo a segui-los integralmente.

4. RESULTADOS
Compreendo que os resultados podem variar de pessoa para pessoa e que o(a) profissional n\xe3o pode garantir resultados espec\xedficos.

5. FOTOGRAFIAS
Autorizo o registro fotogr\xe1fico para fins de acompanhamento cl\xednico e documenta\xe7\xe3o do prontu\xe1rio. As imagens n\xe3o ser\xe3o utilizadas para fins comerciais ou publicit\xe1rios sem minha autoriza\xe7\xe3o expressa.

6. DIREITO DE REVOGA\xc7\xc3O
Estou ciente de que posso revogar este consentimento a qualquer momento antes da realiza\xe7\xe3o do procedimento.

7. ESCLARECIMENTO DE D\xdaVIDAS
Declaro que todas as minhas d\xfavidas foram esclarecidas e que tive tempo suficiente para considerar minha decis\xe3o.

Ao aceitar este termo, confirmo que li, compreendi e concordo com todas as informa\xe7\xf5es acima.`},botox:{title:"Termo de Consentimento — Toxina Botulínica",content:`TERMO DE CONSENTIMENTO — APLICA\xc7\xc3O DE TOXINA BOTUL\xcdNICA
Eu, paciente abaixo identificado(a), declaro que fui devidamente informado(a) sobre o procedimento de aplica\xe7\xe3o de toxina botul\xednica tipo A, e que compreendo os seguintes aspectos:

1. O PROCEDIMENTO
A toxina botul\xednica \xe9 uma prote\xedna purificada que, quando injetada em pequenas doses nos m\xfasculos faciais, promove o relaxamento tempor\xe1rio da musculatura, atenuando rugas e linhas de express\xe3o din\xe2micas.

2. INDICA\xc7\xd5ES
O procedimento est\xe1 sendo realizado para tratamento de linhas de express\xe3o e/ou rugas din\xe2micas nas regi\xf5es indicadas pelo(a) profissional.

3. RISCOS E EFEITOS COLATERAIS
Fui informado(a) sobre os poss\xedveis efeitos colaterais, incluindo:
• Dor leve no local da aplica\xe7\xe3o
• Hematomas e equimoses tempor\xe1rios
• Edema (incha\xe7o) localizado
• Cefaleia (dor de cabe\xe7a) transit\xf3ria
• Ptose palpebral (queda tempor\xe1ria da p\xe1lpebra) — raro
• Assimetria facial tempor\xe1ria
• Resultados aqu\xe9m do esperado
• Rea\xe7\xe3o al\xe9rgica — raro
• Sensa\xe7\xe3o de peso ou rigidez na regi\xe3o tratada

4. CONTRAINDICA\xc7\xd5ES
Declaro que informei ao profissional sobre todas as condi\xe7\xf5es m\xe9dicas relevantes, incluindo: gesta\xe7\xe3o, amamenta\xe7\xe3o, doen\xe7as neuromusculares (miastenia gravis, esclerose lateral amiotr\xf3fica), uso de aminoglicos\xeddeos ou anticoagulantes, alergia a componentes da f\xf3rmula.

5. DURA\xc7\xc3O DO EFEITO
Compreendo que o efeito da toxina botul\xednica \xe9 tempor\xe1rio, com dura\xe7\xe3o m\xe9dia de 3 a 6 meses, podendo variar conforme o metabolismo individual, e que sess\xf5es de manuten\xe7\xe3o ser\xe3o necess\xe1rias.

6. P\xd3S-PROCEDIMENTO
Recebi orienta\xe7\xf5es sobre os cuidados p\xf3s-procedimento:
• N\xe3o deitar nas primeiras 4 horas
• N\xe3o massagear a regi\xe3o tratada
• Evitar atividade f\xedsica intensa nas primeiras 24 horas
• N\xe3o consumir \xe1lcool nas primeiras 24 horas
• Retornar para avalia\xe7\xe3o em 15 dias

Ao aceitar este termo, confirmo que li, compreendi e concordo com todas as informa\xe7\xf5es acima.`},filler:{title:"Termo de Consentimento — Preenchedor / Ácido Hialurônico",content:`TERMO DE CONSENTIMENTO — PREENCHIMENTO COM \xc1CIDO HIALUR\xd4NICO
Eu, paciente abaixo identificado(a), declaro que fui devidamente informado(a) sobre o procedimento de preenchimento com \xe1cido hialur\xf4nico, e que compreendo os seguintes aspectos:

1. O PROCEDIMENTO
O \xe1cido hialur\xf4nico \xe9 um polissacar\xeddeo biocompat\xedvel e biodegrad\xe1vel, naturalmente presente no organismo humano. Quando injetado na pele ou tecido subcut\xe2neo, promove preenchimento, volumiza\xe7\xe3o e/ou hidrata\xe7\xe3o da regi\xe3o tratada.

2. INDICA\xc7\xd5ES
O procedimento est\xe1 sendo realizado para: preenchimento de sulcos, restaura\xe7\xe3o de volume facial, contorno e defini\xe7\xe3o de estruturas faciais e/ou melhora da qualidade da pele, conforme avalia\xe7\xe3o do(a) profissional.

3. RISCOS E EFEITOS COLATERAIS
Fui informado(a) sobre os poss\xedveis efeitos colaterais, incluindo:
• Dor e desconforto durante e ap\xf3s a aplica\xe7\xe3o
• Edema (incha\xe7o) — comum nos primeiros dias
• Hematomas e equimoses — comuns, resolvem em 7 a 14 dias
• Eritema (vermelhid\xe3o) no local
• N\xf3dulos palp\xe1veis ou vis\xedveis
• Assimetria
• Migra\xe7\xe3o do produto
• Efeito Tyndall (colora\xe7\xe3o azulada quando injetado superficialmente)
• Infec\xe7\xe3o — raro
• Rea\xe7\xe3o granulomatosa — raro
• Compress\xe3o ou oclus\xe3o vascular — raro, mas potencialmente grave, podendo levar a necrose tecidual ou comprometimento visual
• Rea\xe7\xe3o al\xe9rgica — raro

4. CONTRAINDICA\xc7\xd5ES
Declaro que informei sobre todas as condi\xe7\xf5es relevantes, incluindo: gesta\xe7\xe3o, amamenta\xe7\xe3o, doen\xe7as autoimunes, uso de imunossupressores, infec\xe7\xf5es ativas na regi\xe3o, alergia a \xe1cido hialur\xf4nico, uso de anticoagulantes, hist\xf3rico de herpes na regi\xe3o facial.

5. DURA\xc7\xc3O DO EFEITO
Compreendo que o efeito do preenchimento com \xe1cido hialur\xf4nico \xe9 tempor\xe1rio, com dura\xe7\xe3o m\xe9dia de 6 a 18 meses, variando conforme o produto utilizado, a regi\xe3o tratada e o metabolismo individual.

6. DISSOLU\xc7\xc3O
Fui informado(a) de que o \xe1cido hialur\xf4nico pode ser dissolvido com a enzima hialuronidase em caso de complica\xe7\xf5es ou resultados indesejados.

7. P\xd3S-PROCEDIMENTO
Recebi orienta\xe7\xf5es sobre os cuidados p\xf3s-procedimento:
• Aplicar compressas frias nas primeiras 24 horas
• N\xe3o massagear a regi\xe3o, salvo orienta\xe7\xe3o espec\xedfica do profissional
• Evitar exposi\xe7\xe3o solar intensa por 48 horas
• Evitar atividade f\xedsica intensa nas primeiras 24 horas
• Comunicar imediatamente qualquer sinal de dor intensa, altera\xe7\xe3o de cor da pele ou comprometimento visual

Ao aceitar este termo, confirmo que li, compreendi e concordo com todas as informa\xe7\xf5es acima.`},biostimulator:{title:"Termo de Consentimento — Bioestimulador de Colágeno",content:`TERMO DE CONSENTIMENTO — BIOESTIMULADOR DE COL\xc1GENO
Eu, paciente abaixo identificado(a), declaro que fui devidamente informado(a) sobre o procedimento de aplica\xe7\xe3o de bioestimulador de col\xe1geno, e que compreendo os seguintes aspectos:

1. O PROCEDIMENTO
Os bioestimuladores de col\xe1geno s\xe3o subst\xe2ncias injet\xe1veis que estimulam a produ\xe7\xe3o natural de col\xe1geno pelo organismo. Diferentemente dos preenchedores, seu objetivo principal \xe9 melhorar a qualidade e firmeza da pele ao longo do tempo, atrav\xe9s da neocolag\xeanese (forma\xe7\xe3o de novo col\xe1geno).

2. SUBST\xc2NCIAS UTILIZADAS
Os bioestimuladores mais comuns incluem: \xe1cido poli-L-l\xe1ctico (PLLA), hidroxiapatita de c\xe1lcio (CaHA) e policaprolactona (PCL). O(a) profissional me informou sobre a subst\xe2ncia espec\xedfica que ser\xe1 utilizada no meu tratamento.

3. INDICA\xc7\xd5ES
O procedimento est\xe1 sendo realizado para: tratamento de flacidez cut\xe2nea, melhora da qualidade da pele, restaura\xe7\xe3o de volume perdido pelo envelhecimento e/ou est\xedmulo de col\xe1geno, conforme avalia\xe7\xe3o do(a) profissional.

4. RISCOS E EFEITOS COLATERAIS
Fui informado(a) sobre os poss\xedveis efeitos colaterais, incluindo:
• Dor e desconforto durante e ap\xf3s a aplica\xe7\xe3o
• Edema (incha\xe7o) — comum nos primeiros dias
• Hematomas e equimoses
• Eritema (vermelhid\xe3o)
• N\xf3dulos subcut\xe2neos — podem ocorrer e geralmente s\xe3o resolvidos com massagem
• Assimetria
• Granulomas — raro
• Infec\xe7\xe3o — raro
• Rea\xe7\xe3o al\xe9rgica — raro
• Migra\xe7\xe3o do produto — raro

5. CONTRAINDICA\xc7\xd5ES
Declaro que informei sobre todas as condi\xe7\xf5es relevantes, incluindo: gesta\xe7\xe3o, amamenta\xe7\xe3o, doen\xe7as autoimunes, uso de imunossupressores, infec\xe7\xf5es ativas, doen\xe7as do col\xe1geno, tend\xeancia a cicatrizes queloides, alergia a componentes da f\xf3rmula.

6. EXPECTATIVA DE RESULTADOS
Compreendo que:
• Os resultados do bioestimulador s\xe3o graduais e progressivos, podendo levar de 30 a 90 dias para se manifestar
• M\xfaltiplas sess\xf5es podem ser necess\xe1rias para atingir o resultado desejado
• Os resultados s\xe3o duradouros (12 a 24 meses), mas n\xe3o permanentes
• A resposta individual varia conforme idade, qualidade da pele e estilo de vida

7. P\xd3S-PROCEDIMENTO
Recebi orienta\xe7\xf5es sobre os cuidados p\xf3s-procedimento:
• Realizar massagens na regi\xe3o tratada conforme orienta\xe7\xe3o do profissional (especialmente para PLLA)
• Evitar exposi\xe7\xe3o solar intensa por 48 horas
• Evitar atividade f\xedsica intensa nas primeiras 24 a 48 horas
• Manter hidrata\xe7\xe3o adequada
• Retornar para avalia\xe7\xe3o conforme agendamento

Ao aceitar este termo, confirmo que li, compreendi e concordo com todas as informa\xe7\xf5es acima.`},service_contract:{title:"Contrato de Prestação de Serviços Estéticos",content:`CONTRATO DE PRESTA\xc7\xc3O DE SERVI\xc7OS

Pelo presente instrumento, {{nome_paciente}}, CPF {{cpf_paciente}}, declara que contrata os servi\xe7os est\xe9ticos descritos abaixo, prestados pela cl\xednica {{clinica}}, sob responsabilidade do(a) profissional {{profissional}}.

1. PROCEDIMENTOS CONTRATADOS
{{procedimentos}}

2. PRODUTOS A SEREM UTILIZADOS
{{produtos}}

3. VALOR E FORMA DE PAGAMENTO
Valor total: {{valor_total}}
Forma de pagamento: {{forma_pagamento}}
{{parcelas}}

4. OBRIGA\xc7\xd5ES DO CONTRATANTE
O(a) contratante se compromete a:
a) Comparecer nas datas e hor\xe1rios agendados;
b) Seguir todas as orienta\xe7\xf5es pr\xe9 e p\xf3s-procedimento;
c) Informar sobre qualquer condi\xe7\xe3o de sa\xfade relevante;
d) Efetuar o pagamento conforme acordado.

5. OBRIGA\xc7\xd5ES DO CONTRATADO
A cl\xednica se compromete a:
a) Realizar os procedimentos conforme descrito, utilizando produtos de qualidade e dentro da validade;
b) Fornecer todas as orienta\xe7\xf5es necess\xe1rias ao paciente;
c) Manter sigilo sobre as informa\xe7\xf5es do paciente.

6. CANCELAMENTO E REAGENDAMENTO
Em caso de cancelamento com menos de 24 horas de anteced\xeancia, poder\xe1 ser cobrada taxa de at\xe9 20% do valor do procedimento. Reagendamentos podem ser feitos com at\xe9 24 horas de anteced\xeancia sem custo adicional.

7. DISPOSI\xc7\xd5ES GERAIS
Este contrato \xe9 regido pelas leis brasileiras. Eventuais disputas ser\xe3o resolvidas no foro da comarca da cl\xednica.

Data: {{data}}`}};e.s(["DEFAULT_CONSENT_TEMPLATES",0,s,"consentAcceptanceSchema",0,t,"consentTemplateSchema",0,a])}];

//# sourceMappingURL=web_src_0ww0vfr._.js.map