-- Feedback reward: a platform admin flags a trial clinic that sent feedback,
-- and its next checkout gets the feedback coupon. Additive only (two nullable
-- columns, no backfill): safe to apply before the deploy that uses it.
ALTER TABLE "floraclin"."tenant_subscriptions" ADD COLUMN IF NOT EXISTS "feedback_discount_granted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "floraclin"."tenant_subscriptions" ADD COLUMN IF NOT EXISTS "feedback_discount_granted_by" uuid REFERENCES "floraclin"."users"("id");
