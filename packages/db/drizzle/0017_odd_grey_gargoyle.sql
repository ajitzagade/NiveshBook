CREATE TABLE "withdrawal_destination_allocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"withdrawal_transaction_id" uuid NOT NULL,
	"destination_type" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"destination_project_id" uuid,
	"person_name" text,
	"notes" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "withdrawal_destination_allocations" ADD CONSTRAINT "withdrawal_destination_allocations_withdrawal_transaction_id_withdrawal_transactions_id_fk" FOREIGN KEY ("withdrawal_transaction_id") REFERENCES "public"."withdrawal_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_destination_allocations" ADD CONSTRAINT "withdrawal_destination_allocations_destination_project_id_projects_id_fk" FOREIGN KEY ("destination_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "withdrawal_destination_allocations_withdrawal_transaction_id_idx" ON "withdrawal_destination_allocations" USING btree ("withdrawal_transaction_id");--> statement-breakpoint
CREATE INDEX "withdrawal_destination_allocations_idempotency_key_idx" ON "withdrawal_destination_allocations" USING btree ("idempotency_key");