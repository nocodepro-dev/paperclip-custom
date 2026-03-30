CREATE TABLE "company_sops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"source_type" text DEFAULT 'upload' NOT NULL,
	"source_path" text,
	"markdown_body" text NOT NULL,
	"has_screenshots" boolean DEFAULT false NOT NULL,
	"screenshot_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"generated_skill_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sop_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sop_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"asset_id" uuid,
	"local_path" text,
	"relative_path" text NOT NULL,
	"kind" text DEFAULT 'screenshot' NOT NULL,
	"step_number" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_sops" ADD CONSTRAINT "company_sops_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_sops" ADD CONSTRAINT "company_sops_generated_skill_id_company_skills_id_fk" FOREIGN KEY ("generated_skill_id") REFERENCES "public"."company_skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_assets" ADD CONSTRAINT "sop_assets_sop_id_company_sops_id_fk" FOREIGN KEY ("sop_id") REFERENCES "public"."company_sops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_assets" ADD CONSTRAINT "sop_assets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_assets" ADD CONSTRAINT "sop_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_sops_company_category_idx" ON "company_sops" USING btree ("company_id","category");--> statement-breakpoint
CREATE INDEX "company_sops_company_status_idx" ON "company_sops" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "sop_assets_sop_idx" ON "sop_assets" USING btree ("sop_id");