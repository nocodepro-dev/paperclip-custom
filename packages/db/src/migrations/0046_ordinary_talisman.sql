CREATE TABLE "knowledge_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"source_type" text DEFAULT 'local_path' NOT NULL,
	"source_path" text NOT NULL,
	"auto_discover" boolean DEFAULT true NOT NULL,
	"last_scanned_at" timestamp with time zone,
	"entry_count" integer DEFAULT 0 NOT NULL,
	"total_bytes" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"relative_path" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"sha256" text,
	"summary" text,
	"last_verified_at" timestamp with time zone,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_collections" ADD CONSTRAINT "knowledge_collections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_collections" ADD CONSTRAINT "knowledge_collections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_entries" ADD CONSTRAINT "knowledge_entries_collection_id_knowledge_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."knowledge_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_entries" ADD CONSTRAINT "knowledge_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_collections_company_source_path_idx" ON "knowledge_collections" USING btree ("company_id","source_path");--> statement-breakpoint
CREATE INDEX "knowledge_collections_company_project_idx" ON "knowledge_collections" USING btree ("company_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_entries_collection_path_idx" ON "knowledge_entries" USING btree ("collection_id","relative_path");--> statement-breakpoint
CREATE INDEX "knowledge_entries_company_kind_idx" ON "knowledge_entries" USING btree ("company_id","kind");--> statement-breakpoint
CREATE INDEX "knowledge_entries_collection_idx" ON "knowledge_entries" USING btree ("collection_id");