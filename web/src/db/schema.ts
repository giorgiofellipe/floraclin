import { pgSchema, uuid, varchar, text, boolean, timestamp, decimal, integer, date, time, jsonb, inet, uniqueIndex, index, serial, type AnyPgColumn } from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'

export const floraclinSchema = pgSchema('floraclin')

// ─── PLATFORM & TENANCY ─────────────────────────────────────────────

export const tenants = floraclinSchema.table('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  logoUrl: text('logo_url'),
  phone: varchar('phone', { length: 20 }),
  email: varchar('email', { length: 255 }),
  address: jsonb('address'),
  workingHours: jsonb('working_hours'),
  settings: jsonb('settings').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
})

export const users = floraclinSchema.table('users', {
  id: uuid('id').primaryKey(), // matches Supabase auth.users.id
  email: varchar('email', { length: 255 }).notNull(),
  fullName: varchar('full_name', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 20 }),
  avatarUrl: text('avatar_url'),
  passwordHash: text('password_hash'),
  emailVerified: timestamp('email_verified', { withTimezone: true }),
  isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
  signatureData: text('signature_data'),
  signatureUpdatedAt: timestamp('signature_updated_at', { withTimezone: true }),
  professionalTitle: varchar('professional_title', { length: 100 }),
  registryType: varchar('registry_type', { length: 10 }),
  registryNumber: varchar('registry_number', { length: 20 }),
  registryState: varchar('registry_state', { length: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
})

export const tenantUsers = floraclinSchema.table('tenant_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  role: varchar('role', { length: 20 }).notNull(), // CHECK in migration: ('owner', 'practitioner', 'receptionist', 'financial')
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('uq_tenant_users_tenant_user').on(table.tenantId, table.userId),
])

// ─── PATIENTS ────────────────────────────────────────────────────────

export const patients = floraclinSchema.table('patients', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  responsibleUserId: uuid('responsible_user_id').references(() => users.id),
  fullName: varchar('full_name', { length: 255 }).notNull(),
  cpf: varchar('cpf', { length: 14 }),
  birthDate: date('birth_date'),
  gender: varchar('gender', { length: 20 }),
  email: varchar('email', { length: 255 }),
  phone: varchar('phone', { length: 20 }).notNull(),
  phoneSecondary: varchar('phone_secondary', { length: 20 }),
  address: jsonb('address'),
  occupation: varchar('occupation', { length: 100 }),
  referralSource: varchar('referral_source', { length: 100 }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('idx_patients_tenant').on(table.tenantId),
  index('idx_patients_name').on(table.tenantId, table.fullName),
  index('idx_patients_phone').on(table.tenantId, table.phone),
  index('idx_patients_cpf').on(table.tenantId, table.cpf),
])

// ─── ANAMNESIS ───────────────────────────────────────────────────────

export const anamneses = floraclinSchema.table('anamneses', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  patientId: uuid('patient_id').notNull().references(() => patients.id).unique(),
  mainComplaint: text('main_complaint'),
  patientGoals: text('patient_goals'),
  medicalHistory: jsonb('medical_history').default({}),
  medications: jsonb('medications').default([]),
  allergies: jsonb('allergies').default([]),
  previousSurgeries: jsonb('previous_surgeries').default([]),
  chronicConditions: jsonb('chronic_conditions').default([]),
  isPregnant: boolean('is_pregnant').default(false),
  isBreastfeeding: boolean('is_breastfeeding').default(false),
  lifestyle: jsonb('lifestyle').default({}),
  skinType: varchar('skin_type', { length: 20 }),
  skinConditions: jsonb('skin_conditions').default([]),
  skincareRoutine: jsonb('skincare_routine').default([]),
  previousAestheticTreatments: jsonb('previous_aesthetic_treatments').default([]),
  contraindications: jsonb('contraindications').default([]),
  facialEvaluationNotes: text('facial_evaluation_notes'),
  updatedBy: uuid('updated_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_anamneses_patient').on(table.tenantId, table.patientId),
])

export const anamnesisTokens = floraclinSchema.table('anamnesis_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  token: uuid('token').notNull().unique().defaultRandom(),
  patientId: uuid('patient_id').notNull().references(() => patients.id),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
}, (table) => [
  index('idx_anamnesis_tokens_token').on(table.token),
])

// ─── PRODUCTS CATALOG ───────────────────────────────────────────────

export const products = floraclinSchema.table('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 255 }).notNull(),
  category: varchar('category', { length: 50 }).notNull(),
  activeIngredient: varchar('active_ingredient', { length: 255 }),
  defaultUnit: varchar('default_unit', { length: 10 }).notNull().default('U'),
  isActive: boolean('is_active').notNull().default(true),
  showInDiagram: boolean('show_in_diagram').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('idx_products_tenant').on(table.tenantId),
])

// ─── PROCEDURES ──────────────────────────────────────────────────────

export const procedureTypes = floraclinSchema.table('procedure_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 255 }).notNull(),
  category: varchar('category', { length: 50 }).notNull(),
  description: text('description'),
  defaultPrice: decimal('default_price', { precision: 10, scale: 2 }),
  estimatedDurationMin: integer('estimated_duration_min').default(60),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
})

// appointments before procedureRecords due to FK
export const appointments = floraclinSchema.table('appointments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  patientId: uuid('patient_id').references(() => patients.id),
  practitionerId: uuid('practitioner_id').notNull().references(() => users.id),
  procedureTypeId: uuid('procedure_type_id').references(() => procedureTypes.id),
  date: date('date').notNull(),
  startTime: time('start_time').notNull(),
  endTime: time('end_time').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('scheduled'), // CHECK in migration
  source: varchar('source', { length: 20 }).notNull().default('internal'), // CHECK in migration
  bookingName: varchar('booking_name', { length: 255 }),
  bookingPhone: varchar('booking_phone', { length: 20 }),
  bookingEmail: varchar('booking_email', { length: 255 }),
  notes: text('notes'),
  googleEventId: varchar('google_event_id', { length: 255 }),
  clinicGoogleEventId: varchar('clinic_google_event_id', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('idx_appointments_date').on(table.tenantId, table.practitionerId, table.date),
  index('idx_appointments_patient').on(table.tenantId, table.patientId),
])

export const procedureRecords = floraclinSchema.table('procedure_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  patientId: uuid('patient_id').notNull().references(() => patients.id),
  practitionerId: uuid('practitioner_id').notNull().references(() => users.id),
  procedureTypeId: uuid('procedure_type_id').notNull().references(() => procedureTypes.id),
  appointmentId: uuid('appointment_id').references(() => appointments.id),
  performedAt: timestamp('performed_at', { withTimezone: true }),
  technique: text('technique'),
  clinicalResponse: text('clinical_response'),
  adverseEffects: text('adverse_effects'),
  notes: text('notes'),
  followUpDate: date('follow_up_date'),
  nextSessionObjectives: text('next_session_objectives'),
  additionalTypeIds: jsonb('additional_type_ids').default([]),
  status: varchar('status', { length: 20 }).notNull().default('draft'),
  plannedSnapshot: jsonb('planned_snapshot'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancellationReason: text('cancellation_reason'),
  financialPlan: jsonb('financial_plan'),
  patientPackageId: uuid('patient_package_id').references((): AnyPgColumn => patientPackages.id),
  sessionsTotal: integer('sessions_total').notNull().default(1),
  encounterId: uuid('encounter_id'),
  followupSnoozedUntil: date('followup_snoozed_until'),
  lastContactedAt: timestamp('last_contacted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('idx_procedure_records_patient').on(table.tenantId, table.patientId),
  index('idx_procedure_records_practitioner').on(table.tenantId, table.practitionerId),
  index('idx_procedure_records_encounter').on(table.encounterId),
  index('idx_procedure_records_followup_status').on(table.tenantId, table.status, table.followupSnoozedUntil),
])

// ─── PROCEDURE SESSIONS ─────────────────────────────────────────────

export const procedureSessions = floraclinSchema.table('procedure_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  procedureRecordId: uuid('procedure_record_id').notNull().references((): AnyPgColumn => procedureRecords.id, { onDelete: 'cascade' }),
  sessionOrdinal: integer('session_ordinal').notNull(),
  performedAt: timestamp('performed_at', { withTimezone: true }).notNull(),
  executedBy: uuid('executed_by').notNull().references(() => users.id),
  technique: text('technique'),
  clinicalResponse: text('clinical_response'),
  adverseEffects: text('adverse_effects'),
  notes: text('notes'),
  followUpDate: date('follow_up_date'),
  nextSessionObjectives: text('next_session_objectives'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('uq_procedure_sessions_record_ordinal').on(table.procedureRecordId, table.sessionOrdinal),
  index('idx_procedure_sessions_tenant_performed').on(table.tenantId, table.performedAt),
])

// ─── FACE DIAGRAM ────────────────────────────────────────────────────

export const faceDiagrams = floraclinSchema.table('face_diagrams', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  procedureRecordId: uuid('procedure_record_id').notNull().references(() => procedureRecords.id),
  procedureSessionId: uuid('procedure_session_id').references((): AnyPgColumn => procedureSessions.id),
  viewType: varchar('view_type', { length: 20 }).notNull().default('front'), // CHECK in migration
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('uq_face_diagrams_session_view').on(table.procedureSessionId, table.viewType).where(sql`procedure_session_id IS NOT NULL`),
])

export const diagramPoints = floraclinSchema.table('diagram_points', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  faceDiagramId: uuid('face_diagram_id').notNull().references(() => faceDiagrams.id, { onDelete: 'cascade' }),
  x: decimal('x', { precision: 5, scale: 2 }).notNull(),
  y: decimal('y', { precision: 5, scale: 2 }).notNull(),
  productName: varchar('product_name', { length: 255 }).notNull(),
  activeIngredient: varchar('active_ingredient', { length: 255 }),
  quantity: decimal('quantity', { precision: 8, scale: 2 }).notNull(),
  quantityUnit: varchar('quantity_unit', { length: 10 }).notNull().default('U'), // CHECK in migration
  technique: varchar('technique', { length: 100 }),
  depth: varchar('depth', { length: 50 }),
  notes: text('notes'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_diagram_points_diagram').on(table.faceDiagramId),
])

// ─── PHOTOS ──────────────────────────────────────────────────────────

export const photoAssets = floraclinSchema.table('photo_assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  patientId: uuid('patient_id').notNull().references(() => patients.id),
  procedureRecordId: uuid('procedure_record_id').references(() => procedureRecords.id),
  procedureSessionId: uuid('procedure_session_id').references((): AnyPgColumn => procedureSessions.id),
  storagePath: text('storage_path').notNull(),
  originalFilename: varchar('original_filename', { length: 255 }),
  mimeType: varchar('mime_type', { length: 50 }),
  fileSizeBytes: integer('file_size_bytes'),
  timelineStage: varchar('timeline_stage', { length: 20 }), // CHECK in migration
  takenAt: timestamp('taken_at', { withTimezone: true }),
  uploadedBy: uuid('uploaded_by').notNull().references(() => users.id),
  notes: text('notes'),
  cropBox: jsonb('crop_box'),
  cropAspect: decimal('crop_aspect', { precision: 10, scale: 4 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('idx_photo_assets_patient').on(table.tenantId, table.patientId),
])

export const photoAnnotations = floraclinSchema.table('photo_annotations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  photoAssetId: uuid('photo_asset_id').notNull().references(() => photoAssets.id, { onDelete: 'cascade' }),
  annotationData: jsonb('annotation_data').notNull(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── PRODUCT APPLICATIONS ────────────────────────────────────────────

export const productApplications = floraclinSchema.table('product_applications', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  procedureRecordId: uuid('procedure_record_id').notNull().references(() => procedureRecords.id),
  procedureSessionId: uuid('procedure_session_id').references((): AnyPgColumn => procedureSessions.id),
  productName: varchar('product_name', { length: 255 }).notNull(),
  activeIngredient: varchar('active_ingredient', { length: 255 }),
  totalQuantity: decimal('total_quantity', { precision: 8, scale: 2 }).notNull(),
  quantityUnit: varchar('quantity_unit', { length: 10 }).notNull().default('U'),
  batchNumber: varchar('batch_number', { length: 100 }),
  expirationDate: date('expiration_date'),
  labelPhotoId: uuid('label_photo_id').references(() => photoAssets.id),
  applicationAreas: text('application_areas'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── CONSENT ─────────────────────────────────────────────────────────

export const consentTemplates = floraclinSchema.table('consent_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  type: varchar('type', { length: 30 }).notNull(), // CHECK in migration: ('general', 'botox', 'filler', 'biostimulator', 'limpeza_pele', 'enzima', 'skinbooster', 'microagulhamento', 'custom', 'service_contract')
  title: varchar('title', { length: 255 }).notNull(),
  content: text('content').notNull(),
  version: integer('version').notNull().default(1),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('idx_consent_template_version').on(table.tenantId, table.type, table.version),
])

export const consentAcceptances = floraclinSchema.table('consent_acceptances', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  patientId: uuid('patient_id').notNull().references(() => patients.id),
  consentTemplateId: uuid('consent_template_id').notNull().references(() => consentTemplates.id),
  procedureRecordId: uuid('procedure_record_id').references(() => procedureRecords.id),
  acceptanceMethod: varchar('acceptance_method', { length: 20 }).notNull(), // CHECK in migration
  signatureData: text('signature_data'),
  contentHash: varchar('content_hash', { length: 64 }).notNull(), // SHA-256 of template content at acceptance time
  contentSnapshot: text('content_snapshot').notNull(), // full text of consent shown to patient
  acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
  ipAddress: inet('ip_address'),
  userAgent: text('user_agent'),
  signatureEvidence: jsonb('signature_evidence'),
  verificationCode: varchar('verification_code', { length: 16 }).unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_consent_acceptances_patient').on(table.tenantId, table.patientId),
])

export const consentSigningTokens = floraclinSchema.table('consent_signing_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  token: varchar('token', { length: 64 }).notNull().unique(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  patientId: uuid('patient_id').notNull().references(() => patients.id),
  procedureRecordId: uuid('procedure_record_id').notNull().references(() => procedureRecords.id),
  consentTemplateIds: uuid('consent_template_ids').array().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_consent_signing_tokens_token').on(table.token),
  index('idx_consent_signing_tokens_tenant').on(table.tenantId),
])

// ─── FINANCIAL ───────────────────────────────────────────────────────

export const financialEntries = floraclinSchema.table('financial_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  patientId: uuid('patient_id').notNull().references(() => patients.id),
  procedureRecordId: uuid('procedure_record_id').references(() => procedureRecords.id),
  appointmentId: uuid('appointment_id').references(() => appointments.id),
  description: varchar('description', { length: 255 }).notNull(),
  totalAmount: decimal('total_amount', { precision: 10, scale: 2 }).notNull(),
  installmentCount: integer('installment_count').notNull().default(1),
  status: varchar('status', { length: 20 }).notNull().default('pending'), // CHECK in migration
  notes: text('notes'),
  renegotiatedAt: timestamp('renegotiated_at', { withTimezone: true }),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('idx_financial_entries_patient').on(table.tenantId, table.patientId),
  index('idx_financial_entries_status').on(table.tenantId, table.status),
])

export const installments = floraclinSchema.table('installments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  financialEntryId: uuid('financial_entry_id').notNull().references(() => financialEntries.id),
  installmentNumber: integer('installment_number').notNull(),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  dueDate: date('due_date').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('pending'), // CHECK in migration
  paidAt: timestamp('paid_at', { withTimezone: true }),
  paymentMethod: varchar('payment_method', { length: 20 }), // CHECK in migration
  notes: text('notes'),
  fineAmount: decimal('fine_amount', { precision: 10, scale: 2 }).notNull().default('0'),
  interestAmount: decimal('interest_amount', { precision: 10, scale: 2 }).notNull().default('0'),
  amountPaid: decimal('amount_paid', { precision: 10, scale: 2 }).notNull().default('0'),
  lastFineInterestCalcAt: timestamp('last_fine_interest_calc_at', { withTimezone: true }),
  appliedFineType: varchar('applied_fine_type', { length: 20 }),
  appliedFineValue: decimal('applied_fine_value', { precision: 5, scale: 2 }),
  appliedInterestRate: decimal('applied_interest_rate', { precision: 5, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_installments_entry').on(table.financialEntryId),
  index('idx_installments_due').on(table.tenantId, table.dueDate, table.status),
])

// ─── CASH MOVEMENTS (append-only ledger) ─────────────────────────────

export const cashMovements = floraclinSchema.table('cash_movements', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  type: varchar('type', { length: 20 }).notNull(), // 'inflow' | 'outflow'
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  description: varchar('description', { length: 255 }).notNull(),
  paymentMethod: varchar('payment_method', { length: 20 }),
  movementDate: timestamp('movement_date', { withTimezone: true }).notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  paymentRecordId: uuid('payment_record_id'),
  expenseInstallmentId: uuid('expense_installment_id'),
  patientId: uuid('patient_id').references(() => patients.id),
  expenseCategoryId: uuid('expense_category_id'),
  recordedBy: uuid('recorded_by').notNull().references(() => users.id),
  reversedByMovementId: uuid('reversed_by_movement_id'),
}, (table) => [
  index('idx_cash_movements_tenant_date').on(table.tenantId, table.movementDate),
  index('idx_cash_movements_type').on(table.tenantId, table.type),
])

// ─── PAYMENT RECORDS ─────────────────────────────────────────────────

export const paymentRecords = floraclinSchema.table('payment_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  installmentId: uuid('installment_id').notNull().references(() => installments.id),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  paymentMethod: varchar('payment_method', { length: 20 }).notNull(),
  interestCovered: decimal('interest_covered', { precision: 10, scale: 2 }).notNull().default('0'),
  fineCovered: decimal('fine_covered', { precision: 10, scale: 2 }).notNull().default('0'),
  principalCovered: decimal('principal_covered', { precision: 10, scale: 2 }).notNull().default('0'),
  paidAt: timestamp('paid_at', { withTimezone: true }).notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  recordedBy: uuid('recorded_by').notNull().references(() => users.id),
  notes: text('notes'),
  // Reversal tracking
  reversedAt: timestamp('reversed_at', { withTimezone: true }),
  reversedBy: uuid('reversed_by').references(() => users.id),
  reversalReason: text('reversal_reason'),
}, (table) => [
  index('idx_payment_records_installment').on(table.installmentId),
])

// ─── RENEGOTIATION LINKS ─────────────────────────────────────────────

export const renegotiationLinks = floraclinSchema.table('renegotiation_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  originalEntryId: uuid('original_entry_id').notNull().references(() => financialEntries.id),
  newEntryId: uuid('new_entry_id').notNull().references(() => financialEntries.id),
  originalRemainingPrincipal: decimal('original_remaining_principal', { precision: 10, scale: 2 }).notNull(),
  penaltiesIncluded: decimal('penalties_included', { precision: 10, scale: 2 }).notNull().default('0'),
  penaltiesWaived: decimal('penalties_waived', { precision: 10, scale: 2 }).notNull().default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_renegotiation_links_original').on(table.originalEntryId),
  index('idx_renegotiation_links_new').on(table.newEntryId),
])

// ─── EXPENSES ────────────────────────────────────────────────────────

export const expenses = floraclinSchema.table('expenses', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  categoryId: uuid('category_id').notNull(),
  description: varchar('description', { length: 255 }).notNull(),
  totalAmount: decimal('total_amount', { precision: 10, scale: 2 }).notNull(),
  installmentCount: integer('installment_count').notNull().default(1),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  notes: text('notes'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('idx_expenses_tenant').on(table.tenantId),
  index('idx_expenses_category').on(table.tenantId, table.categoryId),
])

export const expenseInstallments = floraclinSchema.table('expense_installments', {
  id: uuid('id').primaryKey().defaultRandom(),
  expenseId: uuid('expense_id').notNull().references(() => expenses.id),
  installmentNumber: integer('installment_number').notNull(),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  dueDate: date('due_date').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  paymentMethod: varchar('payment_method', { length: 20 }),
  notes: text('notes'),
}, (table) => [
  index('idx_expense_installments_expense').on(table.expenseId),
])

export const expenseCategories = floraclinSchema.table('expense_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id'), // null = system default
  name: varchar('name', { length: 100 }).notNull(),
  icon: varchar('icon', { length: 50 }).notNull().default('circle'),
  isSystem: boolean('is_system').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('idx_expense_categories_tenant').on(table.tenantId),
])

export const expenseAttachments = floraclinSchema.table('expense_attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  expenseId: uuid('expense_id').notNull().references(() => expenses.id),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  fileUrl: text('file_url').notNull(),
  fileSize: integer('file_size').notNull(),
  mimeType: varchar('mime_type', { length: 100 }).notNull(),
  uploadedBy: uuid('uploaded_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_expense_attachments_expense').on(table.expenseId),
])

// ─── FINANCIAL SETTINGS ──────────────────────────────────────────────

export const financialSettings = floraclinSchema.table('financial_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id).unique(),
  fineType: varchar('fine_type', { length: 20 }).notNull().default('percentage'),
  fineValue: decimal('fine_value', { precision: 5, scale: 2 }).notNull().default('2.00'),
  monthlyInterestPercent: decimal('monthly_interest_percent', { precision: 5, scale: 2 }).notNull().default('1.00'),
  gracePeriodDays: integer('grace_period_days').notNull().default(0),
  bankName: varchar('bank_name', { length: 100 }),
  bankAgency: varchar('bank_agency', { length: 20 }),
  bankAccount: varchar('bank_account', { length: 30 }),
  pixKeyType: varchar('pix_key_type', { length: 20 }),
  pixKey: varchar('pix_key', { length: 100 }),
  defaultInstallmentCount: integer('default_installment_count').notNull().default(1),
  defaultPaymentMethod: varchar('default_payment_method', { length: 20 }),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── EVALUATION TEMPLATES ───────────────────────────────────────────

export const evaluationTemplates = floraclinSchema.table('evaluation_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  procedureTypeId: uuid('procedure_type_id').notNull().references(() => procedureTypes.id),
  name: varchar('name', { length: 255 }).notNull(),
  sections: jsonb('sections').notNull().default([]),
  isActive: boolean('is_active').notNull().default(true),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('uq_evaluation_templates_tenant_procedure').on(table.tenantId, table.procedureTypeId),
  index('idx_evaluation_templates_tenant').on(table.tenantId),
])

export const evaluationResponses = floraclinSchema.table('evaluation_responses', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  procedureRecordId: uuid('procedure_record_id').notNull().references(() => procedureRecords.id),
  templateId: uuid('template_id').notNull().references(() => evaluationTemplates.id),
  templateVersion: integer('template_version').notNull(),
  templateSnapshot: jsonb('template_snapshot').notNull(),
  responses: jsonb('responses').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('uq_evaluation_responses_tenant_procedure_template').on(table.tenantId, table.procedureRecordId, table.templateId),
  index('idx_evaluation_responses_procedure').on(table.tenantId, table.procedureRecordId),
])

// ─── AUDIT ───────────────────────────────────────────────────────────

export const auditLogs = floraclinSchema.table('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id'),
  userId: uuid('user_id').notNull().references(() => users.id),
  action: varchar('action', { length: 50 }).notNull(),
  entityType: varchar('entity_type', { length: 50 }).notNull(),
  entityId: uuid('entity_id'),
  changes: jsonb('changes'),
  ipAddress: inet('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_audit_logs_tenant').on(table.tenantId, table.createdAt),
  index('idx_audit_logs_entity').on(table.entityType, table.entityId),
])

// ─── AUTH.js ────────────────────────────────────────────────────────

// Note: sessions table is unused at runtime (JWT strategy handles session state),
// but DrizzleAdapter requires it in its config. Keep the definition for the adapter.
export const sessions = floraclinSchema.table('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionToken: varchar('session_token', { length: 255 }).notNull().unique(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { withTimezone: true }).notNull(),
})

export const accounts = floraclinSchema.table('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 255 }).notNull(),
  provider: varchar('provider', { length: 255 }).notNull(),
  providerAccountId: varchar('provider_account_id', { length: 255 }).notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  tokenType: varchar('token_type', { length: 255 }),
  scope: varchar('scope', { length: 255 }),
  idToken: text('id_token'),
  expiresAt: integer('expires_at'),
}, (table) => [
  index('idx_accounts_provider_account').on(table.provider, table.providerAccountId),
])

export const verificationTokens = floraclinSchema.table('verification_tokens', {
  identifier: varchar('identifier', { length: 255 }).notNull(),
  token: varchar('token', { length: 255 }).notNull().unique(),
  expires: timestamp('expires', { withTimezone: true }).notNull(),
})

// ─── PROSPECTS (CRM) ────────────────────────────────────────────────

export const prospects = floraclinSchema.table('prospects', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 255 }),
  phone: varchar('phone', { length: 30 }).notNull(),
  source: varchar('source', { length: 50 }).notNull().default('whatsapp'),
  stage: varchar('stage', { length: 20 }).notNull().default('novo'),
  intent: varchar('intent', { length: 50 }),
  sentiment: varchar('sentiment', { length: 20 }),
  aiTags: jsonb('ai_tags').default([]),
  value: decimal('value', { precision: 10, scale: 2 }),
  lostReason: text('lost_reason'),
  assignedUserId: uuid('assigned_user_id').references(() => users.id),
  convertedPatientId: uuid('converted_patient_id').references(() => patients.id),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('idx_prospects_tenant_stage').on(table.tenantId, table.stage),
  uniqueIndex('uq_prospects_tenant_phone').on(table.tenantId, table.phone).where(sql`stage NOT IN ('convertido', 'perdido')`),
])

export const prospectActivities = floraclinSchema.table('prospect_activities', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  prospectId: uuid('prospect_id').notNull().references(() => prospects.id),
  action: varchar('action', { length: 50 }).notNull(),
  details: jsonb('details'),
  performedBy: uuid('performed_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_prospect_activities_prospect').on(table.prospectId, table.createdAt),
])

export const prospectProcedureTypes = floraclinSchema.table('prospect_procedure_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  prospectId: uuid('prospect_id').notNull().references(() => prospects.id),
  procedureTypeId: uuid('procedure_type_id').notNull().references(() => procedureTypes.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('uq_prospect_procedure_type').on(table.prospectId, table.procedureTypeId),
  index('idx_prospect_procedure_types_prospect').on(table.prospectId),
])

// ─── WHATSAPP ───────────────────────────────────────────────────────

export const whatsappConversations = floraclinSchema.table('whatsapp_conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  phoneNumber: varchar('phone_number', { length: 30 }).notNull(),
  profileName: varchar('profile_name', { length: 255 }),
  prospectId: uuid('prospect_id').references(() => prospects.id),
  patientId: uuid('patient_id').references(() => patients.id),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
  lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
  unreadCount: integer('unread_count').notNull().default(0),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('uq_whatsapp_conversations_tenant_phone').on(table.tenantId, table.phoneNumber),
  index('idx_whatsapp_conversations_tenant_last_msg').on(table.tenantId, table.lastMessageAt),
])

export const whatsappMessages = floraclinSchema.table('whatsapp_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  conversationId: uuid('conversation_id').notNull().references(() => whatsappConversations.id),
  direction: varchar('direction', { length: 10 }).notNull(),
  metaMessageId: varchar('meta_message_id', { length: 255 }),
  body: text('body'),
  mediaType: varchar('media_type', { length: 20 }),
  mediaUrl: text('media_url'),
  mediaFilename: varchar('media_filename', { length: 500 }),
  templateName: varchar('template_name', { length: 255 }),
  deliveryStatus: varchar('delivery_status', { length: 20 }).notNull().default('sent'),
  errorCode: varchar('error_code', { length: 50 }),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_whatsapp_messages_conversation_ts').on(table.conversationId, table.timestamp),
  uniqueIndex('uq_whatsapp_messages_meta_id').on(table.metaMessageId).where(sql`meta_message_id IS NOT NULL`),
])

export const whatsappTemplates = floraclinSchema.table('whatsapp_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  metaTemplateId: varchar('meta_template_id', { length: 255 }),
  name: varchar('name', { length: 255 }).notNull(),
  language: varchar('language', { length: 10 }).notNull(),
  category: varchar('category', { length: 50 }).notNull(),
  status: varchar('status', { length: 20 }).notNull(),
  components: jsonb('components').notNull(),
  purposeKey: varchar('purpose_key', { length: 100 }),
  rejectedReason: text('rejected_reason'),
  blueprintSlug: varchar('blueprint_slug', { length: 100 }),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  variableMapping: jsonb('variable_mapping'),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('uq_whatsapp_templates_tenant_name_lang').on(table.tenantId, table.name, table.language),
  uniqueIndex('uq_whatsapp_templates_tenant_purpose').on(table.tenantId, table.purposeKey).where(sql`purpose_key IS NOT NULL`),
])

export const whatsappAutomations = floraclinSchema.table('whatsapp_automations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  trigger: varchar('trigger', { length: 50 }).notNull(),
  enabled: boolean('enabled').notNull().default(false),
  templateId: uuid('template_id').references(() => whatsappTemplates.id, { onDelete: 'set null' }),
  config: jsonb('config'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('uq_whatsapp_automations_tenant_trigger').on(table.tenantId, table.trigger),
])

export const whatsappQueuedMessages = floraclinSchema.table('whatsapp_queued_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  conversationId: uuid('conversation_id').notNull().references(() => whatsappConversations.id),
  body: text('body'),
  mediaType: varchar('media_type', { length: 20 }),
  mediaUrl: text('media_url'),
  status: varchar('status', { length: 20 }).notNull().default('queued'),
  resumeMetaMessageId: varchar('resume_meta_message_id', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  expiredAt: timestamp('expired_at', { withTimezone: true }),
}, (table) => [
  index('idx_whatsapp_queued_messages_conv_status').on(table.conversationId, table.status),
  index('idx_whatsapp_queued_messages_tenant_created').on(table.tenantId, table.createdAt),
])

// ─── CALENDAR SYNC ──────────────────────────────────────────────────

export const calendarConnections = floraclinSchema.table('calendar_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  userId: uuid('user_id').references(() => users.id),
  provider: varchar('provider', { length: 20 }).notNull().default('google'),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }).notNull(),
  calendarId: varchar('calendar_id', { length: 255 }).notNull().default('primary'),
  syncToken: text('sync_token'),
  channelId: varchar('channel_id', { length: 255 }),
  channelResourceId: varchar('channel_resource_id', { length: 255 }),
  channelExpiry: timestamp('channel_expiry', { withTimezone: true }),
  feedToken: varchar('feed_token', { length: 64 }).notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_calendar_connections_tenant').on(table.tenantId),
  index('idx_calendar_connections_channel').on(table.channelId),
])

export const calendarBlocks = floraclinSchema.table('calendar_blocks', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  practitionerId: uuid('practitioner_id').notNull().references(() => users.id),
  connectionId: uuid('connection_id').notNull().references(() => calendarConnections.id, { onDelete: 'cascade' }),
  googleEventId: varchar('google_event_id', { length: 255 }).notNull(),
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
])

// ─── SSE EVENTS ─────────────────────────────────────────────────────

export const sseEvents = floraclinSchema.table('sse_events', {
  id: serial('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  eventType: varchar('event_type', { length: 50 }).notNull(),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_sse_events_tenant_created').on(table.tenantId, table.createdAt),
])

// ─── BIRTHDAYS ───────────────────────────────────────────────────────

export const patientGreetings = floraclinSchema.table('patient_greetings', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  patientId: uuid('patient_id').notNull().references(() => patients.id),
  occasionYear: integer('occasion_year').notNull(),
  greetedAt: timestamp('greeted_at', { withTimezone: true }).notNull().defaultNow(),
  greetedBy: uuid('greeted_by').notNull().references(() => users.id),
}, (table) => [
  uniqueIndex('uq_patient_greetings_patient_year').on(table.patientId, table.occasionYear),
  index('idx_patient_greetings_tenant_year').on(table.tenantId, table.occasionYear),
])

// ─── PACKAGES ────────────────────────────────────────────────────────

export const packageTemplates = floraclinSchema.table('package_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  defaultPrice: decimal('default_price', { precision: 10, scale: 2 }),
  validityMonths: integer('validity_months'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('idx_package_templates_tenant').on(table.tenantId),
])

export const packageTemplateLines = floraclinSchema.table('package_template_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  templateId: uuid('template_id').notNull().references(() => packageTemplates.id, { onDelete: 'cascade' }),
  procedureTypeId: uuid('procedure_type_id').notNull().references(() => procedureTypes.id),
  sessionsCount: integer('sessions_count').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
}, (table) => [
  index('idx_package_template_lines_template').on(table.templateId),
])

export const patientPackages = floraclinSchema.table('patient_packages', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  patientId: uuid('patient_id').notNull().references(() => patients.id),
  templateId: uuid('template_id').references(() => packageTemplates.id),
  name: varchar('name', { length: 255 }).notNull(),
  totalAmount: decimal('total_amount', { precision: 10, scale: 2 }).notNull(),
  purchasedAt: date('purchased_at').notNull(),
  expiresAt: date('expires_at'),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelReason: text('cancel_reason'),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  closedReason: varchar('closed_reason', { length: 50 }),
  closeNote: text('close_note'),
  financialEntryId: uuid('financial_entry_id').notNull().references(() => financialEntries.id),
  soldBy: uuid('sold_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_patient_packages_tenant_patient').on(table.tenantId, table.patientId),
  index('idx_patient_packages_status').on(table.tenantId, table.status),
])

// ─── CLINICAL DOCUMENTS ──────────────────────────────────────────────

export const clinicalDocumentTemplates = floraclinSchema.table('clinical_document_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  kind: varchar('kind', { length: 20 }).notNull(), // CHECK: receita | atestado
  name: varchar('name', { length: 255 }).notNull(),
  body: text('body').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('idx_clinical_document_templates_tenant_kind').on(table.tenantId, table.kind),
])

export const clinicalDocuments = floraclinSchema.table('clinical_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  patientId: uuid('patient_id').notNull().references(() => patients.id),
  practitionerId: uuid('practitioner_id').notNull().references(() => users.id),
  kind: varchar('kind', { length: 20 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  body: text('body').notNull(),
  templateId: uuid('template_id').references(() => clinicalDocumentTemplates.id),
  professionalSnapshot: jsonb('professional_snapshot').notNull(),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  deliveredVia: varchar('delivered_via', { length: 20 }).notNull(),
  whatsappMessageId: text('whatsapp_message_id'),
  storagePath: text('storage_path'),
  verificationCode: varchar('verification_code', { length: 16 }).unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_clinical_documents_tenant_patient_issued').on(table.tenantId, table.patientId, table.issuedAt),
])

// ─── PROCEDURE FOLLOWUPS ─────────────────────────────────────────────

export const procedureFollowups = floraclinSchema.table('procedure_followups', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  procedureRecordId: uuid('procedure_record_id').notNull().references(() => procedureRecords.id, { onDelete: 'cascade' }),
  contactedBy: uuid('contacted_by').notNull().references(() => users.id),
  contactedAt: timestamp('contacted_at', { withTimezone: true }).notNull().defaultNow(),
  channel: varchar('channel', { length: 20 }).notNull(), // CHECK: whatsapp | call | in_person | other
  outcome: varchar('outcome', { length: 30 }).notNull(), // CHECK: agendou | pediu_para_aguardar | sem_resposta | desistiu | outro
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_procedure_followups_record_contacted').on(table.procedureRecordId, table.contactedAt),
])

// ─── PATIENT EVOLUTIONS ─────────────────────────────────────────────
// Free-text patient-level notes for the Evoluções tab. Soft-deletable.
// `patient_evolution_revisions.evolution_id` keeps ON DELETE CASCADE: we
// never hard-delete soft-deleted notes today, but if a maintenance job is
// added later, revisions go with the parent automatically.

export const patientEvolutions = floraclinSchema.table('patient_evolutions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  patientId: uuid('patient_id').notNull().references(() => patients.id),
  body: text('body').notNull(),
  authorId: uuid('author_id').notNull().references(() => users.id),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: uuid('deleted_by').references(() => users.id),
  deleteReason: text('delete_reason'),
}, (table) => [
  index('idx_patient_evolutions_feed').on(table.tenantId, table.patientId, table.occurredAt),
  index('idx_patient_evolutions_author').on(table.tenantId, table.authorId),
])

export const patientEvolutionRevisions = floraclinSchema.table('patient_evolution_revisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  evolutionId: uuid('evolution_id').notNull().references(() => patientEvolutions.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  editedBy: uuid('edited_by').notNull().references(() => users.id),
  editedAt: timestamp('edited_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_patient_evolution_revisions_evolution').on(table.evolutionId, table.editedAt),
])

// ─── RELATIONS ───────────────────────────────────────────────────────

export const productsRelations = relations(products, ({ one }) => ({
  tenant: one(tenants, { fields: [products.tenantId], references: [tenants.id] }),
}))

export const tenantsRelations = relations(tenants, ({ many }) => ({
  tenantUsers: many(tenantUsers),
  patients: many(patients),
  procedureTypes: many(procedureTypes),
  products: many(products),
  appointments: many(appointments),
  consentTemplates: many(consentTemplates),
}))

export const usersRelations = relations(users, ({ many }) => ({
  tenantUsers: many(tenantUsers),
  procedureRecords: many(procedureRecords),
}))

export const tenantUsersRelations = relations(tenantUsers, ({ one }) => ({
  tenant: one(tenants, { fields: [tenantUsers.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [tenantUsers.userId], references: [users.id] }),
}))

export const patientsRelations = relations(patients, ({ one, many }) => ({
  tenant: one(tenants, { fields: [patients.tenantId], references: [tenants.id] }),
  responsibleUser: one(users, { fields: [patients.responsibleUserId], references: [users.id] }),
  anamnesis: one(anamneses),
  procedureRecords: many(procedureRecords),
  photoAssets: many(photoAssets),
  appointments: many(appointments),
  consentAcceptances: many(consentAcceptances),
  financialEntries: many(financialEntries),
}))

export const anamnesesRelations = relations(anamneses, ({ one }) => ({
  tenant: one(tenants, { fields: [anamneses.tenantId], references: [tenants.id] }),
  patient: one(patients, { fields: [anamneses.patientId], references: [patients.id] }),
  updatedByUser: one(users, { fields: [anamneses.updatedBy], references: [users.id] }),
}))

export const procedureTypesRelations = relations(procedureTypes, ({ one }) => ({
  tenant: one(tenants, { fields: [procedureTypes.tenantId], references: [tenants.id] }),
}))

export const appointmentsRelations = relations(appointments, ({ one }) => ({
  tenant: one(tenants, { fields: [appointments.tenantId], references: [tenants.id] }),
  patient: one(patients, { fields: [appointments.patientId], references: [patients.id] }),
  practitioner: one(users, { fields: [appointments.practitionerId], references: [users.id] }),
  procedureType: one(procedureTypes, { fields: [appointments.procedureTypeId], references: [procedureTypes.id] }),
}))

export const procedureRecordsRelations = relations(procedureRecords, ({ one, many }) => ({
  tenant: one(tenants, { fields: [procedureRecords.tenantId], references: [tenants.id] }),
  patient: one(patients, { fields: [procedureRecords.patientId], references: [patients.id] }),
  practitioner: one(users, { fields: [procedureRecords.practitionerId], references: [users.id] }),
  procedureType: one(procedureTypes, { fields: [procedureRecords.procedureTypeId], references: [procedureTypes.id] }),
  appointment: one(appointments, { fields: [procedureRecords.appointmentId], references: [appointments.id] }),
  faceDiagrams: many(faceDiagrams),
  productApplications: many(productApplications),
  photoAssets: many(photoAssets),
  consentAcceptances: many(consentAcceptances),
}))

export const faceDiagramsRelations = relations(faceDiagrams, ({ one, many }) => ({
  tenant: one(tenants, { fields: [faceDiagrams.tenantId], references: [tenants.id] }),
  procedureRecord: one(procedureRecords, { fields: [faceDiagrams.procedureRecordId], references: [procedureRecords.id] }),
  points: many(diagramPoints),
}))

export const diagramPointsRelations = relations(diagramPoints, ({ one }) => ({
  tenant: one(tenants, { fields: [diagramPoints.tenantId], references: [tenants.id] }),
  faceDiagram: one(faceDiagrams, { fields: [diagramPoints.faceDiagramId], references: [faceDiagrams.id] }),
}))

export const photoAssetsRelations = relations(photoAssets, ({ one, many }) => ({
  tenant: one(tenants, { fields: [photoAssets.tenantId], references: [tenants.id] }),
  patient: one(patients, { fields: [photoAssets.patientId], references: [patients.id] }),
  procedureRecord: one(procedureRecords, { fields: [photoAssets.procedureRecordId], references: [procedureRecords.id] }),
  uploadedByUser: one(users, { fields: [photoAssets.uploadedBy], references: [users.id] }),
  annotations: many(photoAnnotations),
}))

export const photoAnnotationsRelations = relations(photoAnnotations, ({ one }) => ({
  tenant: one(tenants, { fields: [photoAnnotations.tenantId], references: [tenants.id] }),
  photoAsset: one(photoAssets, { fields: [photoAnnotations.photoAssetId], references: [photoAssets.id] }),
  createdByUser: one(users, { fields: [photoAnnotations.createdBy], references: [users.id] }),
}))

export const productApplicationsRelations = relations(productApplications, ({ one }) => ({
  tenant: one(tenants, { fields: [productApplications.tenantId], references: [tenants.id] }),
  procedureRecord: one(procedureRecords, { fields: [productApplications.procedureRecordId], references: [procedureRecords.id] }),
  labelPhoto: one(photoAssets, { fields: [productApplications.labelPhotoId], references: [photoAssets.id] }),
}))

export const consentTemplatesRelations = relations(consentTemplates, ({ one, many }) => ({
  tenant: one(tenants, { fields: [consentTemplates.tenantId], references: [tenants.id] }),
  acceptances: many(consentAcceptances),
}))

export const consentAcceptancesRelations = relations(consentAcceptances, ({ one }) => ({
  tenant: one(tenants, { fields: [consentAcceptances.tenantId], references: [tenants.id] }),
  patient: one(patients, { fields: [consentAcceptances.patientId], references: [patients.id] }),
  consentTemplate: one(consentTemplates, { fields: [consentAcceptances.consentTemplateId], references: [consentTemplates.id] }),
  procedureRecord: one(procedureRecords, { fields: [consentAcceptances.procedureRecordId], references: [procedureRecords.id] }),
}))

export const financialEntriesRelations = relations(financialEntries, ({ one, many }) => ({
  tenant: one(tenants, { fields: [financialEntries.tenantId], references: [tenants.id] }),
  patient: one(patients, { fields: [financialEntries.patientId], references: [patients.id] }),
  procedureRecord: one(procedureRecords, { fields: [financialEntries.procedureRecordId], references: [procedureRecords.id] }),
  appointment: one(appointments, { fields: [financialEntries.appointmentId], references: [appointments.id] }),
  createdByUser: one(users, { fields: [financialEntries.createdBy], references: [users.id] }),
  installments: many(installments),
}))

export const installmentsRelations = relations(installments, ({ one, many }) => ({
  tenant: one(tenants, { fields: [installments.tenantId], references: [tenants.id] }),
  financialEntry: one(financialEntries, { fields: [installments.financialEntryId], references: [financialEntries.id] }),
  paymentRecords: many(paymentRecords),
}))

export const paymentRecordsRelations = relations(paymentRecords, ({ one }) => ({
  installment: one(installments, { fields: [paymentRecords.installmentId], references: [installments.id] }),
  recordedByUser: one(users, { fields: [paymentRecords.recordedBy], references: [users.id] }),
}))

export const renegotiationLinksRelations = relations(renegotiationLinks, ({ one }) => ({
  originalEntry: one(financialEntries, { fields: [renegotiationLinks.originalEntryId], references: [financialEntries.id], relationName: 'renegotiatedFrom' }),
  newEntry: one(financialEntries, { fields: [renegotiationLinks.newEntryId], references: [financialEntries.id], relationName: 'renegotiatedTo' }),
}))

export const cashMovementsRelations = relations(cashMovements, ({ one }) => ({
  tenant: one(tenants, { fields: [cashMovements.tenantId], references: [tenants.id] }),
  recordedByUser: one(users, { fields: [cashMovements.recordedBy], references: [users.id] }),
  patient: one(patients, { fields: [cashMovements.patientId], references: [patients.id] }),
}))

export const expensesRelations = relations(expenses, ({ one, many }) => ({
  tenant: one(tenants, { fields: [expenses.tenantId], references: [tenants.id] }),
  category: one(expenseCategories, { fields: [expenses.categoryId], references: [expenseCategories.id] }),
  createdByUser: one(users, { fields: [expenses.createdBy], references: [users.id] }),
  installments: many(expenseInstallments),
  attachments: many(expenseAttachments),
}))

export const expenseInstallmentsRelations = relations(expenseInstallments, ({ one }) => ({
  expense: one(expenses, { fields: [expenseInstallments.expenseId], references: [expenses.id] }),
}))

export const expenseCategoriesRelations = relations(expenseCategories, ({ one }) => ({
  tenant: one(tenants, { fields: [expenseCategories.tenantId], references: [tenants.id] }),
}))

export const expenseAttachmentsRelations = relations(expenseAttachments, ({ one }) => ({
  expense: one(expenses, { fields: [expenseAttachments.expenseId], references: [expenses.id] }),
  uploadedByUser: one(users, { fields: [expenseAttachments.uploadedBy], references: [users.id] }),
}))

export const financialSettingsRelations = relations(financialSettings, ({ one }) => ({
  tenant: one(tenants, { fields: [financialSettings.tenantId], references: [tenants.id] }),
}))

export const evaluationTemplatesRelations = relations(evaluationTemplates, ({ one }) => ({
  tenant: one(tenants, { fields: [evaluationTemplates.tenantId], references: [tenants.id] }),
  procedureType: one(procedureTypes, { fields: [evaluationTemplates.procedureTypeId], references: [procedureTypes.id] }),
}))

export const evaluationResponsesRelations = relations(evaluationResponses, ({ one }) => ({
  tenant: one(tenants, { fields: [evaluationResponses.tenantId], references: [tenants.id] }),
  procedureRecord: one(procedureRecords, { fields: [evaluationResponses.procedureRecordId], references: [procedureRecords.id] }),
  template: one(evaluationTemplates, { fields: [evaluationResponses.templateId], references: [evaluationTemplates.id] }),
}))

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
}))

export const calendarConnectionsRelations = relations(calendarConnections, ({ one, many }) => ({
  tenant: one(tenants, { fields: [calendarConnections.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [calendarConnections.userId], references: [users.id] }),
  calendarBlocks: many(calendarBlocks),
}))

export const calendarBlocksRelations = relations(calendarBlocks, ({ one }) => ({
  tenant: one(tenants, { fields: [calendarBlocks.tenantId], references: [tenants.id] }),
  practitioner: one(users, { fields: [calendarBlocks.practitionerId], references: [users.id] }),
  connection: one(calendarConnections, { fields: [calendarBlocks.connectionId], references: [calendarConnections.id] }),
}))
