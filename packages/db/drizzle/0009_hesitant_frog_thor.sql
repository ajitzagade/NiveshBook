CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investment_transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"requirement_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"party_type" text NOT NULL,
	"share_id" uuid NOT NULL,
	"share_percent_snapshot" numeric(7, 4) NOT NULL,
	"should_pay_snapshot" numeric(14, 2) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"transaction_date" date NOT NULL,
	"payment_mode" text NOT NULL,
	"reference_number" text,
	"notes" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_transactions_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_transactions" ADD CONSTRAINT "investment_transactions_requirement_id_investment_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."investment_requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_transactions" ADD CONSTRAINT "investment_transactions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "investment_transactions_requirement_id_idx" ON "investment_transactions" USING btree ("requirement_id");--> statement-breakpoint
CREATE INDEX "investment_transactions_share_id_project_id_idx" ON "investment_transactions" USING btree ("share_id","project_id");