-- Feedback reward: a platform admin flags a trial clinic that sent feedback,
-- and its next checkout gets the feedback coupon. checkout_session_id is the
-- clinic's open Checkout Session, expired when its terms change. Additive only
-- (nullable columns, no backfill): safe to apply before the deploy that uses it.
ALTER TABLE "floraclin"."tenant_subscriptions" ADD COLUMN IF NOT EXISTS "feedback_discount_granted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "floraclin"."tenant_subscriptions" ADD COLUMN IF NOT EXISTS "feedback_discount_granted_by" uuid;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "floraclin"."tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_feedback_discount_granted_by_users_id_fk" FOREIGN KEY ("feedback_discount_granted_by") REFERENCES "floraclin"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "floraclin"."tenant_subscriptions" ADD COLUMN IF NOT EXISTS "checkout_session_id" varchar(255);
