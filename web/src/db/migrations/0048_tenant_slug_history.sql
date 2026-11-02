-- Booking links (/c/<slug>) a clinic moved off. For 90 days after retired_at the
-- old slug redirects to the clinic's current one and no other clinic may take it
-- (both enforced by the app, see db/queries/booking-slugs.ts). One row per slug:
-- a slug retired again later replaces its row. Additive only: safe to apply
-- before the deploy that uses it.
CREATE TABLE IF NOT EXISTS "floraclin"."tenant_slug_history" (
	"slug" varchar(100) PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"retired_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_slug_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tenant_slug_history_tenant" ON "floraclin"."tenant_slug_history" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "floraclin"."tenant_slug_history" ENABLE ROW LEVEL SECURITY;
