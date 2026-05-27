interface ClassificationResult {
  intent: 'inquiry' | 'scheduling' | 'complaint' | 'followup' | 'other'
  interestedProcedures: string[]
  sentiment: 'positive' | 'neutral' | 'negative'
  extractedName: string | null
}

const KEYWORD_PATTERNS: { patterns: RegExp; intent: ClassificationResult['intent'] }[] = [
  { patterns: /pre[çc]o|quanto custa|valor|tabela|investimento/i, intent: 'inquiry' },
  { patterns: /agendar|marcar|hor[áa]rio|disponibilidade|agenda/i, intent: 'scheduling' },
  { patterns: /reclama[çc][ãa]o|problema|insatisf|ruim|p[ée]ssimo/i, intent: 'complaint' },
  { patterns: /retorno|voltar|revis[ãa]o|p[óo]s/i, intent: 'followup' },
]

const PROCEDURE_SYNONYMS: Record<string, string[]> = {
  botox: ['toxina botulínica', 'toxina botulinica', 'neuromodulador', 'dysport', 'xeomin'],
  preenchimento: ['ácido hialurônico', 'acido hialuronico', 'preenchedor', 'preenchimento labial', 'volumização', 'volumizacao'],
  'limpeza de pele': ['limpeza facial', 'limpeza profunda', 'higienização facial', 'higienizacao facial', 'extração de cravos', 'extracao de cravos'],
  'harmonização': ['harmonização facial', 'harmonização orofacial', 'harmonizacao', 'harmô', 'harmo', 'hof'],
  peeling: ['peeling químico', 'peeling quimico', 'esfoliação', 'esfoliacao', 'microdermoabrasão', 'microdermoabrasao'],
  bioestimulador: ['bioestimulador de colágeno', 'bioestimulador de colageno', 'estimulador de colágeno', 'estimulador de colageno', 'colágeno injetável', 'colageno injetavel'],
  fios: ['fios de pdo', 'fios de sustentação', 'fios de sustentacao', 'lifting sem cirurgia'],
  microagulhamento: ['microneedling', 'dermaroller', 'dermapen'],
  skinbooster: ['skin booster', 'hidratação injetável', 'hidratacao injetavel', 'biorevitalização', 'biorevitalizacao'],
  laser: ['laser fracionado', 'luz pulsada', 'fotorrejuvenescimento'],
  sculptra: ['ácido poli-l-láctico', 'acido poli-l-lactico', 'plla'],
  'rinomodelação': ['rinomodelacao', 'rinoplastia sem cirurgia', 'preenchimento nasal'],
}

export function classifyByKeywords(
  messages: string[],
  procedureNames: string[],
): Partial<ClassificationResult> | null {
  const combined = messages.join(' ').toLowerCase()

  let intent: ClassificationResult['intent'] | null = null
  for (const { patterns, intent: matchIntent } of KEYWORD_PATTERNS) {
    if (patterns.test(combined)) {
      intent = matchIntent
      break
    }
  }

  const matched: string[] = []
  for (const name of procedureNames) {
    const nameLower = name.trim().toLowerCase()
    if (combined.includes(nameLower)) {
      matched.push(name)
      continue
    }
    for (const [keyword, synonyms] of Object.entries(PROCEDURE_SYNONYMS)) {
      if (!nameLower.includes(keyword)) continue
      if (synonyms.some((syn) => combined.includes(syn.toLowerCase()))) {
        matched.push(name)
        break
      }
    }
  }

  if (!intent && matched.length === 0) return null

  return {
    intent: intent ?? 'inquiry',
    interestedProcedures: matched,
  }
}

export async function classifyWithOpenAI(messages: string[], procedureNames: string[]): Promise<ClassificationResult> {
  const OpenAI = (await import('openai')).default
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const conversationText = messages.length === 1
    ? messages[0]
    : messages.map((m, i) => `[${i + 1}] ${m}`).join('\n')

  const procedureList = procedureNames.map((n) => n.trim()).join(', ')

  const synonymHints = Object.entries(PROCEDURE_SYNONYMS)
    .map(([key, syns]) => `${key}: ${syns.join(', ')}`)
    .join('\n')

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    max_tokens: 200,
    messages: [
      {
        role: 'system',
        content: `You are a classifier for a Brazilian dental/aesthetic clinic. Analyze the patient's WhatsApp messages and return JSON:
{
  "intent": "inquiry" | "scheduling" | "complaint" | "followup" | "other",
  "interestedProcedures": ["procedure name", ...] or [],
  "sentiment": "positive" | "neutral" | "negative",
  "extractedName": "string or null"
}
Available procedures at this clinic: ${procedureList}.
Use these EXACT procedure names in interestedProcedures. The patient may mention multiple procedures. Return all that apply.

Common synonyms (map these to the matching procedure above):
${synonymHints}

IMPORTANT: Patients often misspell procedure names in WhatsApp (e.g., "botok", "prenchimneto", "armonização", "pelling"). Always correct spelling mistakes and map to the closest matching procedure.

Respond ONLY with the JSON object, no other text.`,
      },
      { role: 'user', content: conversationText },
    ],
  })

  const text = response.choices[0]?.message?.content?.trim() ?? '{}'
  try {
    const parsed = JSON.parse(text)
    // Handle legacy single-value response from the model
    if (parsed.interestedProcedure && !parsed.interestedProcedures) {
      parsed.interestedProcedures = [parsed.interestedProcedure]
      delete parsed.interestedProcedure
    }
    return {
      intent: parsed.intent ?? 'other',
      interestedProcedures: Array.isArray(parsed.interestedProcedures) ? parsed.interestedProcedures : [],
      sentiment: parsed.sentiment ?? 'neutral',
      extractedName: parsed.extractedName ?? null,
    }
  } catch {
    return { intent: 'other', interestedProcedures: [], sentiment: 'neutral', extractedName: null }
  }
}

export async function classifyMessage(
  messages: string[],
  procedureNames: string[],
): Promise<ClassificationResult> {
  if (messages.length === 0) {
    return { intent: 'other', interestedProcedures: [], sentiment: 'neutral', extractedName: null }
  }

  const keywordResult = classifyByKeywords(messages, procedureNames)
  if (keywordResult?.intent) {
    return {
      intent: keywordResult.intent,
      interestedProcedures: keywordResult.interestedProcedures ?? [],
      sentiment: 'neutral',
      extractedName: null,
    }
  }

  if (!process.env.OPENAI_API_KEY) {
    return { intent: 'other', interestedProcedures: [], sentiment: 'neutral', extractedName: null }
  }

  try {
    return await classifyWithOpenAI(messages, procedureNames)
  } catch {
    return { intent: 'other', interestedProcedures: [], sentiment: 'neutral', extractedName: null }
  }
}
