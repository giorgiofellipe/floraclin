# FloraClin MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the complete FloraClin MVP — a multi-tenant SaaS for HOF clinics with patient records, face diagrams, photo management, consent, scheduling, and financial modules.

**Architecture:** Next.js 15 App Router full-stack app. Server Actions for all authenticated mutations. Supabase for Postgres (`floraclin` schema), Auth (server-side only), and Storage. Drizzle ORM. Multi-tenant via app-level `tenant_id` filtering (RLS deferred to post-MVP hardening).

**Tech Stack:** Next.js 15, TypeScript (strict), Tailwind CSS v4, shadcn/ui, Drizzle ORM, Supabase (Auth + Storage + Postgres), React Hook Form + Zod, date-fns, Fabric.js, react-signature-canvas, Recharts, next-intl (pt-BR), Sentry.

**Design Document:** `docs/plans/2026-03-27-floraclin-mvp-design.md`

---

## Dependency Graph & Parallelization Strategy

```
LAYER 0 — Foundation (sequential, must complete first)
  Task 1: Project Scaffolding
  Task 2: Database Schema (Drizzle)
  Task 3: Core Infrastructure (auth, tenant, middleware)
  Task 4: Layout Shell (sidebar, header, providers)
  ─── CHECKPOINT: foundation working, app boots, auth works ───

LAYER 1 — Domain Modules (ALL IN PARALLEL — 8 agents)
  Task 5:  Patient Module       (CRUD + list page ONLY — no detail page)
  Task 6:  Anamnesis Module     (actions + queries + validations + components)
  Task 7:  Scheduling Module    (actions + queries + validations + components + pages)
  Task 8:  Financial Module     (actions + queries + validations + components + pages)
  Task 9:  Consent Module       (actions + queries + validations + components)
  Task 10: Photo Module         (actions + queries + validations + components)
  Task 11: Face Diagram Components (pure client-side editor, no server actions yet)
  Task 12: Settings & User Management (pages + actions)
  ─── CHECKPOINT: all modules work independently ───

LAYER 2 — Integration (IN PARALLEL — 4 agents)
  Task 13: Procedure Module      (ties face diagram + photos + consent + financial — single transaction)
  Task 14: Patient Detail Page   (creates detail page from scratch, wires all tabs)
  Task 15: Public Booking Page   (API routes + public UI)
  Task 16: Onboarding Flow       (reuses Settings components in wizard wrapper)
  ─── CHECKPOINT: all features connected ───

LAYER 3 — Final Assembly (IN PARALLEL — 3 agents)
  Task 17: Dashboard             (aggregates from all modules)
  Task 18: Audit Log Viewer      (owner-only audit UI)
  Task 19: Ship-Blocker Polish   (loading states, mobile nav, error boundaries)
  ─── CHECKPOINT: MVP complete ───
```

---

## LAYER 0 — Foundation (Sequential)

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `drizzle.config.ts`, `.env.local.example`, `.gitignore`, `src/app/layout.tsx`, `src/app/globals.css`

**Step 1: Initialize Next.js project**

```bash
cd /Users/giorgiofellipe/Work/floraclin
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --turbopack
```

Accept defaults. This creates the base Next.js 15 app.

**Step 2: Install all dependencies**

```bash
npm install drizzle-orm @supabase/supabase-js @supabase/ssr postgres zod react-hook-form @hookform/resolvers date-fns date-fns-tz next-intl recharts react-signature-canvas fabric @sentry/nextjs resend

npm install -D drizzle-kit @types/react-signature-canvas
```

**Step 3: Initialize shadcn/ui**

```bash
npx shadcn@latest init -d
```

Then add core components:

```bash
npx shadcn@latest add button input label card dialog sheet select tabs table textarea badge separator dropdown-menu avatar tooltip popover calendar command scroll-area checkbox switch form sonner accordion
```

**Step 4: Create `.env.local.example`**

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Database (direct connection for Drizzle)
DATABASE_URL=postgresql://postgres:password@db.your-project.supabase.co:5432/postgres

# Resend
RESEND_API_KEY=re_your_key

# Sentry
SENTRY_DSN=https://your-sentry-dsn
NEXT_PUBLIC_SENTRY_DSN=https://your-sentry-dsn

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**Step 5: Create `drizzle.config.ts`**

```typescript
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  schemaFilter: ['floraclin'],
})
```

**Step 6: Update `next.config.ts`**

```typescript
import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/**',
      },
    ],
  },
}

export default withNextIntl(nextConfig)
```

**Step 7: Set up i18n**

Create `src/i18n/request.ts`:

```typescript
import { getRequestConfig } from 'next-intl/server'

export default getRequestConfig(async () => {
  return {
    locale: 'pt-BR',
    messages: (await import('../i18n/messages/pt-BR.json')).default,
  }
})
```

Create `src/i18n/messages/pt-BR.json`:

```json
{
  "common": {
    "save": "Salvar",
    "cancel": "Cancelar",
    "delete": "Excluir",
    "edit": "Editar",
    "create": "Criar",
    "search": "Buscar",
    "loading": "Carregando...",
    "confirm": "Confirmar",
    "back": "Voltar",
    "next": "Próximo",
    "previous": "Anterior",
    "yes": "Sim",
    "no": "Não",
    "actions": "Ações",
    "noResults": "Nenhum resultado encontrado",
    "required": "Obrigatório"
  },
  "auth": {
    "login": "Entrar",
    "logout": "Sair",
    "email": "E-mail",
    "password": "Senha",
    "forgotPassword": "Esqueci minha senha",
    "resetPassword": "Redefinir senha",
    "loginTitle": "Acesse sua conta",
    "loginSubtitle": "Entre com seu e-mail e senha"
  },
  "nav": {
    "dashboard": "Dashboard",
    "agenda": "Agenda",
    "patients": "Pacientes",
    "financial": "Financeiro",
    "settings": "Configurações"
  },
  "patients": {
    "title": "Pacientes",
    "newPatient": "Novo Paciente",
    "fullName": "Nome completo",
    "phone": "Telefone",
    "email": "E-mail",
    "cpf": "CPF",
    "birthDate": "Data de nascimento",
    "gender": "Gênero",
    "occupation": "Profissão",
    "referralSource": "Como conheceu a clínica",
    "notes": "Observações",
    "lastVisit": "Última visita",
    "nextAppointment": "Próximo agendamento",
    "tabs": {
      "data": "Dados",
      "anamnesis": "Anamnese",
      "procedures": "Procedimentos",
      "photos": "Fotos",
      "consent": "Termos",
      "financial": "Financeiro",
      "timeline": "Timeline"
    }
  },
  "anamnesis": {
    "title": "Anamnese",
    "mainComplaint": "Queixa principal",
    "patientGoals": "Objetivos do paciente",
    "medicalHistory": "Histórico médico",
    "medications": "Medicamentos em uso",
    "allergies": "Alergias",
    "previousSurgeries": "Cirurgias anteriores",
    "chronicConditions": "Condições crônicas",
    "pregnant": "Gestante",
    "breastfeeding": "Amamentando",
    "lifestyle": "Estilo de vida",
    "skinType": "Tipo de pele (Fitzpatrick)",
    "skinConditions": "Condições da pele",
    "skincareRoutine": "Rotina de cuidados com a pele",
    "previousTreatments": "Tratamentos estéticos anteriores",
    "contraindications": "Contraindicações",
    "facialEvaluation": "Avaliação facial"
  },
  "procedures": {
    "title": "Procedimentos",
    "newProcedure": "Novo Procedimento",
    "procedureType": "Tipo de procedimento",
    "technique": "Técnica",
    "clinicalResponse": "Resposta clínica",
    "adverseEffects": "Efeitos adversos",
    "notes": "Observações",
    "followUpDate": "Data de retorno",
    "nextSessionObjectives": "Objetivos da próxima sessão",
    "status": {
      "inProgress": "Em andamento",
      "completed": "Concluído",
      "cancelled": "Cancelado"
    }
  },
  "faceDiagram": {
    "title": "Diagrama Facial",
    "front": "Frontal",
    "leftProfile": "Perfil Esquerdo",
    "rightProfile": "Perfil Direito",
    "addPoint": "Clique no rosto para adicionar um ponto",
    "product": "Produto",
    "activeIngredient": "Princípio ativo",
    "quantity": "Quantidade",
    "unit": "Unidade",
    "technique": "Técnica",
    "depth": "Profundidade",
    "totals": "Totais",
    "points": "Pontos",
    "showPrevious": "Mostrar anterior"
  },
  "photos": {
    "title": "Fotos",
    "upload": "Enviar fotos",
    "compare": "Comparar",
    "annotate": "Anotar",
    "timelineStage": {
      "pre": "Pré-procedimento",
      "immediatePost": "Pós imediato",
      "7d": "7 dias",
      "30d": "30 dias",
      "90d": "90 dias",
      "other": "Outro"
    },
    "comparison": {
      "sideBySide": "Lado a lado",
      "overlay": "Sobreposição",
      "slider": "Slider"
    }
  },
  "consent": {
    "title": "Termos de Consentimento",
    "newConsent": "Novo Termo",
    "accept": "Li e concordo com os termos acima",
    "sign": "Assinar",
    "clear": "Limpar assinatura",
    "accepted": "Aceito em",
    "version": "Versão",
    "types": {
      "general": "Consentimento Geral",
      "botox": "Toxina Botulínica",
      "filler": "Preenchedor / Ácido Hialurônico",
      "biostimulator": "Bioestimulador",
      "custom": "Personalizado"
    }
  },
  "scheduling": {
    "title": "Agenda",
    "newAppointment": "Novo Agendamento",
    "date": "Data",
    "startTime": "Horário de início",
    "endTime": "Horário de término",
    "practitioner": "Profissional",
    "status": {
      "scheduled": "Agendado",
      "confirmed": "Confirmado",
      "inProgress": "Em Atendimento",
      "completed": "Concluído",
      "cancelled": "Cancelado",
      "noShow": "Não compareceu"
    },
    "views": {
      "day": "Dia",
      "week": "Semana",
      "month": "Mês"
    }
  },
  "financial": {
    "title": "Financeiro",
    "receivables": "A Receber",
    "overview": "Visão Geral",
    "newCharge": "Nova Cobrança",
    "totalAmount": "Valor total",
    "installments": "Parcelas",
    "installmentCount": "Número de parcelas",
    "dueDate": "Vencimento",
    "markAsPaid": "Marcar como pago",
    "paymentMethod": {
      "pix": "PIX",
      "creditCard": "Cartão de crédito",
      "debitCard": "Cartão de débito",
      "cash": "Dinheiro",
      "transfer": "Transferência"
    },
    "status": {
      "pending": "Pendente",
      "partial": "Parcial",
      "paid": "Pago",
      "overdue": "Atrasado",
      "cancelled": "Cancelado"
    }
  },
  "settings": {
    "title": "Configurações",
    "tabs": {
      "clinic": "Clínica",
      "procedures": "Procedimentos",
      "team": "Equipe",
      "consent": "Termos",
      "scheduling": "Agendamento"
    },
    "clinicName": "Nome da clínica",
    "clinicSlug": "URL de agendamento",
    "workingHours": "Horário de funcionamento",
    "inviteUser": "Convidar membro",
    "role": "Função",
    "roles": {
      "owner": "Proprietário",
      "practitioner": "Profissional",
      "receptionist": "Recepcionista",
      "financial": "Financeiro"
    }
  },
  "onboarding": {
    "welcome": "Bem-vindo ao FloraClin!",
    "step1": "Dados da clínica",
    "step2": "Horário de funcionamento",
    "step3": "Tipos de procedimento",
    "step4": "Convide sua equipe",
    "skip": "Pular por enquanto",
    "finish": "Começar a usar"
  },
  "dashboard": {
    "title": "Dashboard",
    "todayAppointments": "Agenda de hoje",
    "quickStats": "Resumo",
    "patientsThisWeek": "Pacientes esta semana",
    "proceduresThisMonth": "Procedimentos este mês",
    "revenueThisMonth": "Receita este mês",
    "upcomingFollowUps": "Retornos próximos",
    "recentActivity": "Atividade recente",
    "quickActions": "Ações rápidas",
    "newPatient": "Novo Paciente",
    "newAppointment": "Novo Agendamento"
  },
  "booking": {
    "title": "Agendamento Online",
    "selectPractitioner": "Selecione o profissional",
    "selectDate": "Selecione a data",
    "selectTime": "Selecione o horário",
    "yourInfo": "Seus dados",
    "name": "Nome",
    "phone": "Telefone",
    "email": "E-mail",
    "confirm": "Confirmar agendamento",
    "success": "Agendamento solicitado!",
    "successMessage": "Você receberá uma confirmação em breve."
  },
  "products": {
    "productName": "Nome do produto",
    "activeIngredient": "Princípio ativo",
    "batchNumber": "Número do lote",
    "expirationDate": "Data de validade",
    "totalQuantity": "Quantidade total",
    "labelPhoto": "Foto do rótulo",
    "applicationAreas": "Áreas de aplicação"
  }
}
```

**Step 8: Create directory structure**

```bash
mkdir -p src/{actions,components/{ui,layout,patients,anamnesis,procedures,face-diagram,photos,consent,scheduling,financial,booking},db/{queries,migrations},lib,validations,types}
mkdir -p src/app/{\"(auth)\"/{login,reset-password},\"(platform)\"/{dashboard,agenda,pacientes/{\"[id]\"/{procedimentos/{\"[procedureId]\"}}},financeiro,configuracoes},c/{\"[slug]\"},onboarding,api/{auth/me,book/{\"[slug]\"/{slots}}}}
mkdir -p public/face-templates
```

**Step 9: Set up base types**

Create `src/types/index.ts`:

```typescript
export type Role = 'owner' | 'practitioner' | 'receptionist' | 'financial'

export type AppointmentStatus = 'scheduled' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'no_show'

export type AppointmentSource = 'internal' | 'online_booking'

export type ProcedureStatus = 'in_progress' | 'completed' | 'cancelled'

export type TimelineStage = 'pre' | 'immediate_post' | '7d' | '30d' | '90d' | 'other'

export type ConsentType = 'general' | 'botox' | 'filler' | 'biostimulator' | 'custom'

export type AcceptanceMethod = 'checkbox' | 'signature' | 'both'

export type PaymentMethod = 'pix' | 'credit_card' | 'debit_card' | 'cash' | 'transfer'

export type FinancialStatus = 'pending' | 'partial' | 'paid' | 'overdue' | 'cancelled'

export type InstallmentStatus = 'pending' | 'paid' | 'overdue'

export type DiagramViewType = 'front' | 'left_profile' | 'right_profile'

export type QuantityUnit = 'U' | 'mL'

export type AuditAction = 'create' | 'update' | 'delete' | 'login' | 'logout' | 'consent_accepted' | 'impersonation_start' | 'impersonation_end'

export interface AuthContext {
  userId: string
  tenantId: string
  role: Role
  email: string
  fullName: string
}

export interface PaginationParams {
  page: number
  limit: number
}

export interface PaginatedResult<T> {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}
```

**Step 10: Initialize git and commit**

```bash
git init
git add .
git commit -m "chore: project scaffolding - Next.js 15, Tailwind, shadcn/ui, Drizzle, Supabase, i18n (pt-BR)"
```

**Verification:** `npm run dev` should start without errors.

---

### Task 2: Database Schema (Drizzle)

**Depends on:** Task 1

**Files:**
- Create: `src/db/schema.ts`
- Create: `src/db/client.ts`

**Step 1: Write the complete Drizzle schema**

Create `src/db/schema.ts` with all tables from the design document. Every table must:
- Live in the `floraclin` schema
- Use `uuid` primary keys with `defaultRandom()`
- Include `createdAt`, `updatedAt` timestamps
- Include `deletedAt` for soft-deletable tables
- Include `tenantId` on tenant-scoped tables

Reference the exact SQL schema in the design doc (section 7, lines 342-685 of the design document). Map every table, column, constraint, index, and CHECK to Drizzle equivalents.

Tables to create (in order for FK resolution):
1. `tenants`
2. `users`
3. `tenantUsers`
4. `patients`
5. `anamneses`
6. `procedureTypes`
7. `appointments` (before procedureRecords due to FK)
8. `procedureRecords`
9. `faceDiagrams`
10. `diagramPoints`
11. `photoAssets`
12. `photoAnnotations`
13. `productApplications`
14. `consentTemplates`
15. `consentAcceptances`
16. `financialEntries`
17. `installments`
18. `auditLogs`

Use Drizzle's `pgSchema` to target the `floraclin` schema:

```typescript
import { pgSchema, uuid, varchar, text, boolean, timestamp, decimal, integer, date, time, jsonb, inet, uniqueIndex, index } from 'drizzle-orm/pg-core'

export const floraclinSchema = pgSchema('floraclin')

export const tenants = floraclinSchema.table('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  // ... all fields from design doc
})

// ... continue for all 18 tables
```

Export Drizzle relation definitions for type-safe joins.

**CRITICAL schema additions (from adversarial review):**

1. **Appointment exclusion constraint** — prevent double-booking at the DB level:
```sql
-- Add after appointments table creation
ALTER TABLE floraclin.appointments
  ADD CONSTRAINT no_overlapping_appointments
  EXCLUDE USING gist (
    practitioner_id WITH =,
    date WITH =,
    tsrange(
      (date + start_time)::timestamp,
      (date + end_time)::timestamp
    ) WITH &&
  )
  WHERE (deleted_at IS NULL AND status NOT IN ('cancelled'));
```
In Drizzle, this must be added as a raw SQL statement in the migration since Drizzle doesn't support EXCLUDE constraints natively. Add a `src/db/migrations/manual/0001_appointment_exclusion.sql` file.

2. **Consent acceptance content snapshot** — store what the patient actually saw:
```typescript
// In consentAcceptances table, add:
contentHash: varchar('content_hash', { length: 64 }).notNull(), // SHA-256 of template content at acceptance time
contentSnapshot: text('content_snapshot').notNull(), // full text of consent shown to patient
```

3. **Anamnesis unique constraint** — ensure the `patient_id` UNIQUE constraint exists in Drizzle:
```typescript
// In anamneses table definition, ensure:
patientId: uuid('patient_id').notNull().references(() => patients.id).unique(),
```

**Step 2: Create the database client**

Create `src/db/client.ts`:

```typescript
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL!

const client = postgres(connectionString, { prepare: false })

export const db = drizzle(client, { schema })
```

**Step 3: Generate and review migration**

```bash
npx drizzle-kit generate
```

Review the generated SQL migration file in `src/db/migrations/`. Ensure it creates the `floraclin` schema and all tables.

**Step 4: Commit**

```bash
git add src/db/
git commit -m "feat: complete Drizzle schema for floraclin - 18 tables with indexes, constraints, and relations"
```

**Verification:** `npx drizzle-kit generate` succeeds. The migration SQL matches the design doc schema.

**Note:** Do NOT run `drizzle-kit push` or `drizzle-kit migrate` — the user will apply migrations to their Supabase project manually with their credentials.

---

### Task 3: Core Infrastructure (Auth, Tenant, Middleware)

**Depends on:** Task 1, Task 2

**Files:**
- Create: `src/lib/supabase/server.ts`
- Create: `src/lib/supabase/admin.ts` ← NEW: service-role client for admin ops
- Create: `src/lib/supabase/middleware.ts`
- Create: `src/lib/auth.ts`
- Create: `src/lib/tenant.ts`
- Create: `src/lib/audit.ts`
- Create: `src/lib/storage.ts`
- Create: `src/lib/constants.ts`
- Create: `src/lib/utils.ts`
- Create: `src/middleware.ts`
- Create: `src/actions/auth.ts`
- Create: `src/app/(auth)/login/page.tsx`
- Create: `src/app/(auth)/reset-password/page.tsx`
- Create: `src/app/(auth)/layout.tsx`
- Create: `src/app/api/auth/me/route.ts`

**Step 1: Supabase server client**

Create `src/lib/supabase/server.ts`:

```typescript
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from Server Component — ignore
          }
        },
      },
    }
  )
}
```

**Step 2: Supabase admin client (service role)**

Create `src/lib/supabase/admin.ts`:

```typescript
import { createClient } from '@supabase/supabase-js'

// Service role client — NEVER expose to browser. Use only for:
// - Inviting users (auth.admin.inviteUserByEmail)
// - Creating auth users
// - Platform admin operations
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}
```

**Step 3: Supabase middleware helper**

Create `src/lib/supabase/middleware.ts`:

```typescript
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Redirect unauthenticated users trying to access platform routes
  const isAuthRoute = request.nextUrl.pathname.startsWith('/login') ||
    request.nextUrl.pathname.startsWith('/reset-password')
  const isPublicRoute = request.nextUrl.pathname.startsWith('/c/') ||
    request.nextUrl.pathname.startsWith('/api/book/')
  const isApiRoute = request.nextUrl.pathname.startsWith('/api/')
  const isOnboarding = request.nextUrl.pathname.startsWith('/onboarding')

  if (!user && !isAuthRoute && !isPublicRoute && !isApiRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Redirect authenticated users away from auth routes
  if (user && isAuthRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

// NOTE: Onboarding enforcement is handled in the (platform) layout.tsx
// (not in middleware, because we need DB access to check tenant settings).
// The platform layout checks tenant.settings.onboarding_completed and
// redirects to /onboarding if false. See Task 4.
```

**Step 3: Auth helpers**

Create `src/lib/auth.ts`:

```typescript
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db/client'
import { tenantUsers, users, tenants } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import type { AuthContext, Role } from '@/types'

const TENANT_COOKIE = 'floraclin_tenant_id'

export async function getAuthContext(): Promise<AuthContext> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Get ALL tenants for this user
  const memberships = await db
    .select({
      tenantId: tenantUsers.tenantId,
      role: tenantUsers.role,
      fullName: users.fullName,
      email: users.email,
    })
    .from(tenantUsers)
    .innerJoin(users, eq(users.id, tenantUsers.userId))
    .where(
      and(
        eq(tenantUsers.userId, user.id),
        eq(tenantUsers.isActive, true)
      )
    )

  if (memberships.length === 0) {
    redirect('/login')
  }

  // Resolve active tenant: cookie → first membership
  const cookieStore = await cookies()
  const selectedTenantId = cookieStore.get(TENANT_COOKIE)?.value

  const activeMembership = memberships.find(m => m.tenantId === selectedTenantId)
    ?? memberships[0]

  return {
    userId: user.id,
    tenantId: activeMembership.tenantId,
    role: activeMembership.role as Role,
    email: activeMembership.email,
    fullName: activeMembership.fullName,
  }
}

// Call this when user switches tenant (e.g., from tenant switcher in sidebar)
export async function setActiveTenant(tenantId: string) {
  const cookieStore = await cookies()
  cookieStore.set(TENANT_COOKIE, tenantId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365, // 1 year
  })
}

// Get all tenants for current user (for tenant switcher UI)
export async function getUserTenants(userId: string) {
  return db
    .select({
      tenantId: tenantUsers.tenantId,
      role: tenantUsers.role,
      tenantName: tenants.name,
    })
    .from(tenantUsers)
    .innerJoin(tenants, eq(tenants.id, tenantUsers.tenantId))
    .where(
      and(
        eq(tenantUsers.userId, userId),
        eq(tenantUsers.isActive, true)
      )
    )
}

export async function requireRole(...allowedRoles: Role[]): Promise<AuthContext> {
  const context = await getAuthContext()

  if (!allowedRoles.includes(context.role)) {
    throw new Error('Forbidden: insufficient permissions')
  }

  return context
}
```

**Step 5: Tenant helper**

Create `src/lib/tenant.ts`:

```typescript
import { db } from '@/db/client'

// App-level tenant isolation. RLS is deferred to post-MVP hardening.
// Every query function in db/queries/ takes tenantId as first param
// and MUST include WHERE tenant_id = tenantId in all queries.
//
// This helper wraps a callback with the tenant context for convenience.
// It does NOT set any DB session variables — isolation is purely app-level.
export async function withTenant<T>(
  tenantId: string,
  fn: (tenantId: string) => Promise<T>
): Promise<T> {
  return fn(tenantId)
}

// Transaction wrapper for multi-table writes (e.g., procedure save).
// All writes within the callback share a single transaction.
export async function withTransaction<T>(
  fn: (tx: typeof db) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    return fn(tx as unknown as typeof db)
  })
}
```

**Step 5: Audit helper**

Create `src/lib/audit.ts`:

```typescript
import { db } from '@/db/client'
import { auditLogs } from '@/db/schema'
import type { AuditAction } from '@/types'

interface AuditParams {
  tenantId: string | null
  userId: string
  action: AuditAction
  entityType: string
  entityId?: string
  changes?: Record<string, { old: unknown; new: unknown }>
  ipAddress?: string
  userAgent?: string
}

export async function createAuditLog(params: AuditParams) {
  await db.insert(auditLogs).values({
    tenantId: params.tenantId,
    userId: params.userId,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    changes: params.changes,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  })
}
```

**Step 6: Storage helper**

Create `src/lib/storage.ts`:

```typescript
import { createClient } from '@/lib/supabase/server'

const BUCKET_NAME = 'floraclin'

export function getStoragePath(tenantId: string, patientId: string, filename: string): string {
  return `${tenantId}/patients/${patientId}/${filename}`
}

export async function uploadFile(
  path: string,
  file: File
): Promise<{ path: string; error: string | null }> {
  const supabase = await createClient()

  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    })

  if (error) {
    return { path: '', error: error.message }
  }

  return { path: data.path, error: null }
}

export async function getSignedUrl(path: string, expiresIn = 900): Promise<string | null> {
  const supabase = await createClient()

  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(path, expiresIn)

  if (error) return null
  return data.signedUrl
}

export async function deleteFile(path: string): Promise<void> {
  const supabase = await createClient()
  await supabase.storage.from(BUCKET_NAME).remove([path])
}
```

**Step 7: Constants and utils**

Create `src/lib/constants.ts`:

```typescript
export const DEFAULT_PAGE_SIZE = 20

export const APPOINTMENT_STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-800',
  confirmed: 'bg-green-100 text-green-800',
  in_progress: 'bg-yellow-100 text-yellow-800',
  completed: 'bg-gray-100 text-gray-800',
  cancelled: 'bg-red-100 text-red-800',
  no_show: 'bg-orange-100 text-orange-800',
}

export const PROCEDURE_CATEGORIES = [
  'botox',
  'filler',
  'biostimulator',
  'peel',
  'skinbooster',
  'laser',
  'microagulhamento',
  'outros',
] as const

export const FITZPATRICK_TYPES = ['I', 'II', 'III', 'IV', 'V', 'VI'] as const

export const DEFAULT_PROCEDURE_TYPES = [
  { name: 'Toxina Botulínica', category: 'botox', estimatedDurationMin: 30 },
  { name: 'Ácido Hialurônico', category: 'filler', estimatedDurationMin: 60 },
  { name: 'Bioestimulador de Colágeno', category: 'biostimulator', estimatedDurationMin: 60 },
  { name: 'Peeling Químico', category: 'peel', estimatedDurationMin: 45 },
  { name: 'Skinbooster', category: 'skinbooster', estimatedDurationMin: 45 },
]

export const DEFAULT_WORKING_HOURS = {
  mon: { start: '08:00', end: '18:00', enabled: true },
  tue: { start: '08:00', end: '18:00', enabled: true },
  wed: { start: '08:00', end: '18:00', enabled: true },
  thu: { start: '08:00', end: '18:00', enabled: true },
  fri: { start: '08:00', end: '18:00', enabled: true },
  sat: { start: '08:00', end: '12:00', enabled: false },
  sun: { start: '08:00', end: '12:00', enabled: false },
}
```

Create `src/lib/utils.ts` (extend the shadcn default):

```typescript
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: Date | string): string {
  return format(new Date(date), 'dd/MM/yyyy', { locale: ptBR })
}

export function formatDateTime(date: Date | string): string {
  return format(new Date(date), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value)
}

export function maskCPF(cpf: string): string {
  return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '***.$2.***-**')
}

export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
```

**Step 8: Middleware**

Create `src/middleware.ts`:

```typescript
import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|face-templates|logo.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

**Step 9: Auth actions**

Create `src/actions/auth.ts`:

```typescript
'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { z } from 'zod'

const loginSchema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres'),
})

export async function login(formData: FormData) {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })

  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)

  if (error) {
    return { error: { general: ['E-mail ou senha incorretos'] } }
  }

  redirect('/dashboard')
}

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

export async function resetPassword(formData: FormData) {
  const email = formData.get('email') as string

  if (!email) {
    return { error: 'E-mail é obrigatório' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/reset-password`,
  })

  if (error) {
    return { error: 'Erro ao enviar e-mail de recuperação' }
  }

  return { success: true }
}
```

**Step 10: Login page**

Create `src/app/(auth)/layout.tsx`:

```tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md">{children}</div>
    </div>
  )
}
```

Create `src/app/(auth)/login/page.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import { login } from '@/actions/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'

export default function LoginPage() {
  const [state, formAction, isPending] = useActionState(login, null)

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">FloraClin</CardTitle>
        <CardDescription>Acesse sua conta</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" name="email" type="email" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Senha</Label>
            <Input id="password" name="password" type="password" required />
          </div>
          {state?.error?.general && (
            <p className="text-sm text-red-600">{state.error.general[0]}</p>
          )}
          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? 'Entrando...' : 'Entrar'}
          </Button>
          <div className="text-center">
            <Link href="/reset-password" className="text-sm text-muted-foreground hover:underline">
              Esqueci minha senha
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
```

Create `src/app/(auth)/reset-password/page.tsx` with a similar form for password reset.

**Step 11: API route `/api/auth/me`**

Create `src/app/api/auth/me/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'

export async function GET() {
  try {
    const context = await getAuthContext()
    return NextResponse.json(context)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
```

**Step 12: Commit**

```bash
git add .
git commit -m "feat: core infrastructure - auth, tenant isolation, middleware, Supabase client, audit logging"
```

**Verification:** App boots, `/login` renders, unauthenticated users are redirected to `/login`.

---

### Task 4: Layout Shell (Sidebar, Header, Providers)

**Depends on:** Task 3

**Files:**
- Create: `src/components/layout/sidebar.tsx`
- Create: `src/components/layout/header.tsx`
- Create: `src/components/layout/user-menu.tsx`
- Create: `src/app/(platform)/layout.tsx`
- Modify: `src/app/layout.tsx`

**Step 1: Root layout with providers**

Update `src/app/layout.tsx`:

```tsx
import type { Metadata } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

export const metadata: Metadata = {
  title: 'FloraClin',
  description: 'Sistema para clínicas de Harmonização Orofacial',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  const messages = await getMessages()

  return (
    <html lang={locale}>
      <body className="antialiased">
        <NextIntlClientProvider messages={messages}>
          {children}
          <Toaster richColors position="top-right" />
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
```

**Step 2: Sidebar component**

Create `src/components/layout/sidebar.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { LayoutDashboard, Calendar, Users, DollarSign, Settings } from 'lucide-react'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/agenda', label: 'Agenda', icon: Calendar },
  { href: '/pacientes', label: 'Pacientes', icon: Users },
  { href: '/financeiro', label: 'Financeiro', icon: DollarSign },
  { href: '/configuracoes', label: 'Configurações', icon: Settings },
]

interface SidebarProps {
  clinicName: string
}

export function Sidebar({ clinicName }: SidebarProps) {
  const pathname = usePathname()

  return (
    <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 border-r bg-white">
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex items-center h-16 flex-shrink-0 px-4 border-b">
          <h1 className="text-lg font-semibold text-emerald-700">{clinicName}</h1>
        </div>
        <nav className="flex-1 px-2 py-4 space-y-1">
          {navItems.map((item) => {
            const isActive = pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                )}
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </Link>
            )
          })}
        </nav>
      </div>
    </aside>
  )
}
```

**Step 3: Header component**

Create `src/components/layout/header.tsx`:

```tsx
import { UserMenu } from './user-menu'

interface HeaderProps {
  userName: string
  userEmail: string
}

export function Header({ userName, userEmail }: HeaderProps) {
  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-end border-b bg-white px-6">
      <UserMenu userName={userName} userEmail={userEmail} />
    </header>
  )
}
```

**Step 4: User menu component**

Create `src/components/layout/user-menu.tsx`:

```tsx
'use client'

import { logout } from '@/actions/auth'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { LogOut } from 'lucide-react'

interface UserMenuProps {
  userName: string
  userEmail: string
}

export function UserMenu({ userName, userEmail }: UserMenuProps) {
  const initials = userName
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative h-10 w-10 rounded-full">
          <Avatar className="h-10 w-10">
            <AvatarFallback className="bg-emerald-100 text-emerald-700">{initials}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <p className="text-sm font-medium">{userName}</p>
            <p className="text-xs text-muted-foreground">{userEmail}</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => logout()}>
          <LogOut className="mr-2 h-4 w-4" />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

**Step 5: Platform layout**

Create `src/app/(platform)/layout.tsx`:

```tsx
import { Sidebar } from '@/components/layout/sidebar'
import { Header } from '@/components/layout/header'
import { getAuthContext } from '@/lib/auth'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import { eq } from 'drizzle-orm'

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuthContext()

  const [tenant] = await db
    .select({ name: tenants.name, settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, auth.tenantId))
    .limit(1)

  // Enforce onboarding completion before accessing platform
  const settings = (tenant?.settings as Record<string, unknown>) ?? {}
  if (!settings.onboarding_completed) {
    redirect('/onboarding')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar clinicName={tenant?.name ?? 'FloraClin'} />
      <div className="md:pl-64">
        <Header userName={auth.fullName} userEmail={auth.email} />
        <main className="p-6">{children}</main>
      </div>
    </div>
  )
}
```

**Step 6: Placeholder dashboard page**

Create `src/app/(platform)/dashboard/page.tsx`:

```tsx
export default function DashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="text-muted-foreground mt-1">Bem-vindo ao FloraClin</p>
    </div>
  )
}
```

**Step 7: Commit**

```bash
git add .
git commit -m "feat: layout shell - sidebar navigation, header, user menu, platform layout"
```

**Verification:** Authenticated user sees sidebar with navigation, header with user menu, and placeholder dashboard.

---

## LAYER 1 — Domain Modules (8 Parallel Agents)

> **All tasks in this layer can run simultaneously.** Each agent creates its own files within its domain. No cross-module dependencies.

---

### Task 5: Patient Module

**Depends on:** Layer 0 complete
**Agent scope:** Patient CRUD, search, list page ONLY. Patient detail page is built in Task 14.

**Files:**
- Create: `src/validations/patient.ts`
- Create: `src/db/queries/patients.ts`
- Create: `src/actions/patients.ts`
- Create: `src/components/patients/patient-list.tsx`
- Create: `src/components/patients/patient-form.tsx`
- Create: `src/app/(platform)/pacientes/page.tsx`

**What to build:**

1. **Zod validation** (`src/validations/patient.ts`):
   - `createPatientSchema`: requires `fullName`, `phone`. Optional: `cpf`, `birthDate`, `gender`, `email`, `phoneSecondary`, `address`, `occupation`, `referralSource`, `notes`
   - `updatePatientSchema`: same but all optional except `id`
   - `patientSearchSchema`: `search` string, `page` number, `limit` number

2. **Tenant-scoped queries** (`src/db/queries/patients.ts`):
   - `listPatients(tenantId, { search, page, limit })` → paginated result with total count. Search by name, phone, or CPF using `ilike`. Filter `deleted_at IS NULL`. Order by `full_name`.
   - `getPatient(tenantId, patientId)` → single patient or null
   - `createPatient(tenantId, data)` → inserted patient
   - `updatePatient(tenantId, patientId, data)` → updated patient
   - `deletePatient(tenantId, patientId)` → soft delete (set `deleted_at`)
   - All queries MUST include `WHERE tenant_id = $tenantId` AND `WHERE deleted_at IS NULL`

3. **Server Actions** (`src/actions/patients.ts`):
   - `createPatientAction(formData)` → validates with Zod, calls `requireRole('owner', 'practitioner', 'receptionist')`, calls query, creates audit log, returns patient or errors
   - `updatePatientAction(formData)` → same pattern
   - `deletePatientAction(patientId)` → soft delete with audit log
   - `listPatientsAction(search, page, limit)` → paginated list
   - `getPatientAction(patientId)` → patient detail

4. **Components:**
   - `PatientList`: table with columns (Nome, Telefone, Última Visita, Próximo Agendamento), search bar on top, "Novo Paciente" button, pagination controls. Uses `<Table>` from shadcn.
   - `PatientForm`: dialog/sheet with React Hook Form bound to Zod schema. Fields for name, phone, CPF, email, birth date, gender, occupation, referral source, notes. Address as collapsible section with street, number, complement, neighborhood, city, state, zip.
   **NOTE:** Do NOT create `PatientTabs` or the patient detail page (`/pacientes/[id]/page.tsx`) — those are built from scratch in Task 14.

5. **Pages:**
   - `/pacientes/page.tsx`: server component, calls `listPatientsAction`, renders `PatientList`. Clicking a patient row links to `/pacientes/[id]` (page built in Task 14).

**Verification:** Can create, list, search, edit, and soft-delete patients. Pagination works. Search by name/phone/CPF works.

**Commit:** `feat: patient module - CRUD, search, list page`

---

### Task 6: Anamnesis Module

**Depends on:** Layer 0 complete
**Agent scope:** Anamnesis form with all sections, upsert action

**Files:**
- Create: `src/validations/anamnesis.ts`
- Create: `src/db/queries/anamnesis.ts`
- Create: `src/actions/anamnesis.ts`
- Create: `src/components/anamnesis/anamnesis-form.tsx`
- Create: `src/components/anamnesis/anamnesis-section.tsx`

**What to build:**

1. **Zod validation** (`src/validations/anamnesis.ts`):
   - `anamnesisSchema` covering all fields from the design doc: `mainComplaint`, `patientGoals`, `medicalHistory` (JSON object), `medications` (array of {name, dosage, frequency, reason}), `allergies` (array of {substance, reaction, severity}), `previousSurgeries` (array of {procedure, year, notes}), `chronicConditions` (string array), `isPregnant`, `isBreastfeeding`, `lifestyle` (JSON with smoking, alcohol, exercise, sleep, diet, sunExposure), `skinType` (Fitzpatrick I-VI), `skinConditions` (string array), `skincareRoutine` (array of {product, frequency, notes}), `previousAestheticTreatments` (array of {procedure, date, professional, notes, satisfaction}), `contraindications` (string array), `facialEvaluationNotes`

2. **Queries** (`src/db/queries/anamnesis.ts`):
   - `getAnamnesis(tenantId, patientId)` → anamnesis or null
   - `upsertAnamnesis(tenantId, patientId, userId, data, expectedUpdatedAt?)` → insert if not exists, update if exists (use Drizzle's `onConflictDoUpdate` on the `patient_id` unique constraint). **Optimistic locking:** if `expectedUpdatedAt` is provided, include `WHERE updated_at = expectedUpdatedAt` in the update — reject with a "stale data" error if the row was modified by another save in the meantime. The client should include the last known `updatedAt` in every autosave request.

3. **Server Actions** (`src/actions/anamnesis.ts`):
   - `getAnamnesisAction(patientId)` → anamnesis data
   - `upsertAnamnesisAction(patientId, formData)` → validates, upserts, creates audit log

4. **Components:**
   - `AnamnesisSection`: reusable collapsible accordion section. Props: `title`, `isComplete` (shows green check), `children`. Uses shadcn `<Accordion>`.
   - `AnamnesisForm`: full form with sections as `AnamnesisSection` components. Each section is collapsible. Sections:
     - Queixa principal e objetivos (textarea fields)
     - Histórico médico (checkboxes for common conditions: diabetes, hipertensão, autoimune, cardiovascular, etc.)
     - Medicamentos em uso (dynamic list — add/remove items with name, dosage, frequency, reason)
     - Alergias (dynamic list — substance, reaction, severity dropdown)
     - Cirurgias anteriores (dynamic list — procedure, year, notes)
     - Condições crônicas (tag-style input)
     - Gestação / Amamentação (two switches)
     - Estilo de vida (dropdowns/selects for smoking, alcohol, exercise frequency, sleep quality, diet, sun exposure)
     - Tipo de pele (Fitzpatrick I-VI select)
     - Condições da pele (tag-style input)
     - Rotina de cuidados (dynamic list — product, frequency, notes)
     - Tratamentos estéticos anteriores (dynamic list — procedure, date, professional, notes, satisfaction rating)
     - Contraindicações (tag-style input)
     - Avaliação facial (textarea + photo upload placeholder)
   - Form uses React Hook Form with the Zod schema. Auto-save on blur/change (debounced 1 second).
   - Shows `updatedAt` and `updatedBy` at the bottom.

**Verification:** Can view, create, and update anamnesis for a patient. All sections render correctly. Dynamic lists (add/remove) work. Auto-save works.

**Commit:** `feat: anamnesis module - structured intake form with collapsible sections and auto-save`

---

### Task 7: Scheduling Module

**Depends on:** Layer 0 complete
**Agent scope:** Calendar views, appointment CRUD, status workflow

**Files:**
- Create: `src/validations/appointment.ts`
- Create: `src/db/queries/appointments.ts`
- Create: `src/actions/appointments.ts`
- Create: `src/components/scheduling/calendar-view.tsx`
- Create: `src/components/scheduling/day-view.tsx`
- Create: `src/components/scheduling/week-view.tsx`
- Create: `src/components/scheduling/month-view.tsx`
- Create: `src/components/scheduling/appointment-card.tsx`
- Create: `src/components/scheduling/appointment-form.tsx`
- Create: `src/app/(platform)/agenda/page.tsx`

**What to build:**

1. **Zod validation** (`src/validations/appointment.ts`):
   - `createAppointmentSchema`: `patientId` (optional, null for online), `practitionerId`, `procedureTypeId` (optional), `date`, `startTime`, `endTime`, `notes`, `source` (default 'internal'), `bookingName`, `bookingPhone`, `bookingEmail` (for online bookings)
   - `updateAppointmentSchema`: same but all optional except `id`
   - `updateStatusSchema`: `id`, `status` (enum)

2. **Queries** (`src/db/queries/appointments.ts`):
   - `listAppointments(tenantId, { practitionerId?, dateFrom, dateTo })` → appointments with patient name and procedure type name joined
   - `createAppointment(tenantId, data)` → appointment (check for time slot conflicts first!)
   - `updateAppointment(tenantId, appointmentId, data)` → updated
   - `updateAppointmentStatus(tenantId, appointmentId, status)` → updated
   - `deleteAppointment(tenantId, appointmentId)` → soft delete
   - `getAvailableSlots(tenantId, practitionerId, date, durationMin)` → array of available time slots based on working hours minus existing appointments

3. **Server Actions** (`src/actions/appointments.ts`):
   - `createAppointmentAction(formData)` → validates, checks conflicts, creates, audit log
   - `updateAppointmentAction(formData)` → validates, updates, audit log
   - `updateAppointmentStatusAction(id, status)` → updates status, audit log
   - `deleteAppointmentAction(id)` → soft delete, audit log
   - `listAppointmentsAction(practitionerId?, dateFrom, dateTo)` → list

4. **Components:**
   - `CalendarView`: wrapper that manages current date/view state. Contains view toggle buttons (Dia/Semana/Mês), practitioner filter (dropdown), and date navigation (prev/next/today). Renders the appropriate sub-view.
   - `DayView`: vertical time grid (7am-8pm in 30-min slots). Shows appointments as positioned blocks. Click empty slot → open appointment form. Click appointment → show detail.
   - `WeekView`: 7-column layout (Mon-Sun) with time grid. Similar to day view but all days visible.
   - `MonthView`: standard calendar grid. Each day cell shows appointment count + first 2-3 appointment titles. Click day → switch to day view.
   - `AppointmentCard`: colored card with patient name, time, procedure type, status badge. Color based on status (use `APPOINTMENT_STATUS_COLORS` from constants).
   - `AppointmentForm`: dialog with fields for patient (searchable select), practitioner (select), procedure type (select), date, start time, end time, notes. Time dropdowns in 30-min increments.

5. **Page:**
   - `/agenda/page.tsx`: server component with search params for `view`, `date`, `practitioner`. Renders `CalendarView`.

**Verification:** Can create, view, edit, cancel appointments. Day/week/month views render correctly. Time slot conflicts are detected. Status transitions work.

**Commit:** `feat: scheduling module - calendar views (day/week/month), appointment CRUD, status workflow`

---

### Task 8: Financial Module

**Depends on:** Layer 0 complete
**Agent scope:** Financial entries, installments, payments, revenue overview

**Files:**
- Create: `src/validations/financial.ts`
- Create: `src/db/queries/financial.ts`
- Create: `src/actions/financial.ts`
- Create: `src/components/financial/financial-list.tsx`
- Create: `src/components/financial/installment-table.tsx`
- Create: `src/components/financial/payment-form.tsx`
- Create: `src/components/financial/revenue-chart.tsx`
- Create: `src/app/(platform)/financeiro/page.tsx`

**What to build:**

1. **Zod validation** (`src/validations/financial.ts`):
   - `createFinancialEntrySchema`: `patientId`, `procedureRecordId?`, `appointmentId?`, `description`, `totalAmount`, `installmentCount` (1-12), `notes?`
   - `payInstallmentSchema`: `installmentId`, `paymentMethod` (enum)
   - `financialFilterSchema`: `patientId?`, `status?`, `dateFrom?`, `dateTo?`, `page`, `limit`

2. **Queries** (`src/db/queries/financial.ts`):
   - `createFinancialEntry(tenantId, userId, data)` → creates entry + generates N installment rows with calculated due dates (today, +30d, +60d, etc.) and evenly split amounts
   - `listFinancialEntries(tenantId, filters)` → paginated entries with patient name joined, plus installment summary counts
   - `getFinancialEntry(tenantId, entryId)` → entry with all installments
   - `payInstallment(tenantId, installmentId, paymentMethod)` → marks installment as paid, updates parent entry status (if all installments paid → 'paid', if some → 'partial')
   - `getRevenueOverview(tenantId, dateFrom, dateTo, practitionerId?)` → revenue summary: total received, total pending, total overdue, breakdown by procedure type, breakdown by payment method

3. **Server Actions** (`src/actions/financial.ts`):
   - `createFinancialEntryAction(formData)` → validates, creates, audit log. Allowed for: owner, receptionist, financial
   - `listFinancialEntriesAction(filters)` → paginated list
   - `getFinancialEntryAction(entryId)` → entry with installments
   - `payInstallmentAction(installmentId, paymentMethod)` → mark paid, audit log
   - `getRevenueOverviewAction(dateFrom, dateTo, practitionerId?)` → revenue data

4. **Components:**
   - `FinancialList`: table of financial entries. Columns: Paciente, Descrição, Valor, Parcelas (paid/total), Status (badge), Data. Filters: status dropdown, date range. "Nova Cobrança" button opens form.
   - `InstallmentTable`: expandable row detail showing all installments for an entry. Columns: Parcela (1/N), Valor, Vencimento, Status, Método, Ações. Action button "Marcar como pago" → opens payment method selector.
   - `PaymentForm`: dialog to create new financial entry. Fields: patient (searchable select), description, total amount (R$ currency input), installment count (1-12 select), notes. Shows calculated installment values and due dates as preview before confirming.
   - `RevenueChart`: two charts using Recharts. 1) Bar chart of monthly revenue (last 6 months). 2) Donut chart of revenue by procedure type. Shows summary cards: Total Recebido, Total Pendente, Total Atrasado.

5. **Page:**
   - `/financeiro/page.tsx`: server component with tabs "A Receber" and "Visão Geral". A Receber shows `FinancialList` filtered to pending/partial/overdue. Visão Geral shows `RevenueChart`.

**Verification:** Can create charges with installments. Installments auto-generate with correct amounts and dates. Can mark installments as paid. Revenue overview shows correct aggregations.

**Commit:** `feat: financial module - charges, installments, payments, revenue overview`

---

### Task 9: Consent Module

**Depends on:** Layer 0 complete
**Agent scope:** Consent templates, versioning, acceptance with checkbox + signature pad

**Files:**
- Create: `src/validations/consent.ts`
- Create: `src/db/queries/consent.ts`
- Create: `src/actions/consent.ts`
- Create: `src/components/consent/consent-viewer.tsx`
- Create: `src/components/consent/signature-pad.tsx`
- Create: `src/components/consent/consent-history.tsx`
- Create: `src/components/consent/consent-template-form.tsx`

**What to build:**

1. **Zod validation** (`src/validations/consent.ts`):
   - `consentTemplateSchema`: `type` (enum), `title`, `content` (rich text string)
   - `consentAcceptanceSchema`: `patientId`, `consentTemplateId`, `procedureRecordId?`, `acceptanceMethod` (enum), `signatureData?` (base64 string)

2. **Queries** (`src/db/queries/consent.ts`):
   - `listConsentTemplates(tenantId)` → active templates grouped by type
   - `createConsentTemplate(tenantId, data)` → creates with version 1
   - `updateConsentTemplate(tenantId, templateId, content)` → creates NEW row with incremented version, deactivates old version
   - `acceptConsent(tenantId, data)` → creates immutable acceptance record with timestamp, IP, **content_snapshot** (full text of template at acceptance time), and **content_hash** (SHA-256 of the template content, for tamper detection). The function must load the template content, hash it, and store both in the acceptance record.
   - `getConsentHistory(tenantId, patientId)` → all acceptances for a patient, joined with template title/type/version
   - `getActiveConsentForType(tenantId, type)` → latest active template for a consent type

3. **Server Actions** (`src/actions/consent.ts`):
   - `listConsentTemplatesAction()` → templates
   - `createConsentTemplateAction(formData)` → creates template. Owner only.
   - `updateConsentTemplateAction(templateId, content)` → new version. Owner only.
   - `acceptConsentAction(data)` → records acceptance. Gets IP from headers.
   - `getConsentHistoryAction(patientId)` → history

4. **Components:**
   - `ConsentViewer`: displays consent text in a scrollable container, with checkbox "Li e concordo com os termos acima" and optional `SignaturePad` below. Submit button "Confirmar". Shows template title, type, and version at the top.
   - `SignaturePad`: wrapper around `react-signature-canvas`. Shows a bordered canvas area with "Assinar aqui" placeholder. Buttons: "Limpar" (clear), provides `toDataURL()` for base64 export.
   - `ConsentHistory`: list/table of past acceptances for a patient. Shows: date, type, version, method (checkbox/signature/both), view signature link. Acceptances cannot be deleted or edited.
   - `ConsentTemplateForm`: form for creating/editing consent templates in Settings. Fields: type (select), title, content (textarea — rich text editor is overkill for MVP, use textarea with markdown-like formatting). Preview pane on the right.

**Default consent templates to seed during onboarding:**
- General informed consent for aesthetic procedures
- Toxina Botulínica specific consent
- Preenchedor / Ácido Hialurônico specific consent
- Bioestimulador de Colágeno specific consent

Provide realistic Portuguese consent text content for each.

**Verification:** Can create templates, update (creates new version), accept with checkbox, accept with signature pad, view history. Old versions are preserved.

**Commit:** `feat: consent module - templates with versioning, acceptance with checkbox + signature pad`

---

### Task 10: Photo Module

**Depends on:** Layer 0 complete
**Agent scope:** Photo upload, timeline grid, annotation editor, comparison views

**Files:**
- Create: `src/validations/photo.ts`
- Create: `src/db/queries/photos.ts`
- Create: `src/actions/photos.ts`
- Create: `src/components/photos/photo-grid.tsx`
- Create: `src/components/photos/photo-uploader.tsx`
- Create: `src/components/photos/photo-annotation-editor.tsx`
- Create: `src/components/photos/photo-comparison.tsx`

**What to build:**

1. **Zod validation** (`src/validations/photo.ts`):
   - `uploadPhotoSchema`: `patientId`, `procedureRecordId?`, `timelineStage` (enum), `notes?`
   - File validation: max 10MB, accepted types: image/jpeg, image/png, image/webp

2. **Queries** (`src/db/queries/photos.ts`):
   - `listPhotos(tenantId, patientId, procedureRecordId?)` → photos grouped by timeline stage, with signed URLs
   - `createPhotoAsset(tenantId, data)` → photo asset record
   - `deletePhotoAsset(tenantId, photoId)` → soft delete + delete from storage
   - `saveAnnotation(tenantId, photoAssetId, userId, annotationData)` → upsert annotation
   - `getAnnotation(tenantId, photoAssetId)` → annotation data or null

3. **Server Actions** (`src/actions/photos.ts`):
   - `uploadPhotoAction(formData)` → validates, compresses image (resize to max 2048px width, convert to WebP), uploads to Supabase Storage at `{tenantId}/patients/{patientId}/{uuid}.webp`, creates photo asset record. Use browser-side compression if possible, otherwise handle on server.
   - `listPhotosAction(patientId, procedureRecordId?)` → photos with signed URLs
   - `deletePhotoAction(photoId)` → soft delete, audit log
   - `saveAnnotationAction(photoAssetId, annotationData)` → saves annotation
   - `getAnnotationAction(photoAssetId)` → annotation
   - `getComparisonUrlsAction(photoIdA, photoIdB)` → two signed URLs

4. **Components:**
   - `PhotoUploader`: drag-and-drop zone + file picker. Shows upload progress. Multiple file support. Timeline stage selector (pre, pós imediato, 7 dias, 30 dias, 90 dias, outro). Preview thumbnails before upload.
   - `PhotoGrid`: displays photos organized by timeline stage sections. Each stage is a horizontal scrollable row with thumbnail cards. Click thumbnail → opens full-size view in a dialog. Shows date, notes, stage label per photo. Delete button (with confirmation).
   - `PhotoAnnotationEditor`: full-screen dialog/overlay. Loads the photo as background image. Uses Fabric.js canvas overlay for drawing tools:
     - Freehand pencil (adjustable color and width)
     - Arrow tool
     - Text label tool
     - Eraser
     - Color picker (preset colors: red, blue, green, yellow, white, black)
     - Undo/redo
     - Save button → serializes Fabric.js canvas to JSON annotation data
     - Load existing annotation on open
   - `PhotoComparison`: three mode selector (Lado a lado, Sobreposição, Slider):
     - **Side by side**: two images next to each other, same height, with labels
     - **Overlay**: both images stacked, top image has opacity slider (0-100%)
     - **Slider**: single container, both images positioned absolutely, a draggable vertical divider reveals left image on left side and right image on right side (CSS `clip-path` approach)
     - Photo selector: two dropdowns to pick photo A and photo B from patient's photo list

**Verification:** Can upload photos, see them in timeline grid, open photo for annotation (draw, save, reload), compare two photos in all three modes. Signed URLs work.

**Commit:** `feat: photo module - upload, timeline grid, annotation editor (Fabric.js), comparison (side-by-side/overlay/slider)`

---

### Task 11: Face Diagram Components

**Depends on:** Layer 0 complete
**Agent scope:** Pure client-side face diagram editor — no server actions (those come in Task 13)

**Files:**
- Create: `src/components/face-diagram/face-diagram-editor.tsx`
- Create: `src/components/face-diagram/face-template.tsx`
- Create: `src/components/face-diagram/diagram-point.tsx`
- Create: `src/components/face-diagram/point-form-modal.tsx`
- Create: `src/components/face-diagram/diagram-summary.tsx`
- Create: `public/face-templates/front.svg`
- Create: `public/face-templates/left-profile.svg`
- Create: `public/face-templates/right-profile.svg`

**What to build:**

1. **SVG face templates**: Create clean, minimal SVG outlines of a face:
   - `front.svg`: front-facing face outline showing forehead, brows, eyes, nose, nasolabial folds, lips, chin, jawline, cheeks. Light line art, no fills. Viewbox 0 0 400 500.
   - `left-profile.svg`: left profile outline. Same style.
   - `right-profile.svg`: right profile outline (mirror of left).
   - Style: thin strokes (#d1d5db), minimal detail, clean aesthetic. These are reference templates, not anatomical charts.

2. **Components:**
   - `FaceTemplate`: renders the SVG template as background. Props: `viewType` ('front' | 'left_profile' | 'right_profile'). Renders the appropriate SVG scaled to fit its container while maintaining aspect ratio.
   - `DiagramPoint`: renders a single point marker on the face. Positioned absolutely using `left/top` percentages from x,y (0-100). Shows a colored circle (color based on product category: botox=blue, filler=pink, biostimulator=green, others=purple). On hover, shows a tooltip with product name and quantity. Click to edit. Shows quantity inside or next to the circle.
   - `PointFormModal`: dialog for adding/editing a point. Fields:
     - Produto (text input with autocomplete from previous entries)
     - Princípio ativo (text input)
     - Quantidade (number input)
     - Unidade (U or mL toggle)
     - Técnica (text input — optional)
     - Profundidade (select: subcutâneo, intradérmico, supraperiosteal, subdérmico, intramuscular)
     - Observações (textarea — optional)
     - Delete point button (with confirmation)
   - `DiagramSummary`: panel showing:
     - List of all placed points with product, quantity, and a small color indicator
     - Auto-calculated totals grouped by product name (e.g., "Botox: 42U", "AH: 1.8mL")
     - Total number of points
   - `FaceDiagramEditor`: main component that composes everything. Layout:
     ```
     [Frontal] [Perfil E] [Perfil D]  ← view type tabs
     ┌──────────────────┐ ┌──────────────────┐
     │ FaceTemplate     │ │ DiagramSummary   │
     │ with             │ │                  │
     │ DiagramPoints    │ │ Points list      │
     │ overlaid         │ │ Auto-sum totals  │
     │                  │ │                  │
     │ (click to add)   │ │                  │
     └──────────────────┘ └──────────────────┘
     ```
     - State: array of points per view type
     - Click on face → opens `PointFormModal` with x,y pre-filled from click position (converted to 0-100 relative coordinates)
     - Save point → adds to state array
     - Edit point → click existing point → opens `PointFormModal` pre-filled
     - Delete point → removes from state
     - **CONTROLLED COMPONENT** — parent owns all state. Props contract:
       ```typescript
       interface FaceDiagramEditorProps {
         points: DiagramPointData[]           // current points (parent state)
         onChange: (points: DiagramPointData[]) => void  // called on every add/edit/delete
         previousPoints?: DiagramPointData[]  // ghost overlay from previous session
         readOnly?: boolean                   // for viewing historical diagrams
       }
       ```
     - Do NOT use `initialPoints` or `onSave` — this is NOT an uncontrolled component
     - "Mostrar anterior" toggle → shows previous session's points as semi-transparent ghost markers

**Important implementation details:**
- Use relative coordinates (0-100) for x and y. Convert mouse/touch position to relative using container bounds.
- Points must render correctly when the container is resized.
- Product color mapping should be deterministic and based on product category or name hash.
- State management: parent passes `points` and receives `onChange(updatedPoints)` on every mutation. No internal point state.

**Verification:** Can render face templates (front + profiles). Can click to place points with product details. Points are visually distinct by product type. Summary shows correct totals. Can edit and delete points. Can toggle between views. Can show ghost overlay of previous session points.

**Commit:** `feat: face diagram editor - freeform point placement, product tracking, auto-sum totals, SVG face templates`

---

### Task 12: Settings & User Management

**Depends on:** Layer 0 complete
**Agent scope:** Settings page with all tabs, user invite/management

**Files:**
- Create: `src/validations/tenant.ts`
- Create: `src/validations/user.ts`
- Create: `src/db/queries/tenants.ts`
- Create: `src/db/queries/users.ts`
- Create: `src/actions/tenants.ts`
- Create: `src/actions/users.ts`
- Create: `src/components/settings/clinic-settings-form.tsx`
- Create: `src/components/settings/procedure-type-list.tsx`
- Create: `src/components/settings/procedure-type-form.tsx`
- Create: `src/components/settings/team-list.tsx`
- Create: `src/components/settings/invite-user-form.tsx`
- Create: `src/components/settings/consent-template-list.tsx` (uses consent components from Task 9 if available, otherwise standalone)
- Create: `src/components/settings/booking-settings.tsx`
- Create: `src/app/(platform)/configuracoes/page.tsx`

**What to build:**

1. **Validations:**
   - `tenantSettingsSchema`: `name`, `phone`, `email`, `address` (JSONB), `workingHours` (JSONB), `settings` (JSONB)
   - `procedureTypeSchema`: `name`, `category` (enum), `description?`, `defaultPrice?`, `estimatedDurationMin?`
   - `inviteUserSchema`: `email`, `role` (enum), `fullName`

2. **Queries:**
   - `getTenant(tenantId)` → tenant data
   - `updateTenant(tenantId, data)` → updated tenant
   - `listTenantUsers(tenantId)` → users with roles
   - `inviteUser(tenantId, email, role, fullName)` → uses `createAdminClient()` from `src/lib/supabase/admin.ts` (service role key) to call `auth.admin.inviteUserByEmail()`. Then wraps in a transaction: creates `users` record + `tenant_users` record. If DB insert fails after auth user creation, log the error (auth user can be re-linked on retry — do NOT leave orphaned state silently).
   - `updateUserRole(tenantId, userId, role)` → updates role
   - `deactivateUser(tenantId, userId)` → sets `is_active = false`
   - `listProcedureTypes(tenantId)` → all procedure types (including inactive)
   - `createProcedureType(tenantId, data)` → procedure type
   - `updateProcedureType(tenantId, id, data)` → updated
   - `deleteProcedureType(tenantId, id)` → soft delete

3. **Server Actions:**
   - `updateTenantAction(formData)` → owner only
   - `inviteUserAction(formData)` → owner only. Sends invite email via Supabase Auth `inviteUserByEmail`.
   - `updateUserRoleAction(userId, role)` → owner only
   - `deactivateUserAction(userId)` → owner only (can't deactivate self)
   - `createProcedureTypeAction(formData)` → owner only
   - `updateProcedureTypeAction(id, formData)` → owner only
   - `deleteProcedureTypeAction(id)` → owner only

4. **Components & Page:**
   - `/configuracoes/page.tsx`: tabbed page with 5 tabs: Clínica, Procedimentos, Equipe, Termos, Agendamento
   - **Clínica tab**: form with clinic name, phone, email, address fields, working hours editor (7-row grid for each weekday with start time, end time, enabled toggle), logo upload (future)
   - **Procedimentos tab**: table of procedure types (name, category, price, duration, active status). Add/edit via dialog form. Toggle active/inactive. Soft delete with confirmation.
   - **Equipe tab**: table of team members (name, email, role, active status). "Convidar membro" button → dialog with email, full name, role select. Change role dropdown. Deactivate button.
   - **Termos tab**: list of consent templates. Create new, edit content (creates new version). Shows version history per type. (Reuses consent components if available)
   - **Agendamento tab**: toggle to enable/disable public booking page. Shows the booking URL (`{APP_URL}/c/{slug}`). Slug is read-only (set from clinic name during onboarding).

**Verification:** Can update clinic settings, manage working hours, CRUD procedure types, invite users, change roles, deactivate users, manage consent templates, toggle booking page.

**Commit:** `feat: settings & user management - clinic config, procedure types, team management, booking settings`

---

## LAYER 2 — Integration (4 Parallel Agents)

> **All tasks in this layer can run simultaneously.** Each integrates multiple Layer 1 modules into complete features.

---

### Task 13: Procedure Module (Integration)

**Depends on:** Tasks 5, 6, 7, 8, 9, 10, 11 (all Layer 1)
**Agent scope:** Ties face diagram + photos + consent + financial into the procedure flow

**Files:**
- Create: `src/validations/procedure.ts`
- Create: `src/db/queries/procedures.ts`
- Create: `src/db/queries/face-diagrams.ts`
- Create: `src/db/queries/product-applications.ts`
- Create: `src/actions/procedures.ts`
- Create: `src/actions/face-diagrams.ts`
- Create: `src/actions/product-applications.ts`
- Create: `src/components/procedures/procedure-form.tsx`
- Create: `src/components/procedures/procedure-card.tsx`
- Create: `src/components/procedures/procedure-list.tsx`
- Create: `src/app/(platform)/pacientes/[id]/procedimentos/[procedureId]/page.tsx`

**What to build:**

1. **Validations:**
   - `createProcedureSchema`: `patientId`, `procedureTypeId`, `appointmentId?`, `technique?`, `clinicalResponse?`, `adverseEffects?`, `notes?`, `followUpDate?`, `nextSessionObjectives?`
   - `diagramSaveSchema`: `procedureRecordId`, `viewType`, `points[]` (array of point objects with x, y, productName, activeIngredient, quantity, quantityUnit, technique, depth, notes)
   - `productApplicationSchema`: `procedureRecordId`, `applications[]` (array with productName, activeIngredient, totalQuantity, quantityUnit, batchNumber, expirationDate, labelPhotoId?, applicationAreas, notes)

2. **Queries:**
   - `createProcedure(tenantId, practitionerId, data)` → procedure record
   - `updateProcedure(tenantId, procedureId, data)` → updated
   - `getProcedure(tenantId, procedureId)` → procedure with face diagrams, points, product applications, photos, consent acceptances joined
   - `listProcedures(tenantId, patientId)` → list ordered by `performed_at` desc, with procedure type name and practitioner name
   - `saveFaceDiagram(tenantId, procedureRecordId, viewType, points)` → upserts diagram + replaces all points (delete existing, insert new)
   - `getFaceDiagram(tenantId, procedureRecordId)` → all diagrams and points for this procedure
   - `saveProductApplications(tenantId, procedureRecordId, applications)` → replaces all product applications
   - `getProductApplications(tenantId, procedureRecordId)` → list

3. **Server Actions:**
   - `createProcedureAction(formData)` → validates, creates, audit log. Owner + practitioner only. **MUST use `withTransaction()` from `src/lib/tenant.ts`** — all writes (procedure record, face diagrams, diagram points, product applications, consent linkage, financial entry if applicable) happen in a single Postgres transaction. If any step fails, all changes are rolled back. This is the core aggregate boundary for clinical data integrity.
   - `updateProcedureAction(id, formData)` → validates, updates within transaction, audit log
   - `getProcedureAction(id)` → full procedure data
   - `listProceduresAction(patientId)` → evolution timeline
   - `saveFaceDiagramAction(procedureRecordId, viewType, points)` → saves diagram within transaction
   - `saveProductApplicationsAction(procedureRecordId, applications)` → saves applications within transaction

4. **Components:**
   - `ProcedureForm`: THE main clinical form. Full-page layout with sections:
     1. **Header**: procedure type select, date/time (auto-filled), status
     2. **Consent section**: checks if patient has active consent for this procedure category. If not → shows `ConsentViewer` inline (from Task 9). If yes → shows green "Termo assinado em {date}"
     3. **Photos (pre)**: `PhotoUploader` component (from Task 10) with timeline_stage forced to 'pre'
     4. **Face Diagram**: `FaceDiagramEditor` component (from Task 11). Loads previous session's points as ghost overlay if available.
     5. **Product details**: for each unique product used in the diagram, show a card with batch number, expiration date, label photo upload. Auto-populated product names from diagram points.
     6. **Clinical notes**: technique textarea, clinical response textarea, adverse effects textarea, general notes textarea
     7. **Follow-up**: date picker for follow-up date, textarea for next session objectives. "Agendar retorno" button → opens appointment form pre-filled.
     8. **Photos (post)**: `PhotoUploader` with timeline_stage forced to 'immediate_post'
     9. **Save button** → saves procedure, diagram, products, links photos
   - `ProcedureCard`: card showing procedure summary for the list view. Shows: date, procedure type, practitioner, status badge, mini face diagram preview (render points on a small face template), product totals.
   - `ProcedureList`: vertical timeline of procedure cards for a patient. "Novo Procedimento" button at the top. Each card links to procedure detail page.

5. **Page:**
   - `/pacientes/[id]/procedimentos/[procedureId]/page.tsx`: server component. Loads procedure data. Renders `ProcedureForm` in view or edit mode.

**Verification:** Full procedure flow works: select type → consent check → upload pre photos → place diagram points → add product details → clinical notes → schedule follow-up → upload post photos → save. Evolution timeline shows all procedures. Ghost overlay from previous session works.

**Commit:** `feat: procedure module - full clinical flow integrating face diagram, photos, consent, and products`

---

### Task 14: Patient Detail Page (Integration)

**Depends on:** Tasks 5, 6, 7, 8, 9, 10, 13
**Agent scope:** Creates the patient detail page FROM SCRATCH — this page does not exist yet. Builds the tabbed layout and wires each tab to its module's components.

**Files:**
- Create: `src/app/(platform)/pacientes/[id]/page.tsx` ← NEW file, not a modification
- Create: `src/components/patients/patient-tabs.tsx`
- Create: `src/components/patients/patient-data-tab.tsx`
- Create: `src/components/patients/patient-anamnesis-tab.tsx`
- Create: `src/components/patients/patient-procedures-tab.tsx`
- Create: `src/components/patients/patient-photos-tab.tsx`
- Create: `src/components/patients/patient-consent-tab.tsx`
- Create: `src/components/patients/patient-financial-tab.tsx`
- Create: `src/components/patients/patient-timeline-tab.tsx`

**What to build:**

Create `PatientTabs` component and wire each tab to its module's components. This is a NEW page — Task 5 only built the list page:

1. **Dados tab** (`patient-data-tab.tsx`): `PatientForm` from Task 5, pre-filled with patient data, in edit mode. Save updates patient record.

2. **Anamnese tab** (`patient-anamnesis-tab.tsx`): `AnamnesisForm` from Task 6. Loads existing anamnesis data. Auto-saves on change.

3. **Procedimentos tab** (`patient-procedures-tab.tsx`): `ProcedureList` from Task 13. Shows evolution timeline. "Novo Procedimento" button navigates to `/pacientes/[id]/procedimentos/novo`.

4. **Fotos tab** (`patient-photos-tab.tsx`): `PhotoGrid` from Task 10. Shows all photos for this patient organized by timeline stage. Upload button. Compare button. Annotation support.

5. **Termos tab** (`patient-consent-tab.tsx`): `ConsentHistory` from Task 9. Shows all signed consents. "Novo Termo" button → opens consent selection (which template type?) → opens `ConsentViewer` for signing.

6. **Financeiro tab** (`patient-financial-tab.tsx`): `FinancialList` from Task 8 filtered to this patient. Shows charges and installment status. "Nova Cobrança" button.

7. **Timeline tab** (`patient-timeline-tab.tsx`): unified chronological feed aggregating:
   - Procedures (with mini diagram preview)
   - Photos (thumbnails)
   - Consent acceptances
   - Appointments
   - Payments received
   - Each entry shows icon + timestamp + description. Ordered by date desc.

Update `/pacientes/[id]/page.tsx` to:
- Show patient header: name, age (calculated from birth_date), phone, gender, CPF (masked)
- Quick action buttons: "Novo Procedimento", "Novo Agendamento", "Nova Cobrança"
- Tab navigation using URL search params (`?tab=dados`)
- Render active tab component

**Verification:** All 7 tabs render correctly with real data. Tab navigation preserves state. Quick actions work. Timeline aggregates from all sources.

**Commit:** `feat: patient detail page - integrate all module tabs with real data`

---

### Task 15: Public Booking Page

**Depends on:** Task 7 (scheduling), Task 12 (settings with booking toggle)
**Agent scope:** Public-facing booking page + API routes

**Files:**
- Create: `src/app/c/[slug]/page.tsx`
- Create: `src/app/api/book/[slug]/route.ts`
- Create: `src/app/api/book/[slug]/slots/route.ts`
- Create: `src/components/booking/booking-page.tsx`
- Create: `src/components/booking/slot-picker.tsx`

**What to build:**

1. **API Routes** (no auth required):
   - `GET /api/book/[slug]` → returns clinic name, logo_url, description, and list of practitioners (name, id) for this clinic. Returns 404 if slug not found or booking disabled in settings.
   - `GET /api/book/[slug]/slots?practitioner_id=X&date=YYYY-MM-DD` → returns available time slots based on working hours minus existing appointments for that date. Returns array of `{ startTime: "09:00", endTime: "09:30" }`.
   - `POST /api/book/[slug]` → body: `{ name, phone, email, practitionerId, date, startTime }`. Creates appointment with `source = 'online_booking'`, `status = 'scheduled'`, `patient_id = null`, booking contact fields filled. Returns confirmation. Rate-limited (basic: check for duplicate booking from same phone in last 5 minutes).

2. **Components:**
   - `BookingPage`: public page layout (no sidebar, no header). Shows:
     - Clinic name and logo at the top
     - Step 1: Select practitioner (card grid or list)
     - Step 2: Select date (calendar widget) + time slot (grid of available slots)
     - Step 3: Enter name, phone, email
     - Step 4: Confirmation → "Agendamento solicitado!" with summary
     - Stepper UI with back/forward navigation
     - Mobile-first design (this is patient-facing)
   - `SlotPicker`: renders available slots for a selected date as a grid of clickable buttons. Groups by morning/afternoon. Shows practitioner's working hours. Disabled slots shown as grayed out.

3. **Page:**
   - `/c/[slug]/page.tsx`: server component. Fetches clinic data. If booking not enabled or slug not found → 404 page. Otherwise renders `BookingPage`.

**Verification:** Public page loads without auth. Shows practitioners. Date/slot selection works. Can submit booking. Booking appears in clinic's agenda. Rate limiting prevents duplicate submissions.

**Commit:** `feat: public booking page - online scheduling with slot picker, no auth required`

---

### Task 16: Onboarding Flow

**Depends on:** Task 12 (settings), Task 9 (consent templates)
**Agent scope:** 4-step onboarding wizard that REUSES Settings components in a wizard wrapper + default data seeding

**Files:**
- Create: `src/app/onboarding/page.tsx`
- Create: `src/components/onboarding/onboarding-wizard.tsx`
- Create: `src/actions/onboarding.ts`

**IMPORTANT: Do NOT create duplicate form components.** Reuse these from Task 12:
- `ClinicSettingsForm` from `src/components/settings/clinic-settings-form.tsx` for step 1 (clinic info + working hours — combine steps 1 and 2 into one since the form already handles both)
- `ProcedureTypeForm`/`ProcedureTypeList` from `src/components/settings/` for step 2 (procedure types)
- `InviteUserForm` from `src/components/settings/invite-user-form.tsx` for step 3 (team invite)

The onboarding wizard is a thin wrapper that: shows a stepper UI, renders Settings components per step, and calls `completeOnboarding()` at the end.

**What to build:**

1. **Server Action** `completeOnboarding(formData)`:
   - Updates tenant with clinic info, working hours
   - Creates procedure types from selections (use defaults from `DEFAULT_PROCEDURE_TYPES` + any custom ones added)
   - Creates default consent templates (4 templates with realistic Portuguese text)
   - Optionally sends invites to team members
   - Sets `settings.onboarding_completed = true` on tenant
   - Redirects to `/dashboard`

2. **Components:**
   - `OnboardingWizard`: stepper UI showing 4 steps with progress indicators. Manages state across steps. "Próximo" / "Anterior" / "Pular" buttons. Final "Começar a usar" button.
   - Step 1: Renders `ClinicSettingsForm` (from Task 12) — clinic name, phone, email, address, working hours. Slug auto-generated from name (preview: `floraclin.com.br/c/{slug}`). Pre-fill working hours with `DEFAULT_WORKING_HOURS`.
   - Step 2: Renders `ProcedureTypeList`/`ProcedureTypeForm` (from Task 12) — shows `DEFAULT_PROCEDURE_TYPES` as pre-checked suggestions. "Adicionar outro" uses the same form. Price input per type.
   - Step 3: Renders `InviteUserForm` (from Task 12) — optional. Dynamic list of email + role pairs. "Pular por enquanto" button.

3. **Page:**
   - `/onboarding/page.tsx`: checks if onboarding is already completed (from tenant settings). If yes → redirect to `/dashboard`. Otherwise render wizard.

**Default consent template content (Portuguese):**
Include realistic, professional consent text for each of the 4 types. These should be marked as "modelo sugerido — revise com seu advogado" in the template.

**Verification:** Fresh tenant is redirected to onboarding. Can complete all 4 steps. Defaults are seeded. Can skip optional steps. After completion → redirected to dashboard. Re-visiting `/onboarding` after completion → redirects to dashboard.

**Commit:** `feat: onboarding flow - 4-step wizard with default procedure types and consent templates`

---

## LAYER 3 — Final Assembly (2 Parallel Agents)

---

### Task 17: Dashboard

**Depends on:** All Layer 2 tasks
**Agent scope:** Dashboard page with aggregated data from all modules

**Files:**
- Modify: `src/app/(platform)/dashboard/page.tsx`
- Create: `src/components/dashboard/today-appointments.tsx`
- Create: `src/components/dashboard/quick-stats.tsx`
- Create: `src/components/dashboard/upcoming-follow-ups.tsx`
- Create: `src/components/dashboard/recent-activity.tsx`
- Create: `src/actions/dashboard.ts`
- Create: `src/db/queries/dashboard.ts`

**What to build:**

1. **Queries** (`src/db/queries/dashboard.ts`):
   - `getTodayAppointments(tenantId, practitionerId?)` → today's appointments with patient names, procedure types, status. Ordered by start_time.
   - `getQuickStats(tenantId, practitionerId?)` → { patientsThisWeek: number, proceduresThisMonth: number, revenueThisMonth: number }
   - `getUpcomingFollowUps(tenantId, practitionerId?)` → procedure records where `follow_up_date` is within next 14 days, with patient name. Ordered by follow_up_date asc.
   - `getRecentActivity(tenantId, limit: 10)` → recent audit log entries formatted for display. Shows: who did what, when, to which entity.

2. **Server Actions** (`src/actions/dashboard.ts`):
   - `getDashboardDataAction()` → calls all queries above, returns combined data. Respects role: practitioners see only their data, owners see all.

3. **Components:**
   - `TodayAppointments`: card with list of today's appointments. Each row: time, patient name, procedure type, status badge. Click → navigates to patient or appointment. Empty state: "Nenhum agendamento para hoje".
   - `QuickStats`: 3 stat cards in a row. Each shows label + value. "Pacientes esta semana", "Procedimentos este mês", "Receita este mês" (formatted as BRL).
   - `UpcomingFollowUps`: card with list of upcoming follow-ups. Each row: patient name, procedure type, follow-up date, days until. Click → navigates to patient.
   - `RecentActivity`: card with list of recent actions. Each row: icon + "João criou um procedimento para Maria" style description + relative time ("há 2 horas").

4. **Page:**
   - Dashboard layout: QuickStats on top (3 columns). Below: TodayAppointments (left, 2/3 width) + UpcomingFollowUps (right, 1/3 width). Below: RecentActivity (full width).
   - Quick action buttons at top right: "Novo Paciente", "Novo Agendamento" (links).

**Verification:** Dashboard shows real data from all modules. Stats are accurate. Appointments list is correct for today. Follow-ups show upcoming returns. Activity feed shows recent actions.

**Commit:** `feat: dashboard - today's appointments, stats, follow-ups, recent activity`

---

### Task 18: Audit Log Viewer

**Depends on:** All Layer 2 tasks
**Agent scope:** Audit log UI only

**Files:**
- Create: `src/db/queries/audit.ts`
- Create: `src/actions/audit.ts`
- Create: `src/components/audit/audit-log-viewer.tsx`

**What to build:**

1. **Audit log viewer** (owner-only, accessible from Settings):
   - `listAuditLogs(tenantId, { entityType?, entityId?, dateFrom?, dateTo?, page, limit })` → paginated audit logs with user name joined
   - `AuditLogViewer`: table showing: data/hora, usuário, ação, entidade, detalhes. Filter by entity type dropdown, date range. Expand row to see JSON changes diff. Pagination.
   - Add as a tab in Settings (`Auditoria` tab) — owner only.

2. **Cross-cutting audit verification:**
   - Verify every Server Action that mutates data creates an audit log entry
   - Verify every query on soft-deletable tables filters `WHERE deleted_at IS NULL`
   - Verify role checks are in place on all Server Actions
   - Fix any missing audit logs, soft-delete filters, or role checks found

**Verification:** Audit log viewer shows all actions. Every mutation creates a log entry. Soft-deleted records are filtered from all queries.

**Commit:** `feat: audit log viewer + cross-cutting audit verification`

---

### Task 19: Ship-Blocker Polish

**Depends on:** All Layer 2 tasks
**Agent scope:** Essential UX polish required before shipping to pilot clinics

**Files:**
- Modify: various component and page files

**What to build:**

1. **Loading states** — add Skeleton components (from shadcn) to:
   - Patient list page
   - Patient detail page (each tab)
   - Agenda page
   - Financial list page
   - Dashboard

2. **Empty states** — add helpful empty state messages to:
   - Patient list ("Nenhum paciente cadastrado. Comece adicionando seu primeiro paciente.")
   - Procedure list ("Nenhum procedimento registrado para este paciente.")
   - Photo grid ("Nenhuma foto enviada.")
   - Financial list ("Nenhuma cobrança registrada.")
   - Appointment list ("Nenhum agendamento para este período.")

3. **Mobile responsive sidebar** — hamburger menu on small screens:
   - Add a Sheet (shadcn) triggered by a menu button in the header
   - Sidebar slides in from the left on mobile
   - Closes on navigation

4. **Page metadata** — add `<title>` via Next.js `metadata` export to all pages

5. **Error boundaries** — add `error.tsx` files to key route groups for friendly error messages

**Verification:** Loading states appear during data fetches. Empty states show when lists are empty. Mobile sidebar works (test at 375px width). All pages have proper titles.

**Commit:** `feat: ship-blocker polish - loading states, empty states, mobile sidebar, error boundaries`

---

## Post-Implementation Checklist

After all tasks are complete, verify:

### Core functionality
- [ ] App boots without errors (`npm run dev`)
- [ ] TypeScript compiles without errors (`npx tsc --noEmit`)
- [ ] Lint passes (`npm run lint`)
- [ ] Login flow works end-to-end
- [ ] Onboarding creates default data and redirects to dashboard
- [ ] Fresh tenant is forced to onboarding (cannot access dashboard directly)
- [ ] Patient CRUD works
- [ ] Anamnesis auto-saves with optimistic locking (no stale data overwrites)
- [ ] Procedure flow works end-to-end (consent → photos → diagram → products → notes → follow-up)
- [ ] Procedure save is atomic (all-or-nothing transaction)
- [ ] Face diagram places points, calculates totals, shows ghost overlay
- [ ] Photo upload, annotation, and comparison all work
- [ ] Consent acceptance with checkbox and signature pad works
- [ ] Consent acceptance stores content snapshot and hash
- [ ] Calendar shows appointments in all 3 views
- [ ] Financial entry with installments works
- [ ] Public booking page accessible without auth
- [ ] Dashboard shows real aggregated data
- [ ] Settings pages functional
- [ ] Audit logs are being recorded for all mutations
- [ ] Mobile responsive (sidebar collapses, forms stack)

### Tenant isolation (CRITICAL — test with 2 tenants)
- [ ] Create two tenants with different data
- [ ] Log in as user in tenant A → cannot see tenant B patients, appointments, financial data, photos
- [ ] Every query includes `WHERE tenant_id = X` — grep all queries to verify
- [ ] Storage paths are tenant-prefixed — verify uploaded photos go to `{tenantId}/patients/...`
- [ ] Audit logs are scoped to tenant

### Multi-tenant auth
- [ ] User belonging to 2 tenants can switch between them via tenant switcher
- [ ] Tenant cookie persists across sessions
- [ ] Role permissions are tenant-specific (owner in tenant A, practitioner in tenant B)

### Concurrency
- [ ] Double-booking prevention: two simultaneous bookings for same slot → one succeeds, one fails with clear error
- [ ] Anamnesis concurrent edit: two tabs editing same anamnesis → second save shows stale data warning

### Data integrity
- [ ] Soft-deleted records don't appear in any list or query
- [ ] Consent acceptances cannot be modified or deleted (immutable)
- [ ] Audit logs cannot be modified or deleted (append-only)
