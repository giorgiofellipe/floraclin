-- NFS-e setting: when a patient has no address, the note uses the clinic's
-- address as the taker's. Additive with a default: safe to apply before the
-- deploy that uses it.
ALTER TABLE "floraclin"."nfse_settings" ADD COLUMN IF NOT EXISTS "clinic_address_fallback" boolean DEFAULT false NOT NULL;
