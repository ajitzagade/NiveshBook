CREATE TABLE "withdrawal_transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"party_type" text NOT NULL,
	"share_id" uuid NOT NULL,
	"share_percent_snapshot" numeric(7, 4) NOT NULL,
	"can_take_snapshot" numeric(14, 2) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"transaction_date" date NOT NULL,
	"payment_mode" text NOT NULL,
	"reference_number" text,
	"notes" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "withdrawal_transactions_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "withdrawal_transactions" ADD CONSTRAINT "withdrawal_transactions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "withdrawal_transactions_project_id_idx" ON "withdrawal_transactions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "withdrawal_transactions_share_id_project_id_idx" ON "withdrawal_transactions" USING btree ("share_id","project_id");