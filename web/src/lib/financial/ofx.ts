import { createHash } from 'node:crypto'
import { isValidYmd } from '@/lib/dates'

/**
 * OFX statement parser for Brazilian bank exports.
 *
 * Handles both OFX 1.x (SGML: tags without closing tags, a plain-text header
 * block before <OFX>) and OFX 2.x (XML). The file is untrusted input: parsing
 * is bounded by file size and record count, never evaluates anything, and
 * returns invalid records as data instead of throwing.
 *
 * Amounts are integer cents (positive = credit, negative = debit) and dates
 * are BR calendar days (YYYY-MM-DD), never instants.
 */

export const OFX_MAX_BYTES = 2 * 1024 * 1024
export const OFX_MAX_TRANSACTIONS = 5000

export interface OfxTransaction {
  /** 1-based position of the record in the file, for error messages. */
  index: number
  fitid: string | null
  /** Statement day as printed by the bank (first 8 digits of DTPOSTED). */
  date: string
  /** Signed cents: positive credit, negative debit. */
  amountCents: number
  type: string | null
  memo: string
  checkNumber: string | null
}

export interface OfxRecordError {
  index: number
  message: string
}

export interface ParsedOfx {
  transactions: OfxTransaction[]
  errors: OfxRecordError[]
  /** Problems with the file as a whole; when present nothing can be imported. */
  fileErrors: string[]
  bankId: string | null
  accountId: string | null
  currency: string | null
  periodStart: string | null
  periodEnd: string | null
}

const CREDIT_TYPES = new Set(['CREDIT', 'DEP', 'INT', 'DIV', 'DIRECTDEP'])
const DEBIT_TYPES = new Set(['DEBIT', 'CHECK', 'PAYMENT', 'FEE', 'SRVCHG', 'ATM', 'POS', 'DIRECTDEBIT', 'REPEATPMT'])

/**
 * Decodes the bytes of an OFX file. OFX 1.x files declare their charset in the
 * header (CHARSET:1252 or ISO-8859-1 are the common Brazilian ones); UTF-8
 * is used when the bytes are valid UTF-8, which also covers OFX 2.
 */
export function decodeOfxBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '')
  } catch {
    // Not valid UTF-8: every byte is a code point in windows-1252/latin1.
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function cleanText(raw: string): string {
  return raw
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name])
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Value of the first <TAG> in the block, SGML or XML style. */
function tagValue(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i').exec(block)
  if (!match) return null
  const value = cleanText(match[1])
  return value === '' ? null : value
}

/** YYYYMMDD[HHMMSS[.XXX][[offset:TZ]]] → YYYY-MM-DD, using the printed day. */
export function parseOfxDate(raw: string | null): string | null {
  if (!raw) return null
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(raw.trim())
  if (!match) return null
  const ymd = `${match[1]}-${match[2]}-${match[3]}`
  return isValidYmd(ymd) ? ymd : null
}

/** "1.234.567" with "." as the thousands separator: 1–3 digits, then groups of exactly 3. */
function isGrouped(intPart: string, separator: string): boolean {
  return intPart.split(separator).every((group, i) => (i === 0 ? /^\d{1,3}$/ : /^\d{3}$/).test(group))
}

/**
 * TRNAMT → signed cents without floating point. Accepts "1234.56", "-1.234,56",
 * "1,234,567" and "1234,5". Anything with more than two decimals, thousands
 * groups that are not of three digits ("1,2,3"), or not a number, is null.
 */
export function parseOfxAmountToCents(raw: string | null): number | null {
  if (!raw) return null
  let text = raw.replace(/\s+/g, '')
  let negative = false
  if (text.startsWith('-')) {
    negative = true
    text = text.slice(1)
  } else if (text.startsWith('+')) {
    text = text.slice(1)
  }
  if (!/^[\d.,]+$/.test(text)) return null

  // The last separator is the decimal one when both kinds appear; a separator
  // repeated ("1.234.567") is a thousands group; a single one is the decimal
  // point, so "1.234" (three decimals) is refused below instead of guessed.
  // Thousands groups are validated before the separators are dropped, so a
  // malformed number is refused instead of read as a different amount.
  const lastDot = text.lastIndexOf('.')
  const lastComma = text.lastIndexOf(',')
  const decimalAt = Math.max(lastDot, lastComma)
  let intPart = text
  let decPart = ''
  if (decimalAt >= 0) {
    const separator = text[decimalAt]
    const thousands = separator === '.' ? ',' : '.'
    const hasBothKinds = lastDot >= 0 && lastComma >= 0
    const repeated = text.split(separator).length - 1 > 1
    if (hasBothKinds) {
      intPart = text.slice(0, decimalAt)
      decPart = text.slice(decimalAt + 1)
      if (intPart.includes(separator) || !isGrouped(intPart, thousands)) return null
      intPart = intPart.split(thousands).join('')
    } else if (repeated) {
      if (!isGrouped(text, separator)) return null
      intPart = text.split(separator).join('')
    } else {
      intPart = text.slice(0, decimalAt)
      decPart = text.slice(decimalAt + 1)
    }
  }
  if (intPart === '' && decPart === '') return null
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(decPart)) return null
  if (decPart.length > 2) {
    if (/[^0]/.test(decPart.slice(2))) return null
    decPart = decPart.slice(0, 2)
  }
  const cents = Number(intPart || '0') * 100 + Number(decPart.padEnd(2, '0') || '0')
  if (!Number.isSafeInteger(cents)) return null
  return negative ? -cents : cents
}

function normalizeMemo(memo: string): string {
  return memo.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

type IdentityFields = Pick<OfxTransaction, 'fitid' | 'date' | 'amountCents' | 'memo'> &
  Partial<Pick<OfxTransaction, 'checkNumber' | 'type'>>

/**
 * What makes two statement lines the same record: every discriminator the bank
 * sent (FITID, day, amount, cheque number, type and memo, which carries the
 * payer). A FITID alone is not enough: some banks reuse short sequential ids
 * per file, so a reused FITID with another payer or cheque is a different line
 * (the importer flags it for review). Memo case, accents and spacing are ignored.
 */
export function lineIdentityKey(line: IdentityFields): string {
  return sha256(
    JSON.stringify([
      'line',
      line.fitid ?? '',
      line.date,
      line.amountCents,
      line.checkNumber ?? '',
      line.type ?? '',
      normalizeMemo(line.memo),
    ]),
  )
}

/**
 * Day + amount + cheque + memo, ignoring the FITID. Two lines with the same
 * fingerprint but different identities may be one transaction whose id the bank
 * changed, or two genuine identical ones: the importer keeps both and flags the
 * later one for review.
 */
export function lineFingerprint(line: Omit<IdentityFields, 'fitid'>): string {
  return sha256(JSON.stringify(['fp', line.date, line.amountCents, line.checkNumber ?? '', normalizeMemo(line.memo)]))
}

/**
 * Hash of the whole file's transactions with every field the bank sent, so only
 * an equivalent statement is recognised as already imported.
 */
export function statementHash(transactions: readonly OfxTransaction[]): string {
  return sha256(
    JSON.stringify(transactions.map((t) => [t.fitid, t.date, t.amountCents, t.checkNumber, t.type, t.memo])),
  )
}

export function parseOfx(text: string): ParsedOfx {
  const result: ParsedOfx = {
    transactions: [],
    errors: [],
    fileErrors: [],
    bankId: null,
    accountId: null,
    currency: null,
    periodStart: null,
    periodEnd: null,
  }

  const ofxStart = text.search(/<OFX[\s>]/i)
  if (ofxStart < 0) {
    result.fileErrors.push('Arquivo não parece ser um OFX (tag <OFX> não encontrada)')
    return result
  }
  const body = text.slice(ofxStart)

  const statementCount = (body.match(/<(STMTRS|CCSTMTRS)>/gi) ?? []).length
  if (statementCount === 0) {
    result.fileErrors.push('Arquivo OFX sem extrato (STMTRS) para importar')
    return result
  }
  if (statementCount > 1) {
    result.fileErrors.push('O arquivo tem mais de uma conta. Exporte o extrato de uma conta por vez')
    return result
  }

  result.currency = tagValue(body, 'CURDEF')?.toUpperCase() ?? null
  if (result.currency && result.currency !== 'BRL') {
    result.fileErrors.push(`Moeda ${result.currency} não suportada: apenas BRL`)
    return result
  }
  result.bankId = tagValue(body, 'BANKID')
  result.accountId = tagValue(body, 'ACCTID')
  result.periodStart = parseOfxDate(tagValue(body, 'DTSTART'))
  result.periodEnd = parseOfxDate(tagValue(body, 'DTEND'))

  const blocks = body.split(/<STMTTRN>/i).slice(1)
  if (blocks.length > OFX_MAX_TRANSACTIONS) {
    result.fileErrors.push(`Arquivo com mais de ${OFX_MAX_TRANSACTIONS} lançamentos. Exporte um período menor`)
    return result
  }

  blocks.forEach((rawBlock, i) => {
    const index = i + 1
    // The block ends at its closing tag (XML) or at the next transaction/list end (SGML).
    const block = rawBlock.split(/<\/STMTTRN>|<\/BANKTRANLIST>/i)[0]

    const date = parseOfxDate(tagValue(block, 'DTPOSTED'))
    if (!date) return result.errors.push({ index, message: 'Data do lançamento ausente ou inválida' })

    const rawAmount = tagValue(block, 'TRNAMT')
    const amountCents = parseOfxAmountToCents(rawAmount)
    if (amountCents === null) return result.errors.push({ index, message: 'Valor do lançamento ausente ou inválido' })
    if (amountCents === 0) return result.errors.push({ index, message: 'Lançamento com valor zero' })

    const type = tagValue(block, 'TRNTYPE')?.toUpperCase() ?? null
    if (type && ((CREDIT_TYPES.has(type) && amountCents < 0) || (DEBIT_TYPES.has(type) && amountCents > 0))) {
      return result.errors.push({ index, message: `Tipo ${type} incompatível com o sinal do valor` })
    }

    const memo = [tagValue(block, 'MEMO'), tagValue(block, 'NAME')]
      .filter((v, pos, all): v is string => Boolean(v) && all.indexOf(v) === pos)
      .join(' - ')
      .slice(0, 255)
    result.transactions.push({
      index,
      fitid: tagValue(block, 'FITID')?.slice(0, 100) ?? null,
      date,
      amountCents,
      type,
      memo: memo || 'Sem descrição',
      checkNumber: tagValue(block, 'CHECKNUM')?.slice(0, 30) ?? null,
    })
  })

  if (blocks.length === 0) result.fileErrors.push('O extrato não tem lançamentos')
  return result
}
