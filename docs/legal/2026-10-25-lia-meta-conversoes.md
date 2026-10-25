# Teste de legítimo interesse (LIA): eventos de conversão à Meta

Documento interno (Art. 10 e Art. 37 da LGPD). Revisar anualmente ou a cada mudança no fluxo.

- **Operação:** envio dos eventos CompleteRegistration (cadastro) e Subscribe (assinatura paga) à Meta Platforms, Inc. pela API de Conversões, e o cookie próprio de primeiro acesso `floraclin_ft`.
- **Data:** 25/10/2026. **Responsável:** Giorgio Fellipe.
- **Hipótese legal:** Art. 7º, IX, e Art. 10, I (apoio e promoção das atividades do controlador).
- **Referências:** ANPD, Guia Orientativo Legítimo Interesse (fev/2024), Anexo II; ANPD, Guia Orientativo Cookies (out/2022), p. 23-25.

## 1. Finalidade

- **Dados:** e-mail e telefone (hash SHA-256); IP, user agent, fbc (a partir do fbclid), gclid, `_fbp` (só existe após o aceite do Pixel), valor e plano da assinatura; UTMs, página de entrada, domínio de referência e data de captura.
- **Titulares:** profissionais adultos que se cadastram diretamente na FloraClin. Sem dados de pacientes. Sem dados sensíveis.
- **Interesse:** medir o retorno dos anúncios próprios da FloraClin e otimizar a entrega da Meta para perfis com chance de se tornar cliente.
- **Situação concreta:** a FloraClin investe em Meta Ads. Entre 09/10 e 25/10/2026, a Meta registrou 11 dos 22 cadastros vindos de anúncios, porque o Pixel e o envio pelo servidor dependiam do banner de cookies.
- **Finalidade específica:** medição e otimização dos anúncios da FloraClin. Sem venda de dados e sem uso para anúncios de terceiros.

## 2. Necessidade

- Apenas dois eventos de conversão. Nenhuma navegação página a página é enviada pelo servidor.
- E-mail e telefone seguem em hash. IP, navegador e fbc seguem sem hash porque a Meta exige esse formato para associar o evento ao anúncio.
- **Alternativas consideradas:**
  - Só UTMs: não alimenta a otimização da Meta.
  - Só o Pixel com consentimento: perdeu metade das conversões no período medido.
  - Consentimento no cadastro: descartado por decisão da empresa, para manter o sinal de conversão completo. Risco residual registrado abaixo.
- Cookie próprio, prazo de 90 dias, compartilhado com a Meta apenas pelo fbc.

## 3. Balanceamento e salvaguardas

- **Expectativa legítima:** relação direta (a pessoa se cadastrou na FloraClin), coleta direta, evento no momento da conversão e prática comum de anunciantes medirem conversões de quem veio do anúncio. Aviso no formulário de cadastro, no banner e na Política de Privacidade.
- **Riscos:**
  - A Meta pode associar o hash à conta da pessoa e, pelos seus termos, usar dados de eventos para fins próprios.
  - Retenção pela Meta conforme os termos dela.
  - Transferência internacional (EUA).
  - A ANPD considera o consentimento, em geral, a base mais adequada para publicidade (Guia de Cookies, p. 24-25).
  - fbclid e gclid ficam registrados mesmo quando o visitante recusa o Pixel.
- **Salvaguardas:**
  - Hash SHA-256 de e-mail e telefone.
  - Meta Pixel (cookies de terceiros) só com aceite.
  - Escopo limitado a dois eventos.
  - Texto específico na Política de Privacidade (seções 2.3, 3, 4, 5, 7.4, 8 e 9), no /lgpd, no banner e no formulário de cadastro.
  - Oposição por e-mail sem justificativa (Art. 18, § 2º). Ao receber o pedido, preencher `tenants.meta_conversions_opted_out_at` e apagar `tenants.signup_attribution` da clínica. O servidor não envia eventos para clínicas com esse campo preenchido.
  - Resposta em até 15 dias úteis.
  - Nenhum dado de paciente no fluxo.
  - Resumo deste teste disponível mediante pedido.
- **Pendente com assessoria jurídica:** mecanismo de transferência internacional aplicável aos termos da Meta (Art. 33 e Resolução CD/ANPD nº 19/2024).

## Conclusão

Tratamento adotado com as salvaguardas acima. Risco residual moderado, aceito pela empresa. Reavaliar se a ANPD publicar orientação específica sobre API de Conversões ou se a Meta mudar seus termos.
