# Manual Calendar Blocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a clinic block its agenda by hand (personal appointments, closing the clinic) without a patient and without Google Calendar.

**Architecture:** `calendar_blocks` already stores Google-synced "Indisponível" blocks and the agenda already renders and deletes them. This plan makes the table accept manual rows (no connection, no Google event id, optional practitioner where NULL means the whole clinic), adds one create route, and one dialog. Blocks are enforced in both places appointments are decided: slot discovery (`getAvailableSlots`) and the write-time conflict check (`checkTimeConflict`, used by internal create, reschedule, and public booking).

**Tech Stack:** Next.js 16 App Router, Drizzle ORM (postgres-js, `floraclin` schema), Zod 4, TanStack Query, Vitest + Testing Library. Base-ui `Select`, `DatePicker`, `Switch` from `@/components/ui`.

**Spec:** Approved in chat (2026-10-07). Decisions: one practitioner or the whole clinic; single day, time range or all day; manual blocks render as "Indisponível" like Google blocks (title visible when opening the block); no push to Google. Adversarial review (2026-10-08) added: write-time enforcement, tenant check on the target practitioner, UI delete gating by the same rule as the route, no slot context menu (none exists), shared time options module, real calendar-date validation, time normalisation in slot math.

## Global Constraints

- All commands in this plan run from `web/` (`pnpm exec vitest run <path>`, `pnpm exec tsc --noEmit`, `pnpm exec eslint <path>`). The final gate is `pnpm ci:checks` from the repo root.
- No em dashes anywhere (code, comments, commit messages, tests).
- Comments only where a competent reader would get it wrong.
- Tests never hit Supabase: mock `@/db/client`. Every test names the regression it catches. A test that passes before the change is not a regression test.
- Dates: `YYYY-MM-DD` strings are BR calendar days. Times are `HH:MM` strings in the API; Postgres returns `HH:MM:SS`, so slice to five characters before comparing.
- Roles: owner and practitioner, through `requireWrite('owner', 'practitioner')`, same as the existing delete route. A practitioner only touches blocks on their own agenda. An owner touches any block, including clinic-wide ones. Receptionist and financial see no block controls.
- Google-synced blocks cannot be deleted from FloraClin (they come back on the next sync). The route answers 409.
- Only touch the files listed in your task.

## Shared test helper (copy into each query test)

```ts
// Thenable builder: every method returns the chain; awaiting it yields `result`.
function chain(result: unknown) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'from', 'leftJoin', 'innerJoin', 'where', 'orderBy', 'limit', 'insert', 'values', 'returning', 'update', 'set', 'delete']) {
    c[m] = vi.fn(() => c)
  }
  c.then = (resolve: (v: unknown) => void) => resolve(result)
  return c
}

const { selectMock, insertMock } = vi.hoisted(() => ({ selectMock: vi.fn(), insertMock: vi.fn() }))
vi.mock('@/db/client', () => ({ db: { select: selectMock, insert: insertMock } }))
```

To assert the predicate shape, mock `drizzle-orm` partially and spy on `or` and `isNull`:

```ts
const { orSpy, isNullSpy } = vi.hoisted(() => ({ orSpy: vi.fn(), isNullSpy: vi.fn() }))
vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm')
  return {
    ...actual,
    or: (...args: unknown[]) => { orSpy(...args); return (actual.or as (...a: unknown[]) => unknown)(...args) },
    isNull: (col: unknown) => { isNullSpy(col); return (actual.isNull as (c: unknown) => unknown)(col) },
  }
})
```

Assert `isNullSpy` was called with the `calendarBlocks.practitionerId` column object (import `calendarBlocks` from `@/db/schema`, which is not mocked).

## File Structure

| File | Responsibility |
|---|---|
| `web/src/db/migrations/0031_manual_calendar_blocks.sql` | Nullable `practitioner_id`, `connection_id`, `google_event_id`; `source` column with checks |
| `web/src/db/schema.ts` | Mirror the migration on `calendarBlocks` |
| `web/src/db/queries/calendar.ts` | `CalendarBlockRow` nullability, clinic-wide filter, `createManualBlock` with tenant check, `getBlockById`, `source: 'google'` on upsert |
| `web/src/db/queries/appointments.ts` | `getAvailableSlots` and `checkTimeConflict` honour blocks (practitioner and clinic-wide) |
| `web/src/validations/calendar-block.ts` | `createCalendarBlockSchema` |
| `web/src/lib/time-options.ts` | Half-hour time lists for the block dialog |
| `web/src/hooks/queries/use-calendar.ts` | `useCreateCalendarBlock` |
| `web/src/app/api/calendar/blocks/route.ts` | `POST` create |
| `web/src/app/api/calendar/blocks/[id]/route.ts` | `DELETE` with ownership and Google refusal |
| `web/src/components/scheduling/calendar-block-form.tsx` | The dialog |
| `web/src/components/scheduling/calendar-block-menu.tsx` | The block context menu, delete gated by role |
| `web/src/components/scheduling/calendar-view.tsx` | "Bloquear" button, uses the menu component |
| `web/src/components/scheduling/day-view.tsx`, `week-view.tsx` | "Toda a clínica" label for clinic-wide blocks |
| `web/src/app/(platform)/agenda/page.tsx`, `agenda-page-client.tsx` | Pass role and user id down |

## Group A (parallel)

### Task A1: Data layer

**Files:**
- Create: `web/src/db/migrations/0031_manual_calendar_blocks.sql`
- Modify: `web/src/db/schema.ts` (the `calendarBlocks` table, lines 829 to 845)
- Modify: `web/src/db/queries/calendar.ts` (block section from line 291)
- Test: `web/src/db/queries/__tests__/calendar-blocks.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type CalendarBlockSource = 'google' | 'manual'
  export interface CalendarBlockRow {
    id: string
    tenantId: string
    practitionerId: string | null      // null = whole clinic
    practitionerName: string | null
    source: CalendarBlockSource
    title: string | null
    date: string
    startTime: string | null
    endTime: string | null
    allDay: boolean
    status: string
  }
  export async function listBlocksForDateRange(tenantId, practitionerId: string | undefined, dateFrom, dateTo): Promise<CalendarBlockRow[]>
  export async function createManualBlock(tenantId: string, data: { practitionerId: string | null; title: string | null; date: string; startTime: string | null; endTime: string | null; allDay: boolean }): Promise<{ id: string }>
    // throws BusinessError('PRACTITIONER_NOT_FOUND', 'Profissional não encontrado') when practitionerId is not an active owner or practitioner of the tenant
  export async function getBlockById(tenantId: string, blockId: string): Promise<{ id: string; practitionerId: string | null; source: CalendarBlockSource } | null>
  export async function deleteBlockById(tenantId: string, blockId: string)  // unchanged
  ```
  `connectionId` and `googleEventId` leave `CalendarBlockRow`: no UI reads them.

- [ ] **Step 1: Write the migration**

```sql
ALTER TABLE "floraclin"."calendar_blocks" ALTER COLUMN "practitioner_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "floraclin"."calendar_blocks" ALTER COLUMN "connection_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "floraclin"."calendar_blocks" ALTER COLUMN "google_event_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "floraclin"."calendar_blocks" ADD COLUMN "source" varchar(10) NOT NULL DEFAULT 'google';
--> statement-breakpoint
ALTER TABLE "floraclin"."calendar_blocks" ADD CONSTRAINT "calendar_blocks_source_check" CHECK ("source" IN ('google', 'manual'));
--> statement-breakpoint
ALTER TABLE "floraclin"."calendar_blocks" ADD CONSTRAINT "calendar_blocks_source_shape_check" CHECK (("source" = 'google') = ("connection_id" IS NOT NULL AND "google_event_id" IS NOT NULL));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_calendar_blocks_tenant_date" ON "floraclin"."calendar_blocks" ("tenant_id", "date");
```

The `'google'` default stays: an old instance still running during the deploy inserts without `source`. Manual inserts always name theirs.

- [ ] **Step 2: Mirror it in `schema.ts`**

```ts
export const calendarBlocks = floraclinSchema.table('calendar_blocks', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  practitionerId: uuid('practitioner_id').references(() => users.id),
  connectionId: uuid('connection_id').references(() => calendarConnections.id, { onDelete: 'cascade' }),
  googleEventId: varchar('google_event_id', { length: 255 }),
  source: varchar('source', { length: 10 }).notNull().default('google'),
  title: varchar('title', { length: 255 }),
  date: date('date').notNull(),
  startTime: time('start_time'),
  endTime: time('end_time'),
  allDay: boolean('all_day').notNull().default(false),
  status: varchar('status', { length: 20 }).notNull().default('confirmed'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_calendar_blocks_practitioner_date').on(table.tenantId, table.practitionerId, table.date),
  index('idx_calendar_blocks_tenant_date').on(table.tenantId, table.date),
])
```

- [ ] **Step 3: Write the failing query tests** (helper and drizzle spies from the top of this plan)

```ts
describe('listBlocksForDateRange', () => {
  it('includes clinic-wide blocks when filtering by practitioner', async () => {
    // Regression: a filter of practitioner_id = X alone hides the clinic closure from that practitioner's agenda.
    selectMock.mockReturnValueOnce(chain([]))
    await listBlocksForDateRange('t1', 'p1', '2026-10-12', '2026-10-18')
    expect(isNullSpy).toHaveBeenCalledWith(calendarBlocks.practitionerId)
    expect(orSpy).toHaveBeenCalledTimes(1)
  })
  it('does not add the clinic-wide clause without a practitioner filter', async () => {
    selectMock.mockReturnValueOnce(chain([]))
    await listBlocksForDateRange('t1', undefined, '2026-10-12', '2026-10-18')
    expect(orSpy).not.toHaveBeenCalled()
  })
  it('left joins users so a clinic-wide block survives the join', async () => {
    // Regression: innerJoin drops rows whose practitioner_id is NULL.
    const c = chain([]); selectMock.mockReturnValueOnce(c)
    await listBlocksForDateRange('t1', undefined, '2026-10-12', '2026-10-18')
    expect(c.leftJoin).toHaveBeenCalled()
    expect(c.innerJoin).not.toHaveBeenCalled()
  })
})

describe('createManualBlock', () => {
  it('inserts source manual with no connection or google event id', async () => {
    selectMock.mockReturnValueOnce(chain([{ id: 'p1' }]))   // membership check
    const ins = chain([{ id: 'b1' }]); insertMock.mockReturnValueOnce(ins)
    await createManualBlock('t1', { practitionerId: 'p1', title: null, date: '2026-10-12', startTime: '12:00', endTime: '13:00', allDay: false })
    expect(ins.values).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', source: 'manual', connectionId: null, googleEventId: null, practitionerId: 'p1' }))
  })
  it('skips the membership check for a clinic-wide block', async () => {
    const ins = chain([{ id: 'b1' }]); insertMock.mockReturnValueOnce(ins)
    await createManualBlock('t1', { practitionerId: null, title: 'Fechado', date: '2026-10-12', startTime: null, endTime: null, allDay: true })
    expect(selectMock).not.toHaveBeenCalled()
  })
  it('refuses a practitioner outside the tenant or without a clinical role', async () => {
    // Regression: the FK points at users, not tenant membership, so an owner could pin a block to any user id in the system.
    selectMock.mockReturnValueOnce(chain([]))
    await expect(createManualBlock('t1', { practitionerId: 'stranger', title: null, date: '2026-10-12', startTime: null, endTime: null, allDay: true }))
      .rejects.toMatchObject({ code: 'PRACTITIONER_NOT_FOUND' })
    expect(insertMock).not.toHaveBeenCalled()
  })
})

describe('upsertCalendarBlock', () => {
  it('stamps source google on insert', async () => {
    selectMock.mockReturnValueOnce(chain([]))   // existing lookup
    const ins = chain([{ id: 'b1' }]); insertMock.mockReturnValueOnce(ins)
    await upsertCalendarBlock({ tenantId: 't1', practitionerId: 'p1', connectionId: 'c1', googleEventId: 'g1', title: null, date: '2026-10-12', startTime: null, endTime: null, allDay: true, status: 'confirmed' })
    expect(ins.values).toHaveBeenCalledWith(expect.objectContaining({ source: 'google' }))
  })
})
```

- [ ] **Step 4: Run them, confirm they fail**

Run: `pnpm exec vitest run src/db/queries/__tests__/calendar-blocks.test.ts`
Expected: FAIL (`createManualBlock` not exported; `innerJoin` called; `source` missing).

- [ ] **Step 5: Implement in `calendar.ts`**

Imports: add `or` to the `drizzle-orm` import (`isNull` is already there); `tenantUsers` to the schema import; `BusinessError` from `@/lib/errors`.

```ts
export type CalendarBlockSource = 'google' | 'manual'

export async function listBlocksForDateRange(tenantId, practitionerId, dateFrom, dateTo): Promise<CalendarBlockRow[]> {
  const conditions = [
    eq(calendarBlocks.tenantId, tenantId),
    gte(calendarBlocks.date, dateFrom),
    lte(calendarBlocks.date, dateTo),
    ne(calendarBlocks.status, 'cancelled'),
  ]
  if (practitionerId) {
    conditions.push(or(eq(calendarBlocks.practitionerId, practitionerId), isNull(calendarBlocks.practitionerId))!)
  }
  return db
    .select({
      id: calendarBlocks.id,
      tenantId: calendarBlocks.tenantId,
      practitionerId: calendarBlocks.practitionerId,
      practitionerName: users.fullName,
      source: sql<CalendarBlockSource>`${calendarBlocks.source}`,
      title: calendarBlocks.title,
      date: calendarBlocks.date,
      startTime: calendarBlocks.startTime,
      endTime: calendarBlocks.endTime,
      allDay: calendarBlocks.allDay,
      status: calendarBlocks.status,
    })
    .from(calendarBlocks)
    .leftJoin(users, eq(calendarBlocks.practitionerId, users.id))
    .where(and(...conditions))
    .orderBy(calendarBlocks.date, calendarBlocks.startTime)
}

async function assertClinicalMember(tenantId: string, userId: string) {
  const [member] = await db
    .select({ id: tenantUsers.userId })
    .from(tenantUsers)
    .where(
      and(
        eq(tenantUsers.tenantId, tenantId),
        eq(tenantUsers.userId, userId),
        eq(tenantUsers.isActive, true),
        or(eq(tenantUsers.role, 'practitioner'), eq(tenantUsers.role, 'owner')),
      ),
    )
    .limit(1)
  if (!member) throw new BusinessError('PRACTITIONER_NOT_FOUND', 'Profissional não encontrado')
}

export async function createManualBlock(tenantId: string, data: { ... }) {
  if (data.practitionerId) await assertClinicalMember(tenantId, data.practitionerId)
  const [row] = await db
    .insert(calendarBlocks)
    .values({ tenantId, source: 'manual', connectionId: null, googleEventId: null, status: 'confirmed', ...data })
    .returning({ id: calendarBlocks.id })
  return row
}

export async function getBlockById(tenantId: string, blockId: string) {
  const [row] = await db
    .select({ id: calendarBlocks.id, practitionerId: calendarBlocks.practitionerId, source: sql<CalendarBlockSource>`${calendarBlocks.source}` })
    .from(calendarBlocks)
    .where(and(eq(calendarBlocks.id, blockId), eq(calendarBlocks.tenantId, tenantId)))
    .limit(1)
  return row ?? null
}
```

`upsertCalendarBlock`: the insert becomes `.values({ ...data, source: 'google' })`. `google-calendar-pull.ts` needs no change. Remove `connectionId` and `googleEventId` from `CalendarBlockRow` and the select. Check `tenantUsers` column names in `schema.ts` (`userId`, `tenantId`, `role`, `isActive`) against `listPractitioners` in `appointments.ts:728`.

- [ ] **Step 6: Run the tests, confirm they pass.** Do not run the repo typecheck: Group B files will fail on `practitionerName` being nullable until B2 lands. Report the exports you produced.

### Task A2: Availability and conflicts honour blocks

**Files:**
- Modify: `web/src/db/queries/appointments.ts` (`checkTimeConflict` at line 136, `getAvailableSlots` at line 402)
- Test: `web/src/db/queries/__tests__/appointments-blocks.test.ts`

- [ ] **Step 1: Write the failing tests** (helper and spies from the top of this plan; `selectMock` is consumed in call order)

```ts
describe('checkTimeConflict', () => {
  // Call order inside the function: appointments count, then blocks count.
  it('reports a conflict when a block covers the slot even with no appointment', async () => {
    // Regression: public booking rechecks only appointments at write time, so a slot blocked after the picker loaded was still bookable.
    selectMock.mockReturnValueOnce(chain([{ count: 0 }]))
    selectMock.mockReturnValueOnce(chain([{ count: 1 }]))
    expect(await checkTimeConflict('t1', 'p1', '2026-10-12', '10:00', '10:30')).toBe(true)
  })
  it('matches blocks for the practitioner or the whole clinic', async () => {
    selectMock.mockReturnValueOnce(chain([{ count: 0 }]))
    selectMock.mockReturnValueOnce(chain([{ count: 0 }]))
    await checkTimeConflict('t1', 'p1', '2026-10-12', '10:00', '10:30')
    expect(isNullSpy).toHaveBeenCalledWith(calendarBlocks.practitionerId)
  })
  it('returns false when neither appointments nor blocks overlap', ...)
})

describe('getAvailableSlots', () => {
  // Call order: tenant working hours, appointments, blocks. Use Monday 2026-10-12 with mon enabled 08:00 to 12:00.
  it('returns no slots on a clinic-wide all-day block', async () => {
    // The data path alone cannot prove the SQL filter, so also assert the clinic-wide clause was built.
    ... blocks: [{ startTime: null, endTime: null, allDay: true }]
    expect(result).toEqual([])
    expect(isNullSpy).toHaveBeenCalledWith(calendarBlocks.practitionerId)
  })
  it('treats a block ending at 10:00 as free for the 10:00 slot even with seconds from the database', async () => {
    // Regression: '10:00:00' > '10:00' is true as strings, so the adjacent slot was suppressed.
    ... blocks: [{ startTime: '09:00:00', endTime: '10:00:00', allDay: false }]
    expect(result.map((s) => s.start)).toEqual(['10:00', '10:30', '11:00', '11:30'])
  })
  it('suppresses a slot that partially overlaps a block', ...)   // block 09:15:00 to 09:45:00 removes 09:00 and 09:30
})
```

- [ ] **Step 2: Run, confirm they fail.**

- [ ] **Step 3: Implement**

`checkTimeConflict`: after the appointment count, add

```ts
  const blockRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(calendarBlocks)
    .where(
      and(
        eq(calendarBlocks.tenantId, tenantId),
        or(eq(calendarBlocks.practitionerId, practitionerId), isNull(calendarBlocks.practitionerId)),
        eq(calendarBlocks.date, date),
        ne(calendarBlocks.status, 'cancelled'),
        or(
          eq(calendarBlocks.allDay, true),
          and(sql`${calendarBlocks.startTime} < ${endTime}::time`, sql`${calendarBlocks.endTime} > ${startTime}::time`),
        ),
      ),
    )
  return Number(result[0].count) > 0 || Number(blockRows[0].count) > 0
```

`getAvailableSlots`: the blocks query gets `or(eq(calendarBlocks.practitionerId, practitionerId), isNull(calendarBlocks.practitionerId))` in place of the plain `eq`. In the slot loop, compare on five-character times for both appointments and blocks:

```ts
const hhmm = (t: string) => t.slice(0, 5)
const hasAppointmentConflict = existing.some((a) => hhmm(a.startTime) < slotEnd && hhmm(a.endTime) > slotStart)
const hasBlockConflict = blocks.some((b) => b.allDay || (!!b.startTime && !!b.endTime && hhmm(b.startTime) < slotEnd && hhmm(b.endTime) > slotStart))
```

- [ ] **Step 4: Run the tests, confirm they pass. Also run `pnpm exec vitest run src/db/queries/__tests__/appointment-reschedule.test.ts src/app/api/book src/app/api/appointments` and fix any mock call-order breakage caused by the second count query (those suites mock `checkTimeConflict` or the db; adjust queued mocks only, never assertions).**

### Task A3: Validation and time options

**Files:**
- Create: `web/src/validations/calendar-block.ts`
- Create: `web/src/lib/time-options.ts`
- Test: `web/src/validations/__tests__/calendar-block.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // validations/calendar-block.ts
  export const createCalendarBlockSchema
  export type CreateCalendarBlockInput = { practitionerId: string | null; date: string; allDay: boolean; startTime?: string; endTime?: string; title?: string }
  // lib/time-options.ts
  export function halfHourTimes(fromHour: number, toHour: number): string[]   // inclusive bounds, 'HH:MM', e.g. halfHourTimes(7, 21) ends with '21:00'
  export function timeItems(times: string[]): Record<string, string>
  export const BLOCK_START_TIMES = halfHourTimes(7, 20)   // 07:00 .. 20:30
  export const BLOCK_END_TIMES = halfHourTimes(7, 21)     // 07:30 .. 21:00 (drop the first entry)
  ```

- [ ] **Step 1: Write the failing tests**

```ts
describe('createCalendarBlockSchema', () => {
  const base = { practitionerId: '11111111-1111-4111-8111-111111111111', date: '2026-10-12' }
  it('accepts a timed block', ...)                       // allDay false, 12:00 to 13:00
  it('accepts an all-day clinic-wide block', ...)        // practitionerId null, allDay true
  it('rejects a timed block without both times', ...)
  it('rejects end before or equal to start', ...)        // 13:00/13:00 and 13:00/12:00
  it('rejects a malformed time', ...)                    // '9:00', '25:00'
  it('rejects a date that does not exist', ...)          // '2026-02-30', '2026-13-01'; accepts '2028-02-29'
  it('trims the title and rejects more than 120 chars', ...)
})
describe('halfHourTimes', () => {
  it('is inclusive at both ends', () => expect(halfHourTimes(20, 21)).toEqual(['20:00', '20:30', '21:00']))
})
```

- [ ] **Step 2: Run, confirm they fail** (modules missing).

- [ ] **Step 3: Implement**

```ts
// validations/calendar-block.ts
import { z } from 'zod'
import { isValidYmd } from '@/lib/dates'

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export const createCalendarBlockSchema = z
  .object({
    practitionerId: z.string().uuid().nullable(),
    date: z.string().refine(isValidYmd, 'Data inválida'),
    allDay: z.boolean(),
    startTime: z.string().regex(TIME, 'Horário inválido').optional(),
    endTime: z.string().regex(TIME, 'Horário inválido').optional(),
    title: z.string().trim().max(120, 'Máximo de 120 caracteres').optional(),
  })
  .superRefine((data, ctx) => {
    if (data.allDay) return
    if (!data.startTime || !data.endTime) {
      ctx.addIssue({ code: 'custom', path: ['startTime'], message: 'Informe início e fim' })
      return
    }
    if (data.endTime <= data.startTime) {
      ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'Fim deve ser depois do início' })
    }
  })

export type CreateCalendarBlockInput = z.infer<typeof createCalendarBlockSchema>
```

Check `isValidYmd` in `web/src/lib/dates.ts:86` rejects impossible dates (not only the shape). If it only checks the shape, extend it there and add that file to your list.

```ts
// lib/time-options.ts
export function halfHourTimes(fromHour: number, toHour: number): string[] {
  const out: string[] = []
  for (let h = fromHour; h <= toHour; h++) {
    for (const m of [0, 30]) {
      if (h === toHour && m === 30) break
      out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    }
  }
  return out
}
export function timeItems(times: string[]): Record<string, string> {
  return Object.fromEntries(times.map((t) => [t, t]))
}
export const BLOCK_START_TIMES = halfHourTimes(7, 21).slice(0, -1)
export const BLOCK_END_TIMES = halfHourTimes(7, 21).slice(1)
```

- [ ] **Step 4: Run, confirm they pass.**

### Task A4: Mutation hook

**Files:**
- Modify: `web/src/hooks/queries/use-calendar.ts`

- [ ] **Step 1: Implement**

```ts
import type { CreateCalendarBlockInput } from '@/validations/calendar-block'

export function useCreateCalendarBlock() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateCalendarBlockInput) => {
      const res = await fetch('/api/calendar/blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Erro ao bloquear horário')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.calendar.all })
    },
  })
}
```

The type import resolves once A3 lands in the same group. No test: a fetch wrapper with no branching; the dialog test covers it through a mocked hook.

## Group B (depends on A)

### Task B1: Routes

**Files:**
- Modify: `web/src/app/api/calendar/blocks/route.ts` (add `POST`)
- Modify: `web/src/app/api/calendar/blocks/[id]/route.ts`
- Test: `web/src/app/api/calendar/blocks/__tests__/route.test.ts`
- Test: `web/src/app/api/calendar/blocks/[id]/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `createCalendarBlockSchema` (A3), `createManualBlock`, `getBlockById`, `deleteBlockById` (A1), `requireWrite` from `@/lib/write-access`, `createAuditLog` from `@/lib/audit`, `BusinessError` from `@/lib/errors`.

- [ ] **Step 1: Write the failing route tests**

Mock pattern: `web/src/app/api/calendar/webhook/__tests__/route.test.ts` (mocks `@/lib/write-access` with `requireWrite: vi.fn()` resolving `{ ctx, blocked: null }`). Also mock `@/db/queries/calendar` and `@/lib/audit`. `ctx` carries `tenantId`, `userId`, `role`.

POST cases:
1. owner creates a clinic-wide all-day block: 201, `createManualBlock` called with `practitionerId: null`, audit logged with `entityType: 'calendar_block'`.
2. practitioner creates a block on their own agenda: 201.
3. practitioner creating for another practitioner or for the clinic: 403, nothing created.
4. owner names a practitioner the query rejects (`createManualBlock` rejects with `BusinessError('PRACTITIONER_NOT_FOUND', ...)`): 404 with that message.
5. invalid body (timed block without end): 400 with `fieldErrors`.
6. blocked subscription response returned untouched.

DELETE cases:
1. owner deletes a manual block: 200.
2. practitioner deletes their own manual block: 200; another practitioner's or a clinic-wide one: 403, `deleteBlockById` not called.
3. Google-synced block: 409 with `error: 'Bloqueio sincronizado do Google Agenda. Remova o evento no Google.'`, `deleteBlockById` not called.
4. unknown id: 404.

- [ ] **Step 2: Run, confirm they fail.**

- [ ] **Step 3: Implement `POST`**

```ts
export async function POST(request: Request) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'practitioner')
    if (blocked) return blocked

    const parsed = createCalendarBlockSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const data = parsed.data

    if (ctx.role === 'practitioner' && data.practitionerId !== ctx.userId) {
      return NextResponse.json({ error: 'Você só pode bloquear a sua própria agenda' }, { status: 403 })
    }

    const block = await createManualBlock(ctx.tenantId, {
      practitionerId: data.practitionerId,
      title: data.title || null,
      date: data.date,
      startTime: data.allDay ? null : data.startTime!,
      endTime: data.allDay ? null : data.endTime!,
      allDay: data.allDay,
    })

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'create',
      entityType: 'calendar_block',
      entityId: block.id,
      changes: { block: { old: null, new: data } },
    })

    return NextResponse.json({ data: block }, { status: 201 })
  } catch (error) {
    if (error instanceof BusinessError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 404 })
    }
    return handleApiError(error, request)
  }
}
```

- [ ] **Step 4: Implement `DELETE`**

```ts
    const block = await getBlockById(ctx.tenantId, id)
    if (!block) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (block.source === 'google') {
      return NextResponse.json(
        { error: 'Bloqueio sincronizado do Google Agenda. Remova o evento no Google.' },
        { status: 409 },
      )
    }
    if (ctx.role === 'practitioner' && block.practitionerId !== ctx.userId) {
      return NextResponse.json({ error: 'Você só pode remover bloqueios da sua própria agenda' }, { status: 403 })
    }
    await deleteBlockById(ctx.tenantId, id)
    await createAuditLog({ tenantId: ctx.tenantId, userId: ctx.userId, action: 'delete', entityType: 'calendar_block', entityId: id, changes: { block: { old: block, new: null } } })
    return NextResponse.json({ success: true })
```

Audit after the write, without a transaction, is the house pattern (see the pay route); keep it.

- [ ] **Step 5: Run the tests, confirm they pass. Run `pnpm exec tsc --noEmit` and fix only errors inside your files.**

### Task B2: Dialog, block menu, and agenda wiring

**Files:**
- Create: `web/src/components/scheduling/calendar-block-form.tsx`
- Create: `web/src/components/scheduling/calendar-block-menu.tsx`
- Modify: `web/src/components/scheduling/calendar-view.tsx`
- Modify: `web/src/components/scheduling/day-view.tsx` (line 224 area)
- Modify: `web/src/components/scheduling/week-view.tsx` (line 241 area)
- Modify: `web/src/app/(platform)/agenda/page.tsx` and `web/src/app/(platform)/agenda/agenda-page-client.tsx`
- Test: `web/src/components/scheduling/__tests__/calendar-block-form.test.tsx`
- Test: `web/src/components/scheduling/__tests__/calendar-block-menu.test.tsx`

**Interfaces:**
- Consumes: `useCreateCalendarBlock` (A4), `createCalendarBlockSchema`, `CreateCalendarBlockInput` (A3), `BLOCK_START_TIMES`, `BLOCK_END_TIMES`, `timeItems` (A3), `CalendarBlockRow` with nullable `practitionerName` and `source` (A1), `Role` from `@/types`.
- Produces:
  ```ts
  interface CalendarBlockFormProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    practitioners: { id: string; fullName: string }[]
    canBlockClinic: boolean           // owner only
    lockedPractitionerId?: string     // practitioner role: select hidden, value fixed
    defaultDate: string
  }
  interface CalendarBlockMenuProps {
    block: CalendarBlockRow
    position: { x: number; y: number }
    canDelete: boolean
    onDelete: () => void
    menuRef: React.RefObject<HTMLDivElement | null>
  }
  export function canDeleteBlock(block: CalendarBlockRow, role: Role, userId: string): boolean
    // manual && (owner || (practitioner && block.practitionerId === userId))
  ```

- [ ] **Step 1: Write the failing tests**

Form test: mock `@/hooks/queries/use-calendar` so `useCreateCalendarBlock` returns `{ mutateAsync, isPending: false }`; mock `@/components/ui/select` with a native `<select>` the way `web/src/components/patients/__tests__/patient-consent-tab.test.tsx` does; mock `@/components/ui/date-picker` with a native date input; mock `sonner`. Cases:
1. all-day clinic-wide: pick "Toda a clínica", toggle "Dia inteiro", submit; `mutateAsync` called with `{ practitionerId: null, date, allDay: true, title: '' }` and no times.
2. timed block: defaults start 08:00 and end 09:00; submit sends both.
3. `canBlockClinic` false hides "Toda a clínica"; `lockedPractitionerId` hides the select and submits that id.
4. end before start shows "Fim deve ser depois do início" and does not submit.
5. mutation rejects with `Error('Você só pode bloquear a sua própria agenda')`: toast error with that message, dialog stays open, `onOpenChange(false)` not called.

Menu test (pure component, no mocks beyond none): `canDeleteBlock` table: google block never; manual clinic-wide: owner yes, practitioner no; manual own: practitioner yes; manual other's: practitioner no; receptionist never. Rendering: Google block shows "Sincronizado do Google Agenda" and no button; manual block with `canDelete` false shows no button; manual with title shows the title in the header and "Toda a clínica" when `practitionerName` is null.

- [ ] **Step 2: Run, confirm they fail.**

- [ ] **Step 3: Implement the dialog**

Mirror `appointment-form.tsx` for structure and classes (labels `uppercase tracking-wider text-xs font-medium text-mid`; footer buttons `border-sage/30 text-charcoal hover:bg-[#F0F7F1]` and `bg-forest text-cream hover:bg-sage`). Fields: practitioner `Select` (items `{ clinic: 'Toda a clínica' }` first when `canBlockClinic`, then practitioners; hidden when `lockedPractitionerId`), `DatePicker`, `Switch` "Dia inteiro" (`checked`, `onCheckedChange`), start and end `Select` using `timeItems(BLOCK_START_TIMES)` and `timeItems(BLOCK_END_TIMES)` (hidden when all day), `Input` "Descrição (opcional)". On submit: `createCalendarBlockSchema.safeParse`, show the first issue message under its field; then `try { await mutateAsync(data); toast.success('Horário bloqueado'); onOpenChange(false) } catch (err) { toast.error(err instanceof Error ? err.message : 'Erro ao bloquear horário') }`. Reset fields when the dialog opens.

- [ ] **Step 4: Implement the menu component**

Move the JSX of the existing block context menu (`calendar-view.tsx` lines 513 to 545) into `calendar-block-menu.tsx`. Header: first line `block.source === 'manual' && block.title ? block.title : 'Indisponível'`; second line the time range plus `block.practitionerName ?? 'Toda a clínica'`. Body: Google block renders `<p className="px-3 py-2 text-xs text-mid">Sincronizado do Google Agenda</p>`; manual with `canDelete` renders the existing red "Remover bloqueio" button; manual without `canDelete` renders nothing below the header.

- [ ] **Step 5: Wire `calendar-view.tsx`**

1. Props: add `role: Role` and `userId: string`.
2. Toolbar: an outline button "Bloquear" with `BanIcon` from lucide next to "Agendar" (`data-testid="calendar-new-block"`), rendered only when `role === 'owner' || role === 'practitioner'`, opening the dialog with `defaultDate = format(currentDate, 'yyyy-MM-dd')`.
3. Replace the inline block menu with `<CalendarBlockMenu block={blockMenu.block} position={blockMenu} canDelete={canDeleteBlock(blockMenu.block, role, userId)} onDelete={handleBlockDelete} menuRef={blockMenuRef} />`.
4. Render `<CalendarBlockForm ... canBlockClinic={role === 'owner'} lockedPractitionerId={role === 'practitioner' ? userId : undefined} />`.
5. No slot context menu exists (an empty slot click opens the appointment form directly); do not add one.

- [ ] **Step 6: Role plumbing**

`web/src/app/(platform)/agenda/page.tsx` is a server component: make it `async`, call `getAuthContext()` from `@/lib/auth` (the patient page at `web/src/app/(platform)/pacientes/[id]/page.tsx:30` does the same) and render `<AgendaPageClient role={ctx.role} userId={ctx.userId} />`. `agenda-page-client.tsx` accepts both props and forwards them to `CalendarView`.

- [ ] **Step 7: `day-view.tsx` and `week-view.tsx`**

Replace `{block.practitionerName}` with `{block.practitionerName ?? 'Toda a clínica'}`.

- [ ] **Step 8: Run both new tests and the existing scheduling tests, then `pnpm exec tsc --noEmit` and `pnpm exec eslint src/components/scheduling "src/app/(platform)/agenda"`.**

## Group C (after B): full gate

- [ ] `pnpm ci:checks` from the repo root. Zero errors.
- [ ] `git diff | grep '^+' | grep -cP '\x{2014}'` must print 0.

## Accepted and deferred

- Audit writes stay outside a transaction, matching every other route in the app.
- Recurrence and multi-day ranges are out of scope; a future series needs its own identity, not a `source` value.
- Two rapid writes (a block and a booking) can still race between check and insert; the app has no per-day serialisation today and this plan does not add one.
