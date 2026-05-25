interface ClassificationResult {
  intent: 'inquiry' | 'scheduling' | 'complaint' | 'followup' | 'other'
  interestedProcedure: string | null
  sentiment: 'positive' | 'neutral' | 'negative'
  extractedName: string | null
}

const KEYWORD_PATTERNS: { patterns: RegExp; intent: ClassificationResult['intent'] }[] = [
  { patterns: /pre[çc]o|quanto custa|valor|tabela|investimento/i, intent: 'inquiry' },
  { patterns: /agendar|marcar|hor[áa]rio|disponibilidade|agenda/i, intent: 'scheduling' },
  { patterns: /reclama[çc][ãa]o|problema|insatisf|ruim|p[ée]ssimo/i, intent: 'complaint' },
  { patterns: /retorno|voltar|revis[ãa]o|p[óo]s/i, intent: 'followup' },
]

export function classifyByKeywords(
  message: string,
  procedureNames: string[],
): Partial<ClassificationResult> | null {
  const lower = message.toLowerCase()

  let intent: ClassificationResult['intent'] | null = null
  for (const { patterns, intent: matchIntent } of KEYWORD_PATTERNS) {
    if (patterns.test(lower)) {
      intent = matchIntent
      break
    }
  }

  let interestedProcedure: string | null = null
  for (const name of procedureNames) {
    if (lower.includes(name.toLowerCase())) {
      interestedProcedure = name
      break
    }
  }

  if (!intent && !interestedProcedure) return null

  return {
    intent: intent ?? 'inquiry',
    interestedProcedure,
  }
}

export async function classifyWithOpenAI(message: string): Promise<ClassificationResult> {
  const OpenAI = (await import('openai')).default
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    max_tokens: 200,
    messages: [
      {
        role: 'system',
        content: `You are a classifier for a Brazilian dental/aesthetic clinic. Analyze the WhatsApp message and return JSON:
{
  "intent": "inquiry" | "scheduling" | "complaint" | "followup" | "other",
  "interestedProcedure": "string or null",
  "sentiment": "positive" | "neutral" | "negative",
  "extractedName": "string or null"
}
Respond ONLY with the JSON object, no other text.`,
      },
      { role: 'user', content: message },
    ],
  })

  const text = response.choices[0]?.message?.content?.trim() ?? '{}'
  try {
    return JSON.parse(text) as ClassificationResult
  } catch {
    return { intent: 'other', interestedProcedure: null, sentiment: 'neutral', extractedName: null }
  }
}

export async function classifyMessage(
  message: string,
  procedureNames: string[],
): Promise<ClassificationResult> {
  const keywordResult = classifyByKeywords(message, procedureNames)
  if (keywordResult?.intent) {
    return {
      intent: keywordResult.intent,
      interestedProcedure: keywordResult.interestedProcedure ?? null,
      sentiment: 'neutral',
      extractedName: null,
    }
  }

  if (!process.env.OPENAI_API_KEY) {
    return { intent: 'other', interestedProcedure: null, sentiment: 'neutral', extractedName: null }
  }

  try {
    return await classifyWithOpenAI(message)
  } catch {
    return { intent: 'other', interestedProcedure: null, sentiment: 'neutral', extractedName: null }
  }
}
