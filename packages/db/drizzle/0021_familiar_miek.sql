CREATE TABLE "adjustment_nettings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"party_type" text NOT NULL,
	"share_id" uuid NOT NULL,
	"investment_requirement_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"notes" text,
	"idempotency_key" text NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adjustment_nettings_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "adjustment_nettings" ADD CONSTRAINT "adjustment_nettings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment_nettings" ADD CONSTRAINT "adjustment_nettings_investment_requirement_id_investment_requirements_id_fk" FOREIGN KEY ("investment_requirement_id") REFERENCES "public"."investment_requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment_nettings" ADD CONSTRAINT "adjustment_nettings_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adjustment_nettings_project_id_idx" ON "adjustment_nettings" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "adjustment_nettings_share_id_project_id_idx" ON "adjustment_nettings" USING btree ("share_id","project_id");