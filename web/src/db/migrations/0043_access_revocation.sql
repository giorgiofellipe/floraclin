ALTER TABLE "floraclin"."users" ADD COLUMN IF NOT EXISTS "password_changed_at" timestamptz;--> statement-breakpoint
ALTER TABLE "floraclin"."consent_acceptances" ADD COLUMN IF NOT EXISTS "signing_token_id" uuid REFERENCES "floraclin"."consent_signing_tokens"("id");--> statement-breakpoint
ALTER TABLE "floraclin"."consent_acceptances" ADD COLUMN IF NOT EXISTS "patient_copy_sent_at" timestamptz;
