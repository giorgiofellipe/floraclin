# Patient Self-Service Anamnesis — Cook Plan

## Group 1 — Foundation (parallel, no dependencies)

### Task 1A: Schema + migration
**Modifies:** `src/db/schema.ts`
**Creates:** migration SQL (applied manually)
- Add `anamnesisTokens` table: id, token (uuid unique), patientId, tenantId, expiresAt, usedAt, createdAt, createdBy
- Index on `token` column

### Task 1B: Token query functions
**Creates:** `src/db/queries/anamnesis-tokens.ts`
- `createAnamnesisToken(tenantId, patientId, createdBy)` — 2h expiry
- `getValidToken(token)` — validates not expired, not used, joins patient name
- `markTokenUsed(token)` — atomic WHERE usedAt IS NULL AND expiresAt > now()

### Task 1C: Middleware update
**Modifies:** `src/middleware.ts`
- Add `/a/*` to public routes

## Group 2 — API Routes (depends on Group 1, parallel)

### Task 2A: Link generation endpoint
**Creates:** `src/app/api/patients/[id]/anamnesis-link/route.ts`
- POST, auth required (owner/practitioner/receptionist)
- Generates token, returns URL

### Task 2B: Public token endpoints
**Creates:** `src/app/api/anamnesis/token/[token]/route.ts`
- GET: validate token, return firstName
- PUT: validate token, save anamnesis, mark used

## Group 3 — UI (depends on Group 1, partially Group 2, parallel)

### Task 3A: Anamnesis form publicMode
**Modifies:** `src/components/anamnesis/anamnesis-form.tsx`
- Add `publicMode` + `onSubmit` props
- Disable auto-save in public mode
- Hide facial evaluation section
- Change button text to "Enviar"
- Skip wizard overrides

### Task 3B: Send Anamnesis button + dialog
**Modifies:** `src/components/patients/patient-detail-content.tsx`
**Creates:** `src/components/patients/send-anamnesis-dialog.tsx`
- Button in patient header actions
- Dialog with URL + copy + WhatsApp link

### Task 3C: Public page + layout
**Creates:** `src/app/a/[token]/page.tsx`, `src/app/a/[token]/layout.tsx`, `src/components/anamnesis/public-anamnesis-page.tsx`
- Minimal layout (logo, no sidebar)
- Greeting + form + success screen
- Mobile-first

## Key Notes
- Race condition guard: atomic UPDATE with WHERE usedAt IS NULL
- Token consumer uses `createdBy` as saving user (no patient account)
- Facial evaluation hidden in public mode
- No auto-save in public mode — explicit submit only
