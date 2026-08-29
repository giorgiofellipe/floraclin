ALTER TABLE "floraclin"."meta_conversion_events" ADD COLUMN IF NOT EXISTS "patient_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "floraclin"."meta_conversion_events" ADD CONSTRAINT "meta_conversion_events_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "floraclin"."patients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
