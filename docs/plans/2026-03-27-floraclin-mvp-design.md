# FloraClin — MVP Product Design

## 1. Executive Summary

**FloraClin** is a multi-tenant SaaS web application purpose-built for Orofacial Harmonization (HOF) clinics in Brazil. It serves clinic owners, practitioners, receptionists, and financial staff with an end-to-end platform covering clinical care, patient records, treatment evolution, photo management, consent handling, scheduling, and basic financial operations.

**Problem it solves:** HOF professionals today juggle between generic clinic management tools (not designed for aesthetic procedures), paper-based consent forms, WhatsApp for scheduling, spreadsheets for financials, and Google Drive for patient photos. None of these tools understand the HOF workflow — procedure tracking with batch/lot numbers, treatment evolution with photo timelines, or substance-specific consent forms.

**Core value proposition:** A single, affordable, focused system that speaks the language of HOF clinics — from anamnesis through procedure recording to before/after photo comparison — without the bloat and cost of enterprise clinical systems like Clinicorp.

**Key differentiators:**
- **HOF-native** — built around the specific workflow of orofacial harmonization, not adapted from generic clinic software
- **Photo-first clinical records** — timeline-based photo management integrated into every procedure
- **Face diagram with freeform point placement** — the core clinical tool for mapping injection/application sites with product quantities
- **Affordable and simple** — no training needed, designed for small-to-medium clinics (1-10 practitioners)
- **LGPD-aware from day one** — audit trails, consent traceability, data isolation

---

## 2. MVP Scope

### Included in MVP

**Core clinical:**
- Patient registration with full personal data
- Structured anamnesis (intake form) with all medical history fields
- Procedure/session recording with products, batch numbers, techniques
- Face diagram with freeform point placement (front + profile views)
- Per-point product/quantity/technique tracking with auto-sum totals
- Treatment evolution timeline per patient
- Photo uploads organized by timeline stages (pre/post/7d/30d/90d)
- Photo annotations (freehand drawing, arrows, text labels)
- Advanced photo comparison (side-by-side, overlay with opacity, slider)
- Before/after comparison
- Consent terms (general, botox, fillers, biostimulator) with checkbox + signature pad acceptance

**Operations:**
- Practitioner-based scheduling with day/week/month views
- Appointment status workflow (scheduled → confirmed → in_progress → completed → cancelled → no_show)
- Follow-up scheduling linked to procedures
- Simple reception queue view
- Public online booking page per clinic

**Financial:**
- Charge per procedure/appointment
- Payment recording with method (pix, card, cash, transfer)
- Installment support (parcelamento) with per-installment tracking
- Accounts receivable view
- Basic revenue overview (by period, by practitioner)

**Platform:**
- Multi-tenant with tenant_id isolation + RLS
- Supabase Auth (email/password, server-side only)
- Role-based access (owner, practitioner, receptionist, financial)
- Clinic settings (name, logo, working hours, procedure catalog)
- Audit logging on sensitive operations

### Excluded from MVP (Future Phases)

- Invoice/receipt generation (recibo/NFS-e)
- Patient-facing portal or app
- SMS/WhatsApp notifications
- Automated reminders
- CRM features (lead tracking, marketing campaigns)
- Analytics dashboards and reports
- AI-assisted features (skin analysis, treatment suggestions)
- OAuth/social login
- Multiple languages (English, Spanish)
- Mobile app
- Integration with external systems (labs, pharmacies)
- Subscription billing (Stripe integration for SaaS monetization)
- Inventory management
- 3D face diagram

---

## 3. User Roles & Permissions

| Role | Scope | What they can do | What they can't do |
|---|---|---|---|
| **Platform Admin** | Cross-tenant | Manage tenants, onboard clinics, view platform metrics, impersonate users for support | Access clinical data (unless impersonating) |
| **Clinic Owner** | Single tenant | Everything within their clinic: manage users, settings, view all patients/financials, all clinical features | Access other tenants, platform admin |
| **Practitioner** | Single tenant | Manage own patients, own schedule, create/edit procedures, anamnesis, photos, face diagrams, consent, view own financial summary | Manage users, clinic settings, view other practitioners' financials |
| **Receptionist** | Single tenant | Create/edit patients (personal data only), manage scheduling for all practitioners, register payments, view appointment list | Access clinical records (anamnesis, procedures, photos, face diagrams), edit financials beyond payment registration |
| **Financial** | Single tenant | View all payments, manage accounts receivable, installment tracking, revenue overview, mark payments as received | Access clinical records, manage scheduling, manage users |

**Key rules:**
- Practitioners see only their own patients by default, but clinic owner can toggle shared patient visibility
- Receptionist cannot see clinical data (LGPD / patient privacy)
- Platform Admin impersonation is audit-logged
- A user can hold one role per tenant but could belong to multiple tenants

---

## 4. Functional Architecture

```
┌─────────────────────────────────────────────────┐
│                   FloraClin                      │
├─────────────────────────────────────────────────┤
│  Auth Module                                     │
│  ├── Login (email/password via Supabase Auth)    │
│  ├── Session management (server-side)            │
│  ├── Role resolution (JWT claims + DB lookup)    │
│  └── Impersonation (platform admin only)         │
├─────────────────────────────────────────────────┤
│  Tenant Module                                   │
│  ├── Clinic registration & onboarding            │
│  ├── Clinic settings (name, logo, hours)         │
│  ├── Procedure catalog (types, default prices)   │
│  └── Tenant-scoped data filtering               │
├─────────────────────────────────────────────────┤
│  User Module                                     │
│  ├── User CRUD (invite by email, role assign)    │
│  ├── Role & permission enforcement               │
│  └── User-tenant association                     │
├─────────────────────────────────────────────────┤
│  Patient Module                                  │
│  ├── Patient CRUD + search                       │
│  ├── Personal data management                    │
│  ├── Patient timeline (unified activity view)    │
│  └── Patient visibility rules                   │
├─────────────────────────────────────────────────┤
│  Clinical Module                                 │
│  ├── Anamnesis (structured intake form)          │
│  ├── Procedure records (per session)             │
│  ├── Face diagram (freeform point placement)     │
│  ├── Product/substance tracking                  │
│  ├── Treatment evolution timeline                │
│  └── Follow-up management                        │
├─────────────────────────────────────────────────┤
│  Photo Module                                    │
│  ├── Upload (via Supabase Storage)               │
│  ├── Timeline organization (pre/post/7d/30d/90d)│
│  ├── Annotations (freeform drawing on photos)    │
│  ├── Advanced comparison (side-by-side/overlay/  │
│  │   slider)                                     │
│  └── Linked to procedures and patients           │
├─────────────────────────────────────────────────┤
│  Consent Module                                  │
│  ├── Consent templates (general, botox, filler)  │
│  ├── Template versioning                         │
│  ├── Acceptance (checkbox + signature pad)        │
│  └── Linked to patient + procedure + date        │
├─────────────────────────────────────────────────┤
│  Scheduling Module                               │
│  ├── Practitioner calendars                      │
│  ├── Day / week / month views                    │
│  ├── Appointment CRUD + status workflow          │
│  ├── Public booking page (per clinic)            │
│  └── Reception queue view                        │
├─────────────────────────────────────────────────┤
│  Financial Module                                │
│  ├── Charges (linked to procedures/appointments) │
│  ├── Payment recording + methods                 │
│  ├── Installment management (parcelamento)       │
│  ├── Accounts receivable                         │
│  └── Revenue overview                            │
├─────────────────────────────────────────────────┤
│  Platform Module (cross-tenant)                  │
│  ├── Audit logging                               │
│  ├── Notifications (in-app, email via Resend)    │
│  └── Platform admin tools                        │
└─────────────────────────────────────────────────┘
```

---

## 5. Domain Model

```
Tenant (Clinic)
 ├── has many Users (via TenantUser join)
 ├── has many Patients
 ├── has many ProcedureTypes (catalog)
 ├── has many ConsentTemplates
 ├── has many Appointments
 └── has clinic Settings

User
 ├── belongs to many Tenants (via TenantUser)
 ├── has one Role per tenant
 ├── has many Appointments (as practitioner)
 └── has many ProcedureRecords (as practitioner)

Patient
 ├── belongs to Tenant
 ├── belongs to User (responsible practitioner)
 ├── has one Anamnesis
 ├── has many ProcedureRecords
 ├── has many PhotoAssets
 ├── has many ConsentAcceptances
 ├── has many Appointments
 ├── has many FinancialEntries
 └── has many Installments (via FinancialEntry)

Anamnesis
 ├── belongs to Patient
 ├── personal data fields
 ├── medical history (JSON structured)
 ├── medications, allergies, surgeries
 ├── chronic conditions, pregnancy status
 ├── lifestyle, skin type, skincare routine
 ├── previous treatments
 ├── patient goals
 ├── contraindications
 └── updated_by User, versioned via AuditLog

ProcedureRecord
 ├── belongs to Patient
 ├── belongs to User (practitioner)
 ├── belongs to ProcedureType
 ├── belongs to Appointment (optional)
 ├── has one FaceDiagram
 ├── has many ProductApplications
 ├── has many PhotoAssets
 ├── has many ConsentAcceptances
 ├── date, time, technique, clinical response
 ├── adverse effects, notes
 ├── follow-up date, next session objectives
 └── linked FinancialEntry

FaceDiagram
 ├── belongs to ProcedureRecord
 ├── view_type (front, left_profile, right_profile)
 └── has many DiagramPoints

DiagramPoint
 ├── belongs to FaceDiagram
 ├── x, y coordinates (relative 0-100)
 ├── product name
 ├── substance / active ingredient
 ├── quantity (units or mL)
 ├── technique
 └── notes

ProductApplication
 ├── belongs to ProcedureRecord
 ├── product name, active ingredient
 ├── quantity total
 ├── batch/lot number, expiration date
 ├── label photo (PhotoAsset, optional)
 └── application areas

ProcedureType
 ├── belongs to Tenant
 ├── name, description, category
 ├── default price, estimated duration
 └── active flag

PhotoAsset
 ├── belongs to Patient
 ├── belongs to ProcedureRecord (optional)
 ├── storage_path, mime_type, file_size
 ├── timeline_stage (pre, immediate_post, 7d, 30d, 90d)
 ├── has many PhotoAnnotations
 └── uploaded_by User

PhotoAnnotation
 ├── belongs to PhotoAsset
 ├── annotation_data (JSON)
 └── created_by User

ConsentTemplate
 ├── belongs to Tenant
 ├── type (general, botox, filler, biostimulator)
 ├── content (rich text), version number
 └── active flag

ConsentAcceptance
 ├── belongs to Patient
 ├── belongs to ConsentTemplate (specific version)
 ├── belongs to ProcedureRecord (optional)
 ├── acceptance method (checkbox, signature, both)
 ├── signature_data (base64)
 ├── accepted_at, ip_address
 └── IMMUTABLE (no update, no delete)

Appointment
 ├── belongs to Tenant
 ├── belongs to Patient (nullable for online bookings)
 ├── belongs to User (practitioner)
 ├── date, start_time, end_time
 ├── status workflow
 ├── source (internal, online_booking)
 └── booking contact fields (pre-patient-link)

FinancialEntry
 ├── belongs to Patient
 ├── belongs to ProcedureRecord (optional)
 ├── total amount, installment count
 ├── status (pending, partial, paid, overdue)
 └── has many Installments

Installment
 ├── belongs to FinancialEntry
 ├── installment number, amount, due date
 ├── status (pending, paid, overdue)
 ├── paid_at, payment method
 └── (pix, credit_card, debit_card, cash, transfer)

AuditLog
 ├── tenant_id, user_id
 ├── action, entity_type, entity_id
 ├── changes (JSON diff)
 ├── ip_address, user_agent, timestamp
 └── IMMUTABLE (append-only)
```

---

## 6. Multi-Tenant Strategy

All FloraClin tables live in the `floraclin` schema within an existing Supabase project.

**Three layers of defense:**

1. **Application layer** — every query helper auto-injects `tenant_id` from authenticated user's session
2. **RLS Policies** — `USING (tenant_id = current_setting('app.current_tenant_id')::uuid)` on every tenant-scoped table
3. **FK constraints** — cross-tenant references are structurally impossible

**Per-request flow:**
1. User authenticates → Supabase JWT contains `user_id`
2. Server-side middleware resolves `user_id` → `tenant_id` + `role` from `tenant_users`
3. `SET LOCAL app.current_tenant_id = '<uuid>'` before any DB call
4. RLS policies enforce isolation even if application code has a bug
5. Application query helpers add `WHERE tenant_id = $1` as redundant safeguard

**Storage isolation:** paths include tenant_id as prefix: `{tenant_id}/patients/{patient_id}/...`

---

## 7. Database Design

All tables in `floraclin` schema. Common patterns:
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `deleted_at TIMESTAMPTZ` (soft delete)
- `tenant_id UUID NOT NULL` on tenant-scoped tables

```sql
-- PLATFORM & TENANCY

CREATE TABLE floraclin.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  logo_url TEXT,
  phone VARCHAR(20),
  email VARCHAR(255),
  address JSONB,
  working_hours JSONB,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE floraclin.users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  avatar_url TEXT,
  is_platform_admin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE floraclin.tenant_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES floraclin.tenants(id),
  user_id UUID NOT NULL REFERENCES floraclin.users(id),
  role VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'practitioner', 'receptionist', 'financial')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

-- PATIENTS

CREATE TABLE floraclin.patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES floraclin.tenants(id),
  responsible_user_id UUID REFERENCES floraclin.users(id),
  full_name VARCHAR(255) NOT NULL,
  cpf VARCHAR(14),
  birth_date DATE,
  gender VARCHAR(20),
  email VARCHAR(255),
  phone VARCHAR(20) NOT NULL,
  phone_secondary VARCHAR(20),
  address JSONB,
  occupation VARCHAR(100),
  referral_source VARCHAR(100),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_patients_tenant ON floraclin.patients(tenant_id);
CREATE INDEX idx_patients_name ON floraclin.patients(tenant_id, full_name);
CREATE INDEX idx_patients_phone ON floraclin.patients(tenant_id, phone);
CREATE INDEX idx_patients_cpf ON floraclin.patients(tenant_id, cpf);

-- ANAMNESIS

CREATE TABLE floraclin.anamneses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES floraclin.tenants(id),
  patient_id UUID NOT NULL REFERENCES floraclin.patients(id) UNIQUE,
  main_complaint TEXT,
  patient_goals TEXT,
  medical_history JSONB DEFAULT '{}',
  medications JSONB DEFAULT '[]',
  allergies JSONB DEFAULT '[]',
  previous_surgeries JSONB DEFAULT '[]',
  chronic_conditions JSONB DEFAULT '[]',
  is_pregnant BOOLEAN DEFAULT false,
  is_breastfeeding BOOLEAN DEFAULT false,
  lifestyle JSONB DEFAULT '{}',
  skin_type VARCHAR(20),
  skin_conditions JSONB DEFAULT '[]',
  skincare_routine JSONB DEFAULT '[]',
  previous_aesthetic_treatments JSONB DEFAULT '[]',
  contraindications JSONB DEFAULT '[]',
  facial_evaluation_notes TEXT,
  updated_by UUID REFERENCES floraclin.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_anamneses_patient ON floraclin.anamneses(tenant_id, patient_id);

-- PROCEDURES

CREATE TABLE floraclin.procedure_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES floraclin.tenants(id),
  name VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL,
  description TEXT,
  default_price DECIMAL(10,2),
  estimated_duration_min INTEGER DEFAULT 60,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE floraclin.procedure_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES floraclin.tenants(id),
  patient_id UUID NOT NULL REFERENCES floraclin.patients(id),
  practitioner_id UUID NOT NULL REFERENCES floraclin.users(id),
  procedure_type_id UUID NOT NULL REFERENCES floraclin.procedure_types(id),
  appointment_id UUID REFERENCES floraclin.appointments(id),
  performed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  technique TEXT,
  clinical_response TEXT,
  adverse_effects TEXT,
  notes TEXT,
  follow_up_date DATE,
  next_session_objectives TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'completed'
    CHECK (status IN ('in_progress', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_procedure_records_patient ON floraclin.procedure_records(tenant_id, patient_id);
CREATE INDEX idx_procedure_records_practitioner ON floraclin.procedure_records(tenant_id, practitioner_id);

-- FACE DIAGRAM

CREATE TABLE floraclin.face_diagrams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES floraclin.tenants(id),
  procedure_record_id UUID NOT NULL REFERENCES floraclin.procedure_records(id),
  view_type VARCHAR(20) NOT NULL DEFAULT 'front'
    CHECK (view_type IN ('front', 'left_profile', 'right_profile')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (procedure_record_id, view_type)
);

CREATE TABLE floraclin.diagram_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES floraclin.tenants(id),
  face_diagram_id UUID NOT NULL REFERENCES floraclin.face_diagrams(id) ON DELETE CASCADE,
  x DECIMAL(5,2) NOT NULL,
  y DECIMAL(5,2) NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  active_ingredient VARCHAR(255),
  quantity DECIMAL(8,2) NOT NULL,
  quantity_unit VARCHAR(10) NOT NULL DEFAULT 'U'
    CHECK (quantity_unit IN ('U', 'mL')),
  technique VARCHAR(100),
  depth VARCHAR(50),
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_diagram_points_diagram ON floraclin.diagram_points(face_diagram_id);

-- PRODUCT APPLICATIONS

CREATE TABLE floraclin.product_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES floraclin.tenants(id),
  procedure_record_id UUID NOT NULL REFERENCES floraclin.procedure_records(id),
  product_name VARCHAR(255) NOT NULL,
  active_ingredient VARCHAR(255),
  total_quantity DECIMAL(8,2) NOT NULL,
  quantity_unit VARCHAR(10) NOT NULL DEFAULT 'U',
  batch_number VARCHAR(100),
  expiration_date DATE,
  label_photo_id UUID REFERENCES floraclin.photo_assets(id),
  application_areas TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- PHOTOS

CREATE TABLE floraclin.photo_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES floraclin.tenants(id),
  patient_id UUID NOT NULL REFERENCES floraclin.patients(id),
  procedure_record_id UUID REFERENCES floraclin.procedure_records(id),
  storage_path TEXT NOT NULL,
  original_filename VARCHAR(255),
  mime_type VARCHAR(50),
  file_size_bytes INTEGER,
  timeline_stage VARCHAR(20)
    CHECK (timeline_stage IN ('pre', 'immediate_post', '7d', '30d', '90d', 'other')),
  taken_at TIMESTAMPTZ,
  uploaded_by UUID NOT NULL REFERENCES floraclin.users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_photo_assets_patient ON floraclin.photo_assets(tenant_id, patient_id);

CREATE TABLE floraclin.photo_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES floraclin.tenants(id),
  photo_asset_id UUID NOT NULL REFERENCES floraclin.photo_assets(id) ON DELETE CASCADE,
  annotation_data JSONB NOT NULL,
  created_by UUID NOT NULL REFERENCES floraclin.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CONSENT

CREATE TABLE floraclin.consent_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES floraclin.tenants(id),
  type VARCHAR(30) NOT NULL
    CHECK (type IN ('general', 'botox', 'filler', 'biostimulator', 'custom')),
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_consent_template_version
  ON floraclin.consent_templates(tenant_id, type, version);

CREATE TABLE floraclin.consent_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES floraclin.tenants(id),
  patient_id UUID NOT NULL REFERENCES floraclin.patients(id),
  consent_template_id UUID NOT NULL REFERENCES floraclin.consent_templates(id),
  procedure_record_id UUID REFERENCES floraclin.procedure_records(id),
  acceptance_method VARCHAR(20) NOT NULL
    CHECK (acceptance_method IN ('checkbox', 'signature', 'both')),
  signature_data TEXT,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_consent_acceptances_patient ON floraclin.consent_acceptances(tenant_id, patient_id);

-- SCHEDULING

CREATE TABLE floraclin.appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES floraclin.tenants(id),
  patient_id UUID REFERENCES floraclin.patients(id),
  practitioner_id UUID NOT NULL REFERENCES floraclin.users(id),
  procedure_type_id UUID REFERENCES floraclin.procedure_types(id),
  date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show')),
  source VARCHAR(20) NOT NULL DEFAULT 'internal'
    CHECK (source IN ('internal', 'online_booking')),
  booking_name VARCHAR(255),
  booking_phone VARCHAR(20),
  booking_email VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_appointments_date ON floraclin.appointments(tenant_id, practitioner_id, date);
CREATE INDEX idx_appointments_patient ON floraclin.appointments(tenant_id, patient_id);

-- FINANCIAL

CREATE TABLE floraclin.financial_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES floraclin.tenants(id),
  patient_id UUID NOT NULL REFERENCES floraclin.patients(id),
  procedure_record_id UUID REFERENCES floraclin.procedure_records(id),
  appointment_id UUID REFERENCES floraclin.appointments(id),
  description VARCHAR(255) NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL,
  installment_count INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'partial', 'paid', 'overdue', 'cancelled')),
  notes TEXT,
  created_by UUID NOT NULL REFERENCES floraclin.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_financial_entries_patient ON floraclin.financial_entries(tenant_id, patient_id);
CREATE INDEX idx_financial_entries_status ON floraclin.financial_entries(tenant_id, status);

CREATE TABLE floraclin.installments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES floraclin.tenants(id),
  financial_entry_id UUID NOT NULL REFERENCES floraclin.financial_entries(id),
  installment_number INTEGER NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  due_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'overdue')),
  paid_at TIMESTAMPTZ,
  payment_method VARCHAR(20)
    CHECK (payment_method IN ('pix', 'credit_card', 'debit_card', 'cash', 'transfer')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_installments_entry ON floraclin.installments(financial_entry_id);
CREATE INDEX idx_installments_due ON floraclin.installments(tenant_id, due_date, status);

-- AUDIT

CREATE TABLE floraclin.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  user_id UUID NOT NULL REFERENCES floraclin.users(id),
  action VARCHAR(50) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID,
  changes JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_tenant ON floraclin.audit_logs(tenant_id, created_at DESC);
CREATE INDEX idx_audit_logs_entity ON floraclin.audit_logs(entity_type, entity_id);
```

---

## 8. API Design

All endpoints are Server Actions unless noted as API routes.

```
AUTH
  action  auth/login          {email, password} → session
  action  auth/logout         → clear session
  action  auth/reset-password {email} → send reset link
  route   GET /api/auth/me    → current user + tenant + role

TENANTS
  action  tenants/create      {name, slug, ...} → tenant (platform admin)
  action  tenants/update      {id, ...} → tenant (owner)
  action  tenants/get         → current tenant settings

USERS
  action  users/invite        {email, role} → send invite
  action  users/list          → users in current tenant
  action  users/update        {id, role, is_active} → user
  action  users/remove        {id} → soft deactivate

PATIENTS
  action  patients/create     {full_name, phone, ...} → patient
  action  patients/update     {id, ...} → patient
  action  patients/list       {search?, page, limit} → paginated list
  action  patients/get        {id} → patient with summary counts
  action  patients/delete     {id} → soft delete
  action  patients/timeline   {id} → unified activity feed

ANAMNESIS
  action  anamnesis/upsert    {patient_id, ...fields} → anamnesis
  action  anamnesis/get       {patient_id} → anamnesis

PROCEDURES
  action  procedures/create   {patient_id, procedure_type_id, ...} → record
  action  procedures/update   {id, ...} → record
  action  procedures/get      {id} → record with diagram + products + photos
  action  procedures/list     {patient_id} → evolution timeline
  action  procedures/delete   {id} → soft delete

PROCEDURE TYPES
  action  procedure-types/create  {name, category, price, ...} → type
  action  procedure-types/update  {id, ...} → type
  action  procedure-types/list    → active types for current tenant

FACE DIAGRAMS
  action  diagrams/save       {procedure_record_id, view_type, points[]} → diagram
  action  diagrams/get        {procedure_record_id} → diagram with points

PRODUCT APPLICATIONS
  action  products/save       {procedure_record_id, applications[]} → saved
  action  products/get        {procedure_record_id} → applications list

PHOTOS
  action  photos/upload       {patient_id, procedure_record_id?, timeline_stage, file} → photo asset
  action  photos/list         {patient_id, procedure_record_id?} → photos
  action  photos/delete       {id} → soft delete
  action  photos/compare      {photo_id_a, photo_id_b} → signed URLs for both

PHOTO ANNOTATIONS
  action  annotations/save    {photo_asset_id, annotation_data} → annotation
  action  annotations/get     {photo_asset_id} → annotation

CONSENT
  action  consent/templates/list    → active templates for tenant
  action  consent/templates/create  {type, title, content} → template v1
  action  consent/templates/update  {id, content} → new version (auto-increment)
  action  consent/accept            {patient_id, template_id, procedure_record_id?, method, signature_data?, ip} → acceptance
  action  consent/history           {patient_id} → all acceptances

SCHEDULING
  action  appointments/create       {patient_id, practitioner_id, date, start_time, end_time, ...} → appointment
  action  appointments/update       {id, ...} → appointment
  action  appointments/update-status {id, status} → appointment
  action  appointments/list         {practitioner_id?, date_from, date_to} → appointments
  action  appointments/delete       {id} → soft delete

PUBLIC BOOKING (API routes - no auth)
  route   GET  /api/book/[slug]       → clinic info + practitioners
  route   GET  /api/book/[slug]/slots ?practitioner_id&date → available slots
  route   POST /api/book/[slug]       {name, phone, email, practitioner_id, date, start_time} → confirmation

FINANCIAL
  action  financial/create    {patient_id, procedure_record_id?, total_amount, installment_count, ...} → entry + installments
  action  financial/list      {patient_id?, status?, date_from?, date_to?} → paginated entries
  action  financial/get       {id} → entry with installments
  action  financial/pay-installment  {installment_id, payment_method} → updated
  action  financial/overview  {date_from, date_to, practitioner_id?} → revenue summary

AUDIT
  action  audit/list          {entity_type?, entity_id?, date_from?, date_to?} → paginated logs (owner only)
```

---

## 9. UX and Screens

### Navigation

```
Sidebar (persistent):
  Dashboard
  Agenda
  Pacientes
  Financeiro
  Configurações
  User menu + Sair

Public (no sidebar):
  /c/[slug] — public booking
```

### Key Screens

- **Login** `/login` — email/password, minimal
- **Onboarding** `/onboarding` — 4-step wizard (clinic info, hours, procedure types, invite team)
- **Dashboard** `/dashboard` — today's appointments, quick stats, upcoming follow-ups, recent activity, quick actions
- **Agenda** `/agenda` — day/week/month calendar, color-coded by status, drag to reschedule, filter by practitioner
- **Patient List** `/pacientes` — search, sortable table, pagination
- **Patient Detail** `/pacientes/[id]` — tabbed: Dados, Anamnese, Procedimentos, Fotos, Termos, Financeiro, Timeline
- **Procedure Detail** `/pacientes/[id]/procedimentos/[id]` — face diagram editor, products, clinical notes, follow-up
- **Photo Comparison** — side-by-side, overlay with opacity, slider
- **Consent Signing** — text display, checkbox, signature pad
- **Public Booking** `/c/[slug]` — practitioner selection, date/slot picker, contact form
- **Financial** `/financeiro` — tabs: A Receber, Visão Geral with charts
- **Settings** `/configuracoes` — tabs: Clínica, Procedimentos, Equipe, Termos, Agendamento

### Key UX Decisions

- Patient detail is the hub — 80% of practitioner time spent here
- Face diagram is inline within procedure form, not separate
- Collapsible anamnesis sections
- No separate "medical records" screen — anamnesis + procedures + photos + timeline ARE the record
- Mobile-responsive but desktop-first. Public booking page is mobile-first

---

## 10. Core Business Flows

### Clinic Onboarding
1. Platform admin creates tenant (or self-service signup)
2. Owner sets password → redirect to /onboarding
3. Fill clinic info → working hours → procedure types (with HOF defaults) → invite team
4. System creates default consent templates
5. Redirect to Dashboard

### Patient Creation
1. Click "Novo Paciente" → minimal fields: full_name, phone
2. Save → redirect to patient detail
3. Optionally fill remaining data + anamnesis

### Procedure Execution (main clinical flow)
1. Patient arrives → receptionist marks "Em Atendimento"
2. Practitioner opens patient → "Novo Procedimento"
3. Select procedure type
4. Consent step (check for active consent, present if needed)
5. Upload pre-procedure photos
6. Face diagram: tap to place points, set product/qty/technique per point
7. Product details: batch/lot, expiration, label photo
8. Clinical notes: technique, response, adverse effects
9. Follow-up: date + next session objectives → prompt to create appointment
10. Save → upload post-procedure photos

### Evolution Recording (follow-up)
1. Open patient → Procedimentos → view previous procedures
2. Create new procedure → can toggle "Mostrar anterior" for ghost overlay
3. Upload current photos → compare with previous via comparison tools

### Payment Tracking
1. After procedure → system prompts charge registration
2. Select installment count → auto-generate installment rows with due dates
3. Record immediate payment if applicable
4. Track installments in A Receber list

---

## 11. Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v4 |
| UI Components | shadcn/ui |
| Forms | React Hook Form + Zod |
| Calendar | Custom built on date-fns |
| Face Diagram | React + SVG template + Canvas overlay |
| Photo Annotation | Fabric.js |
| Image Comparison | Custom component (CSS + JS) |
| Signature Pad | react-signature-canvas |
| Charts | Recharts |
| Database | PostgreSQL (Supabase, `floraclin` schema) |
| ORM | Drizzle ORM |
| Auth | Supabase Auth (server-side only via @supabase/ssr) |
| File Storage | Supabase Storage (private bucket, signed URLs) |
| Email | Resend (app emails) + Supabase Auth (transactional) |
| Deployment | Vercel |
| Observability | Sentry |
| i18n | next-intl (pt-BR only for MVP) |
| Dates | date-fns + date-fns-tz |

---

## 12. Project Structure

```
floraclin/
├── .github/workflows/ci.yml
├── public/
│   ├── face-templates/ (front.svg, left-profile.svg, right-profile.svg)
│   └── logo.svg
├── src/
│   ├── app/
│   │   ├── (auth)/ (login, reset-password)
│   │   ├── (platform)/ (dashboard, agenda, pacientes, financeiro, configuracoes)
│   │   ├── c/[slug]/ (public booking)
│   │   ├── onboarding/
│   │   ├── api/ (auth/me, book/[slug])
│   │   ├── layout.tsx, globals.css
│   ├── actions/ (auth, patients, anamnesis, procedures, face-diagrams, photos, consent, appointments, financial, users, tenants, audit)
│   ├── components/
│   │   ├── ui/ (shadcn)
│   │   ├── layout/ (sidebar, header, user-menu)
│   │   ├── patients/
│   │   ├── anamnesis/
│   │   ├── procedures/
│   │   ├── face-diagram/ (editor, template, point, modal, summary)
│   │   ├── photos/ (grid, uploader, annotation-editor, comparison)
│   │   ├── consent/ (viewer, signature-pad, history)
│   │   ├── scheduling/ (calendar views, appointment card/form)
│   │   ├── financial/ (list, installments, payment, chart)
│   │   └── booking/ (booking-page, slot-picker)
│   ├── db/
│   │   ├── schema.ts (Drizzle schema)
│   │   ├── client.ts (Supabase + Drizzle setup)
│   │   ├── queries/ (tenant-scoped query functions)
│   │   └── migrations/
│   ├── lib/ (auth, tenant, storage, audit, constants, utils)
│   ├── validations/ (Zod schemas per domain)
│   ├── i18n/ (pt-BR.json, config)
│   └── types/ (shared TypeScript types)
├── drizzle.config.ts
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── package.json
└── .env.local
```

---

## 13. Security & Privacy

### Authentication
- Supabase Auth (server-side only via @supabase/ssr)
- Middleware validates JWT on every (platform) request
- Session refresh handled automatically

### Authorization
- `requireRole(...allowed)` helper in every Server Action
- Permission matrix enforced at action level (see roles table above)

### Tenant Isolation
- Three layers: application (tenant_id injection), RLS policies, FK constraints
- Storage paths prefixed with tenant_id
- Signed URLs with 15-min expiration

### Sensitive Data
- CPF encrypted at rest, masked in UI
- Photos in private Supabase Storage bucket
- Consent signatures stored as base64 in DB (coupled with acceptance record)
- Session tokens as HTTP-only secure cookies

### LGPD-Aware
- Purpose limitation, consent traceability, audit trails
- Patient timeline provides complete data view
- Soft delete + future anonymization capability
- Clinical records have 20-year legal retention

---

## 14. Roadmap

### Phase 1 — Build (full MVP scope)
All features from section 2, built with AI agent assistance.

### Phase 2 — Pilot & Stabilize
Ship to 1-2 real clinics, fix issues, tune UX.

### Phase 3 — Differentiation
CRM, WhatsApp, analytics, AI features, inventory, billing, mobile app.

---

## 15. Risks & Trade-offs

### Product Risks
- Practitioners resist digital workflow → face diagram must be faster than paper
- Photo storage costs → compress on upload (WebP, max 2048px)
- Consent template legal concerns → ship as "modelo sugerido"
- Public booking spam → rate limiting + Turnstile CAPTCHA

### Technical Risks
- Supabase RLS misconfiguration → explicit cross-tenant access tests
- Photo upload on slow connections → chunked upload with progress
- Drizzle + custom schema → validate early
- Server Actions at scale → presigned URLs for photo uploads

### Key Trade-offs
- JSONB for anamnesis (fast dev, limited cross-patient queries)
- Single Next.js app (simple, harder to add non-web clients later)
- Supabase Auth (convenient, vendor coupling)
- Soft delete everywhere (safe, requires WHERE deleted_at IS NULL)
- Photo compression (saves storage, loses original quality)

---

## 16. Decisions Log

| Decision | Choice | Rationale |
|---|---|---|
| Language | Code in English, UI in pt-BR | Standard practice, i18n-ready |
| Stack | Next.js 15 full-stack | Single deployable, fastest to MVP |
| Hosting | Vercel + Supabase | Least ops overhead |
| Supabase usage | Backend only, `floraclin` schema | Existing project, clean separation |
| Auth | Supabase Auth, server-side only | Already available, RLS integration |
| Consent signature | Checkbox + optional signature pad, clinic-configurable | Both options, clinic chooses |
| Financial MVP | Includes installments (parcelamento) | Table stakes for Brazilian clinics |
| Face diagram | Freeform point placement | Matches how practitioners think |
| ORM | Drizzle | Better custom schema support than Prisma |
| Calendar | Custom on date-fns | Full control over HOF-specific UX |
