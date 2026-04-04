CREATE TABLE "knowledge_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"relative_path" text NOT NULL,
	"kind" text DEFAULT 'document_set' NOT NULL,
	"primary_entry_id" uuid,
	"entry_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_entries" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_entries" ADD COLUMN "group_role" text;--> statement-breakpoint
ALTER TABLE "knowledge_groups" ADD CONSTRAINT "knowledge_groups_collection_id_knowledge_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."knowledge_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_groups_collection_idx" ON "knowledge_groups" USING btree ("collection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_groups_collection_path_idx" ON "knowledge_groups" USING btree ("collection_id","relative_path");