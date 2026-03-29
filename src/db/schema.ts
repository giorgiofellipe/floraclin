import { pgSchema, uuid, varchar, text, boolean, timestamp, decimal, integer, date, time, jsonb, inet, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

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
  isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
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
  performedAt: timestamp('performed_at', { withTimezone: true }).notNull().defaultNow(),
  technique: text('technique'),
  clinicalResponse: text('clinical_response'),
  adverseEffects: text('adverse_effects'),
  notes: text('notes'),
  followUpDate: date('follow_up_date'),
  nextSessionObjectives: text('next_session_objectives'),
  additionalTypeIds: jsonb('additional_type_ids').default([]),
  status: varchar('status', { length: 20 }).notNull().default('planned'), // CHECK in migration: ('planned', 'approved', 'executed', 'cancelled')
  plannedSnapshot: jsonb('planned_snapshot'), // frozen diagram points + quantities at approval
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancellationReason: text('cancellation_reason'),
  financialPlan: jsonb('financial_plan'), // {totalAmount, installmentCount, paymentMethod, notes}
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('idx_procedure_records_patient').on(table.tenantId, table.patientId),
  index('idx_procedure_records_practitioner').on(table.tenantId, table.practitionerId),
])

// ─── FACE DIAGRAM ────────────────────────────────────────────────────

export const faceDiagrams = floraclinSchema.table('face_diagrams', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  procedureRecordId: uuid('procedure_record_id').notNull().references(() => procedureRecords.id),
  viewType: varchar('view_type', { length: 20 }).notNull().default('front'), // CHECK in migration
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('uq_face_diagrams_record_view').on(table.procedureRecordId, table.viewType),
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
  storagePath: text('storage_path').notNull(),
  originalFilename: varchar('original_filename', { length: 255 }),
  mimeType: varchar('mime_type', { length: 50 }),
  fileSizeBytes: integer('file_size_bytes'),
  timelineStage: varchar('timeline_stage', { length: 20 }), // CHECK in migration
  takenAt: timestamp('taken_at', { withTimezone: true }),
  uploadedBy: uuid('uploaded_by').notNull().references(() => users.id),
  notes: text('notes'),
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
  type: varchar('type', { length: 30 }).notNull(), // CHECK in migration: ('general', 'botox', 'filler', 'biostimulator', 'custom', 'service_contract')
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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_consent_acceptances_patient').on(table.tenantId, table.patientId),
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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_installments_entry').on(table.financialEntryId),
  index('idx_installments_due').on(table.tenantId, table.dueDate, table.status),
])

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

export const installmentsRelations = relations(installments, ({ one }) => ({
  tenant: one(tenants, { fields: [installments.tenantId], references: [tenants.id] }),
  financialEntry: one(financialEntries, { fields: [installments.financialEntryId], references: [financialEntries.id] }),
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
