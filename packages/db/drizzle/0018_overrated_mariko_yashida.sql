CREATE TABLE "money_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"withdrawal_destination_allocation_id" uuid NOT NULL,
	"source_project_id" uuid NOT NULL,
	"destination_project_id" uuid NOT NULL,
	"destination_investment_transaction_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "withdrawal_destination_allocations" ADD COLUMN "destination_requirement_id" uuid;--> statement-breakpoint
ALTER TABLE "withdrawal_destination_allocations" ADD COLUMN "destination_share_id" uuid;--> statement-breakpoint
ALTER TABLE "withdrawal_destination_allocations" ADD COLUMN "destination_party_type" text;--> statement-breakpoint
ALTER TABLE "money_movements" ADD CONSTRAINT "money_movements_withdrawal_destination_allocation_id_withdrawal_destination_allocations_id_fk" FOREIGN KEY ("withdrawal_destination_allocation_id") REFERENCES "public"."withdrawal_destination_allocations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_movements" ADD CONSTRAINT "money_movements_source_project_id_projects_id_fk" FOREIGN KEY ("source_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_movements" ADD CONSTRAINT "money_movements_destination_project_id_projects_id_fk" FOREIGN KEY ("destination_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_movements" ADD CONSTRAINT "money_movements_destination_investment_transaction_id_investment_transactions_id_fk" FOREIGN KEY ("destination_investment_transaction_id") REFERENCES "public"."investment_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "money_movements_withdrawal_destination_allocation_id_idx" ON "money_movements" USING btree ("withdrawal_destination_allocation_id");--> statement-breakpoint
CREATE INDEX "money_movements_destination_project_id_idx" ON "money_movements" USING btree ("destination_project_id");--> statement-breakpoint
ALTER TABLE "withdrawal_destination_allocations" ADD CONSTRAINT "withdrawal_destination_allocations_destination_requirement_id_investment_requirements_id_fk" FOREIGN KEY ("destination_requirement_id") REFERENCES "public"."investment_requirements"("id") ON DELETE no action ON UPDATE no action;