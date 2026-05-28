-- Add 'pending' as a valid initial state for clinical_documents.delivered_via.
-- Previously, the CHECK constraint only allowed terminal/observed states
-- ('whatsapp', 'print', 'download', 'multiple') and the insert path forced an
-- arbitrary value (e.g. 'download') at issuance time — falsely recording a
-- delivery event that hadn't happened yet. The UI/server now bumps the value
-- when a real delivery event occurs (PATCH /delivery, send-whatsapp), and rows
-- start out as 'pending'.

ALTER TABLE "floraclin"."clinical_documents"
  DROP CONSTRAINT IF EXISTS "clinical_documents_delivered_via_check";--> statement-breakpoint

ALTER TABLE "floraclin"."clinical_documents"
  ADD CONSTRAINT "clinical_documents_delivered_via_check"
  CHECK ("delivered_via" IN ('pending', 'whatsapp', 'print', 'download', 'multiple'));--> statement-breakpoint
