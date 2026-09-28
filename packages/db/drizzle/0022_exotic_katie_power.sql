CREATE TABLE "withdrawal_reallocation_allocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reallocation_id" uuid NOT NULL,
	"party_type" text NOT NULL,
	"share_id" uuid NOT NULL,
	"allocated_amount" numeric(14, 2) NOT NULL,
	"consumed_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "withdrawal_reallocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"party_type" text NOT NULL,
	"share_id" uuid NOT NULL,
	"declined_amount" numeric(14, 2) NOT NULL,
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "withdrawal_reallocation_allocations" ADD CONSTRAINT "withdrawal_reallocation_allocations_reallocation_id_withdrawal_reallocations_id_fk" FOREIGN KEY ("reallocation_id") REFERENCES "public"."withdrawal_reallocations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_reallocations" ADD CONSTRAINT "withdrawal_reallocations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_reallocations" ADD CONSTRAINT "withdrawal_reallocations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "withdrawal_reallocation_allocations_reallocation_id_idx" ON "withdrawal_reallocation_allocations" USING btree ("reallocation_id");--> statement-breakpoint
CREATE INDEX "withdrawal_reallocation_allocations_party_share_idx" ON "withdrawal_reallocation_allocations" USING btree ("party_type","share_id");