CREATE TABLE "floraclin"."products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"category" varchar(50) NOT NULL,
	"active_ingredient" varchar(255),
	"default_unit" varchar(10) DEFAULT 'U' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "floraclin"."procedure_records" ADD COLUMN "additional_type_ids" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "floraclin"."products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "floraclin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_products_tenant" ON "floraclin"."products" USING btree ("tenant_id");