import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { brToday } from '@/lib/dates'
import { birthdayMonthDayPairs, yearFromYmd } from '@/lib/birthdays'
import { getBirthdaysInRange } from '@/db/queries/birthdays'

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    const { searchParams } = new URL(request.url)
    const from = searchParams.get('from') || brToday()
    const to = searchParams.get('to') || from

    const pairs = birthdayMonthDayPairs({ from, to })
    // Derive the occasion year from the FROM date so callers browsing a
    // non-current-year window (e.g. planning a Jan 2027 campaign in Dec 2026)
    // get the correct greeting joins and `ageTurning` math.
    const occasionYear = yearFromYmd(from)
    const rows = await getBirthdaysInRange({
      tenantId: ctx.tenantId,
      monthDayPairs: pairs,
      occasionYear,
    })

    return NextResponse.json({ data: rows })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect'))
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (
      msg.startsWith('parseBrDate expected') ||
      msg.startsWith('parseLocalDate expected') ||
      msg.startsWith('yearFromYmd expected')
    )
      return NextResponse.json({ error: 'Datas inválidas' }, { status: 400 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
