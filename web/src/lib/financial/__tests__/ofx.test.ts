import { describe, it, expect } from 'vitest'
import {
  decodeOfxBytes,
  lineFingerprint,
  lineIdentityKey,
  OFX_MAX_TRANSACTIONS,
  parseOfx,
  parseOfxAmountToCents,
  parseOfxDate,
  statementHash,
} from '../ofx'

// Sanitized shape of a Brazilian OFX 1.x export: header block, SGML tags
// with no closing tags, and BRT timestamps written as [-3:BRT].
const SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20261104120000[-3:BRT]<LANGUAGE>POR</SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<STMTRS><CURDEF>BRL
<BANKACCTFROM><BANKID>0260<ACCTID>12345-6<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20261001000000[-3:BRT]<DTEND>20261031235959[-3:BRT]
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261031230000[-3:BRT]<TRNAMT>1500.00<FITID>A1<MEMO>PIX RECEBIDO MARIA</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261102000000[0:GMT]<TRNAMT>-89,90<FITID>A2<MEMO>TARIFA MENSAL</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261102<TRNAMT>1.234,56<FITID>A3<NAME>STONE<MEMO>REPASSE</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>10.00<DTASOF>20261031</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL</CURDEF>
<BANKACCTFROM><BANKID>001</BANKID><ACCTID>99</ACCTID></BANKACCTFROM>
<BANKTRANLIST><DTSTART>20261001</DTSTART><DTEND>20261031</DTEND>
<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20261015120000</DTPOSTED><TRNAMT>10.50</TRNAMT><FITID>X1</FITID><MEMO>Depósito &amp; troco</MEMO></STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`

describe('parseOfxAmountToCents', () => {
  it.each([
    ['1500.00', 150000],
    ['-89,90', -8990],
    ['1.234,56', 123456],
    ['1,234.56', 123456],
    ['1.234.567,89', 123456789],
    ['0.5', 50],
    ['12', 1200],
    ['+7.05', 705],
    ['100.500', 10050], // trailing zero beyond cents is harmless
    ['1,234,567', 123456700],
    ['-12.345.678,90', -1234567890],
  ])('%s -> %d', (raw, cents) => {
    expect(parseOfxAmountToCents(raw)).toBe(cents)
  })

  it.each(['', 'abc', '1.234', '12.345', '1e3', '--5', '1,2,3x'])('rejects %j', (raw) => {
    expect(parseOfxAmountToCents(raw)).toBeNull()
  })

  // Malformed thousands groups are refused, never read as another amount.
  it.each(['1,2,3', '1.2.3,45', '1.234.56', '12,34.56', '1234.567,89', '1.234,567,89', '1..234', ',123.45'])('rejects malformed grouping %j', (raw) => {
    expect(parseOfxAmountToCents(raw)).toBeNull()
  })

  it('does not lose cents to floating point', () => {
    expect(parseOfxAmountToCents('0.29')).toBe(29)
    expect(parseOfxAmountToCents('1.15')).toBe(115)
  })
})

describe('parseOfxDate', () => {
  it('uses the day the bank printed, whatever the offset', () => {
    expect(parseOfxDate('20261031230000[-3:BRT]')).toBe('2026-10-31')
    expect(parseOfxDate('20261102000000[0:GMT]')).toBe('2026-11-02')
  })

  it('refuses days that do not exist', () => {
    expect(parseOfxDate('20260231')).toBeNull()
    expect(parseOfxDate('2026')).toBeNull()
    expect(parseOfxDate(null)).toBeNull()
  })
})

describe('parseOfx', () => {
  it('parses an OFX 1.x SGML statement', () => {
    const parsed = parseOfx(SGML)
    expect(parsed.fileErrors).toEqual([])
    expect(parsed.errors).toEqual([])
    expect(parsed.currency).toBe('BRL')
    expect(parsed.bankId).toBe('0260')
    expect(parsed.accountId).toBe('12345-6')
    expect(parsed.periodStart).toBe('2026-10-01')
    expect(parsed.periodEnd).toBe('2026-10-31')
    expect(parsed.transactions.map((t) => [t.fitid, t.date, t.amountCents])).toEqual([
      ['A1', '2026-10-31', 150000],
      ['A2', '2026-11-02', -8990],
      ['A3', '2026-11-02', 123456],
    ])
    expect(parsed.transactions[2].memo).toBe('REPASSE - STONE')
  })

  it('parses an OFX 2 XML statement and decodes entities', () => {
    const parsed = parseOfx(XML)
    expect(parsed.errors).toEqual([])
    expect(parsed.transactions).toHaveLength(1)
    expect(parsed.transactions[0]).toMatchObject({ fitid: 'X1', date: '2026-10-15', amountCents: 1050, memo: 'Depósito & troco' })
  })

  it('reports malformed records without dropping the good ones', () => {
    const broken = SGML.replace('<TRNAMT>1500.00', '<TRNAMT>abc').replace('<DTPOSTED>20261102<', '<DTPOSTED>20261302<')
    const parsed = parseOfx(broken)
    expect(parsed.transactions.map((t) => t.fitid)).toEqual(['A2'])
    expect(parsed.errors.map((e) => e.index)).toEqual([1, 3])
  })

  it('rejects a debit with a positive amount and a credit with a negative one', () => {
    const parsed = parseOfx(SGML.replace('<TRNAMT>-89,90', '<TRNAMT>89,90'))
    expect(parsed.errors).toEqual([{ index: 2, message: 'Tipo DEBIT incompatível com o sinal do valor' }])
  })

  it('rejects zero-value lines', () => {
    const parsed = parseOfx(SGML.replace('<TRNAMT>1500.00', '<TRNAMT>0.00'))
    expect(parsed.errors[0]).toMatchObject({ index: 1, message: 'Lançamento com valor zero' })
  })

  it('refuses files that are not OFX, have no statement or are not BRL', () => {
    expect(parseOfx('hello').fileErrors[0]).toMatch(/não parece ser um OFX/)
    expect(parseOfx('<OFX></OFX>').fileErrors[0]).toMatch(/sem extrato/)
    expect(parseOfx(SGML.replace('<CURDEF>BRL', '<CURDEF>USD')).fileErrors[0]).toMatch(/USD/)
  })

  it('refuses a file with several accounts', () => {
    const two = SGML.replace('</STMTRS>', '</STMTRS><STMTRS><CURDEF>BRL</STMTRS>')
    expect(parseOfx(two).fileErrors[0]).toMatch(/mais de uma conta/)
  })

  it('bounds the number of records', () => {
    const rows = Array.from({ length: OFX_MAX_TRANSACTIONS + 1 }, (_, i) => `<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261001<TRNAMT>1.00<FITID>${i}</STMTTRN>`).join('\n')
    const parsed = parseOfx(`<OFX><STMTRS><CURDEF>BRL<BANKTRANLIST>${rows}</BANKTRANLIST></STMTRS></OFX>`)
    expect(parsed.fileErrors[0]).toMatch(/mais de 5000/)
    expect(parsed.transactions).toEqual([])
  })

  it('strips control characters from statement text', () => {
    const parsed = parseOfx(SGML.replace('PIX RECEBIDO MARIA', 'PIX\u0007 RECEBIDO   MARIA'))
    expect(parsed.transactions[0].memo).toBe('PIX RECEBIDO MARIA')
  })
})

describe('decodeOfxBytes', () => {
  it('reads UTF-8 and strips a BOM', () => {
    const bytes = new TextEncoder().encode('﻿<OFX>Depósito</OFX>')
    expect(decodeOfxBytes(bytes)).toBe('<OFX>Depósito</OFX>')
  })

  it('falls back to windows-1252 for legacy exports', () => {
    // "Depósito" with ó as the single byte 0xF3
    const bytes = Uint8Array.from([0x44, 0x65, 0x70, 0xf3, 0x73, 0x69, 0x74, 0x6f])
    expect(decodeOfxBytes(bytes)).toBe('Depósito')
  })
})

describe('identity and fingerprint', () => {
  const base = { fitid: '1', date: '2026-10-01', amountCents: 1000, memo: 'PIX JOAO' }

  it('does not collapse sequential FITIDs reused on different days or amounts', () => {
    expect(lineIdentityKey(base)).not.toBe(lineIdentityKey({ ...base, date: '2026-10-02' }))
    expect(lineIdentityKey(base)).not.toBe(lineIdentityKey({ ...base, amountCents: 1001 }))
  })

  it('is stable for the same line and ignores memo case and accents when there is no FITID', () => {
    expect(lineIdentityKey(base)).toBe(lineIdentityKey({ ...base }))
    const a = { ...base, fitid: null, memo: 'Depósito  João' }
    const b = { ...base, fitid: null, memo: 'deposito joao' }
    expect(lineIdentityKey(a)).toBe(lineIdentityKey(b))
  })

  it('shares a fingerprint across changed FITIDs but not across different amounts', () => {
    const changedId = { ...base, fitid: '999' }
    expect(lineFingerprint(base)).toBe(lineFingerprint(changedId))
    expect(lineFingerprint(base)).not.toBe(lineFingerprint({ ...base, amountCents: 999 }))
    expect(lineIdentityKey(base)).not.toBe(lineIdentityKey({ ...base, fitid: '999' }))
  })

  it('keeps a reused FITID with another payer, cheque or type apart', () => {
    expect(lineIdentityKey(base)).not.toBe(lineIdentityKey({ ...base, memo: 'PIX MARIA' }))
    expect(lineIdentityKey({ ...base, checkNumber: '101' })).not.toBe(lineIdentityKey({ ...base, checkNumber: '102' }))
    expect(lineIdentityKey({ ...base, type: 'DEBIT' })).not.toBe(lineIdentityKey({ ...base, type: 'FEE' }))
  })

  it('keeps cheques without FITID apart in identity and fingerprint', () => {
    const cheque = { ...base, fitid: null, memo: 'CHEQUE', amountCents: -2500 }
    expect(lineIdentityKey({ ...cheque, checkNumber: '101' })).not.toBe(lineIdentityKey({ ...cheque, checkNumber: '102' }))
    expect(lineFingerprint({ ...cheque, checkNumber: '101' })).not.toBe(lineFingerprint({ ...cheque, checkNumber: '102' }))
  })

  it('hashes a statement independent of nothing but its content', () => {
    const t = parseOfx(SGML).transactions
    expect(statementHash(t)).toBe(statementHash(parseOfx(SGML).transactions))
    expect(statementHash(t)).not.toBe(statementHash(t.slice(1)))
  })

  it('tells statements apart by cheque number, type and memo', () => {
    const [line] = parseOfx(SGML).transactions
    expect(statementHash([line])).not.toBe(statementHash([{ ...line, checkNumber: '102' }]))
    expect(statementHash([line])).not.toBe(statementHash([{ ...line, type: 'DEP' }]))
    expect(statementHash([line])).not.toBe(statementHash([{ ...line, memo: `${line.memo} BOB` }]))
  })
})
