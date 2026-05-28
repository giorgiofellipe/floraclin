# Configuração da integração com Instagram Direct

Este guia descreve, passo a passo, como conectar uma conta do Instagram à FloraClin para enviar e receber DMs (Direct Messages) diretamente pela plataforma.

A integração utiliza a **Messenger Platform API for Instagram** da Meta. Para esta versão, o onboarding é **manual**: você gera as credenciais no Graph API Explorer da Meta e cola na tela de configurações da FloraClin.

---

## 1. Pré-requisitos

Antes de começar, verifique se a clínica atende aos seguintes requisitos:

1. **Conta Instagram Business ou Creator.** Contas pessoais não funcionam.
   - Para converter: abra o app do Instagram → Configurações → Conta → "Mudar para conta profissional".
2. **Página do Facebook vinculada à conta do Instagram.**
   - A Meta exige que toda conta Business do Instagram esteja conectada a uma Facebook Page. Sem essa vinculação, a API de mensagens não funciona.
   - Para vincular: abra a Facebook Page → Configurações → Instagram → "Conectar conta".
3. **Acesso de administrador** à Facebook Page (papel "Admin" ou "Editor" com permissão de mensagens).
4. **App da Meta** já criado e aprovado para uso das permissões de mensagens do Instagram. A equipe de desenvolvimento da FloraClin fornece o App ID e o link da app quando necessário.

Se algum desses itens estiver faltando, a integração não conseguirá ser ativada.

---

## 2. Como obter o Page Access Token

O **Page Access Token** é a credencial principal usada pela FloraClin para enviar mensagens em nome da sua página.

### Passo a passo

1. Acesse o **Graph API Explorer** da Meta:
   [https://developers.facebook.com/tools/explorer/](https://developers.facebook.com/tools/explorer/)
2. No canto superior direito, selecione o **App da Meta** indicado pela equipe FloraClin.
3. No campo "User or Page Token", clique em **"Get User Access Token"**.
4. Na janela de permissões, marque os seguintes escopos (scopes) obrigatórios:
   - `pages_messaging` — enviar e receber mensagens em nome da página.
   - `pages_show_list` — listar as páginas que você administra.
   - `instagram_basic` — leitura básica da conta do Instagram.
   - `instagram_manage_messages` — gerenciar mensagens diretas do Instagram.
5. Clique em **"Generate Access Token"** e autorize no popup que abrir. Faça login com a conta do Facebook que administra a página.
6. Você receberá um **User Access Token** de curta duração (válido por ~1 hora). Esse ainda não é o token final.
7. Troque o User Token por um **Page Access Token** seguindo o passo 3 abaixo.

### Token de longa duração (recomendado)

Tokens de página gerados a partir de um User Token de curta duração também são de curta duração. Para evitar reconexões frequentes:

1. No Graph API Explorer, copie o seu User Access Token de curta duração.
2. Faça a seguinte requisição para trocar por um User Token de longa duração (válido por 60 dias):
   ```
   GET https://graph.facebook.com/v19.0/oauth/access_token
     ?grant_type=fb_exchange_token
     &client_id={APP_ID}
     &client_secret={APP_SECRET}
     &fb_exchange_token={SHORT_LIVED_USER_TOKEN}
   ```
3. Use esse novo User Token de longa duração para buscar o Page Access Token (próxima seção). O Page Token derivado dele **não expira** enquanto a senha do administrador não for trocada e as permissões não forem revogadas.

> **Dica:** O App Secret é confidencial. Se você não tiver acesso, peça à equipe de desenvolvimento da FloraClin para fazer essa troca por você.

---

## 3. Como encontrar Page ID e Instagram Business Account ID

Com o User Access Token em mãos:

1. No Graph API Explorer, faça uma requisição para:
   ```
   GET me/accounts?fields=name,id,access_token,instagram_business_account
   ```
2. Você receberá uma lista de páginas. Para cada página, o JSON inclui:
   - `id` → este é o **Page ID** da sua Facebook Page.
   - `access_token` → este é o **Page Access Token** (o que você cola na FloraClin).
   - `instagram_business_account.id` → este é o **Instagram Business Account ID** (IGSID da conta).
   - `name` → o nome da página, para conferência.
3. Localize a página correspondente à sua clínica e copie esses três valores.

Se o campo `instagram_business_account` estiver ausente, significa que a Página do Facebook **não está vinculada** ao Instagram. Volte ao item 1 dos pré-requisitos.

---

## 4. Configurar o webhook na Meta App

Os webhooks permitem que o Instagram envie mensagens recebidas em tempo real para a FloraClin. Esta etapa normalmente é feita **uma única vez** pela equipe de desenvolvimento, no momento de configurar a Meta App. Você só precisa garantir que sua página esteja inscrita.

### Configuração do webhook (uma vez por app)

1. Acesse o painel de apps da Meta: [https://developers.facebook.com/apps/](https://developers.facebook.com/apps/) e abra o app da FloraClin.
2. No menu lateral, vá em **Webhooks**.
3. Adicione o produto **Instagram** (ou edite a inscrição existente).
4. Configure:
   - **Callback URL**: `https://[seu-dominio]/api/webhooks/instagram`
     - Exemplo em produção: `https://app.floraclin.com/api/webhooks/instagram`
   - **Verify Token**: combinado com a equipe de desenvolvimento (o mesmo valor está em `META_WEBHOOK_VERIFY_TOKEN` no ambiente).
5. Inscreva os seguintes campos (fields):
   - `messages` — mensagens recebidas.
   - `messaging_postbacks` — cliques em botões de resposta rápida.
   - `messaging_seen` — confirmações de leitura.
   - `messaging_reactions` — reações às mensagens (curtidas, emojis).

### Inscrever a página específica

Mesmo com o webhook configurado, cada Facebook Page precisa ser **inscrita explicitamente** para receber notificações:

1. Com o Page Access Token, faça a requisição:
   ```
   POST https://graph.facebook.com/v19.0/{PAGE_ID}/subscribed_apps
     ?subscribed_fields=messages,messaging_postbacks,messaging_seen,messaging_reactions
     &access_token={PAGE_ACCESS_TOKEN}
   ```
2. A resposta deve ser `{"success": true}`.

Sem esse passo, mensagens enviadas para sua conta do Instagram **não chegarão** à FloraClin.

---

## 5. Configurar no FloraClin

Com Page Access Token, Page ID e Instagram Business Account ID em mãos:

1. Acesse a FloraClin e vá em **Configurações → Instagram**.
2. Cole os três valores nos campos correspondentes:
   - **Page Access Token**
   - **Page ID**
   - **Instagram Business Account ID**
3. Clique em **"Testar conexão"**. A FloraClin valida as credenciais chamando a Graph API. Se aparecer o nome correto da página, está tudo certo.
4. Habilite o toggle **"Integração ativa"**.
5. Salve.

A partir desse momento, mensagens recebidas no Instagram aparecem na tela de Mensagens da FloraClin, e respostas enviadas pela plataforma chegam ao Instagram do remetente.

---

## 6. Limitações importantes

A API do Instagram tem regras estritas sobre quando você pode enviar mensagens. Conhecê-las evita mensagens não entregues e contas penalizadas.

### Janela de mensagem padrão: 24 horas

- Após o usuário enviar uma mensagem para a clínica, você tem **24 horas** para responder livremente.
- O contador zera a cada nova mensagem inbound do usuário.
- Mensagens promocionais (ofertas, lembretes não solicitados) **só podem** ser enviadas dentro dessa janela.

### Janela de agente humano: até 7 dias

- Em casos de atendimento ao cliente, a Meta permite estender a janela até **7 dias** após a última mensagem inbound.
- Para usar essa janela estendida, a mensagem precisa ser marcada como `HUMAN_AGENT` na chamada da API. A FloraClin faz isso automaticamente quando você responde manualmente entre 24h e 7 dias após a última inbound.
- Mensagens automatizadas (templates, lembretes) **não podem** usar a janela `HUMAN_AGENT`.

### Após 7 dias: bloqueado

- Passados 7 dias da última inbound, **não há como enviar DM** para o usuário. A API retorna erro.
- Nesses casos, entre em contato pelo telefone, e-mail ou WhatsApp da clínica.

### Início de conversa

- Você **não pode iniciar uma conversa** com um usuário que nunca enviou mensagem para a sua conta do Instagram.
- Isto vale mesmo que você tenha o @username dele. A regra existe para evitar spam.

### Outras limitações

- Áudios, vídeos e arquivos têm limite de tamanho (geralmente 25MB).
- Stories mencionadas e respostas a Stories chegam como mensagens normais.
- Mensagens em grupo no Instagram **não são suportadas** pela API.

---

## 7. Resolução de problemas comuns

### "Token expirado" ou "Invalid OAuth access token"

**Causa:** O Page Access Token foi gerado a partir de um User Token de curta duração e venceu, ou um administrador da página revogou as permissões da app.

**Solução:**
1. Volte ao Graph API Explorer.
2. Gere um novo User Token de **longa duração** (passo 2 deste guia).
3. Obtenha o novo Page Access Token via `me/accounts`.
4. Cole na tela de Configurações → Instagram da FloraClin e clique em "Testar conexão".

### Webhook signature failure / mensagens não chegam à FloraClin

**Causa:** A assinatura HMAC enviada pela Meta no header `X-Hub-Signature-256` não confere com o cálculo do servidor. Quase sempre é a variável de ambiente `META_APP_SECRET` errada ou desatualizada.

**Solução:**
1. Confirme com a equipe de desenvolvimento se `META_APP_SECRET` no ambiente bate exatamente com o App Secret do app da Meta (Painel da App → Configurações → Básico).
2. Confirme que a Facebook Page está inscrita (`POST /{PAGE_ID}/subscribed_apps`, ver seção 4).
3. Verifique os logs do endpoint `/api/webhooks/instagram` para diagnosticar.

### "Outside messaging window" ao tentar enviar resposta

**Causa:** Passaram-se mais de 7 dias desde a última mensagem do usuário. A API bloqueia o envio.

**Solução:**
- Use outro canal para falar com o paciente (telefone, WhatsApp, e-mail).
- Quando ele responder à sua nova abordagem ou enviar nova DM, a janela reseta.

### "Esta conta não é Business"

**Causa:** A conta do Instagram está como pessoal ou Creator com restrições, ou a vinculação com a Facebook Page foi desfeita.

**Solução:**
1. Confirme que a conta está como **Business** ou **Creator** no app do Instagram.
2. Reabra a Facebook Page → Configurações → Instagram → reconecte a conta.
3. Regere o Page Access Token (a vinculação afeta os escopos do token).

### "Testar conexão" retorna nome de outra página

**Causa:** O Page ID colado na FloraClin não corresponde ao Page Access Token (acontece quando o admin gerencia várias páginas).

**Solução:**
- Refaça `GET me/accounts` e copie o `id` e o `access_token` da **mesma linha** do JSON.

---

## Suporte

Em caso de dúvidas durante a configuração, entre em contato com o suporte da FloraClin informando:

- Nome da clínica e Page ID.
- Print da tela de erro ou resposta da API.
- Horário aproximado do problema (para correlacionar com logs).

Não compartilhe o Page Access Token em canais públicos — ele é equivalente a uma senha.
