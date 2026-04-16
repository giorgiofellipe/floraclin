<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:date-timezone-rules -->
# Date & timezone conventions

**Context.** Brazil-only product. Production nominally runs in `America/Sao_Paulo`; containers (Vercel, CI, preview deploys) run UTC. A `YYYY-MM-DD` string is a **BR calendar day**, not an instant. `new Date("2026-04-16")` parses as UTC midnight, which silently becomes the previous day in BR (−3h). Every date bug we've shipped has been a variant of this.

## The rule

**Never do this:**

- `new Date(yyyyMmDd)` — bare. Parses as UTC.
- `someDate.toISOString().split('T')[0]` — converts to UTC first, can flip the day.
- `format(new Date(), 'yyyy-MM-dd')` in server code — uses the process TZ, wrong on UTC hosts.
- `moment(...)` — not installed, don't add it.
- `cron.schedule("0 8 * * *", fn)` without an explicit `{ timezone: 'America/Sao_Paulo' }` option.

**Always use `@/lib/dates`:**

| Context | Helper | Returns |
|---------|--------|---------|
| Date-range filter lower bound (server) | `startOfBrDay(ymd)` | `Date` at BR 00:00 → UTC instant |
| Date-range filter upper bound (server) | `endOfBrDay(ymd)` | `Date` at BR 23:59:59.999 → UTC instant |
| User-entered BR calendar day, anchored to a safe time | `parseBrDate(ymd, '12:00:00')` | `Date` at BR noon → UTC instant |
| Client/browser: user-picked date, local-anchored | `parseLocalDate(ymd, '12:00:00')` | `Date` at host-local clock |
| "Today" as a string, regardless of host TZ | `brToday()` | `'YYYY-MM-DD'` in BR |
| Instant → BR calendar day | `toBrYmd(date)` | `'YYYY-MM-DD'` |
| Date → `YYYY-MM-DD` using local getters (no UTC round-trip) | `toLocalYmd(date)` | `'YYYY-MM-DD'` |

All helpers live in `web/src/lib/dates.ts` and wrap `date-fns` / `date-fns-tz`. Don't reach for the underlying libraries directly in feature code unless you have a specific reason — the helpers exist so the rule is trivially reachable.

## DB column conventions

- `timestamp({ withTimezone: true })` (`timestamptz`) — real-world instants: `createdAt`, `paidAt`, `performedAt`, `movementDate`. Compare with `gte`/`lte` against helper-built `Date` objects.
- `date` (DATE) — BR calendar days: `installments.dueDate`, `expenseInstallments.dueDate`, `appointments.date`, `procedureRecords.followUpDate`. Stored as `YYYY-MM-DD` strings; never call `new Date()` on them directly — route through `parseBrDate` or `startOfBrDay` first.

## Gotchas

1. **Never `new Date("YYYY-MM-DD")` bare.** Append `T00:00:00` / `T12:00:00` (client, local) or use `startOfBrDay` / `parseBrDate` (server, BR-safe).
2. **Never `.toISOString().split('T')[0]`** — converts to UTC first. Use `toLocalYmd(date)` or `toBrYmd(date)`.
3. **Cron/background jobs**: pass `{ timezone: 'America/Sao_Paulo' }` explicitly. `"0 8 * * *"` on a UTC container fires at 05:00 BRT — three hours off — unless you tell it otherwise. (No cron jobs exist today. This rule is a guardrail for when they're added.)
4. **Unit tests that compare against "today"** should construct dates via `parseBrDate` or mock `Date.now()` — `new Date()` inside a test breaks on UTC CI around midnight BRT.
5. **Filter ranges**: lower bound uses `startOfBrDay`, upper bound uses `endOfBrDay`. Do not mix bare `new Date(dateFrom)` with `setHours(23,59,59,999)` — the `setHours` call operates on whatever TZ the runtime is in, which isn't BR on Vercel.

## Do / Don't examples

**Filtering financial entries (Extrato):**

```ts
// ❌ DON'T — UTC midnight boundaries; misses or includes a BR day depending on host
sql`${financialEntries.createdAt} >= ${dateFrom}::timestamp`

// ✅ DO — BR-local boundaries, host-independent
import { startOfBrDay, endOfBrDay } from '@/lib/dates'
gte(financialEntries.createdAt, startOfBrDay(dateFrom))
lte(financialEntries.createdAt, endOfBrDay(dateTo))
```

**Generating an installment due date:**

```ts
// ❌ DON'T — on UTC host, this produces the next BR day at 21:00 BRT and later
addDays(today, 30).toISOString().split('T')[0]

// ✅ DO — uses local getters, no UTC round-trip
import { toLocalYmd } from '@/lib/dates'
toLocalYmd(addDays(today, 30))
```

**Calculating days overdue on a `YYYY-MM-DD` due date:**

```ts
// ❌ DON'T — UTC midnight; the day flips by one on UTC hosts
const due = new Date(dueDate)

// ✅ DO — BR-local midnight, safe everywhere
import { startOfBrDay } from '@/lib/dates'
const due = startOfBrDay(dueDate)
```

## When in doubt

Ask: "Is this a calendar day or an instant?"

- **Calendar day** (due date, follow-up date, appointment date, report window) → BR-anchored helper.
- **Instant** (createdAt, paidAt, performedAt, signed_at) → raw `Date`, compared with helper-built boundaries when ranging.
<!-- END:date-timezone-rules -->
