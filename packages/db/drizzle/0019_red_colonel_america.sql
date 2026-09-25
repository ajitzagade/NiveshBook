CREATE TABLE "available_balance_spends" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_project_id" uuid NOT NULL,
	"party_type" text NOT NULL,
	"share_id" uuid NOT NULL,
	"destination_type" text NOT NULL,
	"destination_project_id" uuid,
	"destination_requirement_id" uuid,
	"destination_share_id" uuid,
	"destination_party_type" text,
	"person_name" text,
	"amount" numeric(14, 2) NOT NULL,
	"notes" text,
	"idempotency_key" text NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "available_balance_spends_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "available_balances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"party_type" text NOT NULL,
	"share_id" uuid NOT NULL,
	"balance" numeric(14, 2) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "available_balances_party_share_project_unique" UNIQUE("party_type","share_id","project_id"),
	CONSTRAINT "available_balances_balance_non_negative" CHECK ("available_balances"."balance" >= 0)
);
--> statement-breakpoint
ALTER TABLE "money_movements" ALTER COLUMN "withdrawal_destination_allocation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "money_movements" ADD COLUMN "available_balance_spend_id" uuid;--> statement-breakpoint
ALTER TABLE "available_balance_spends" ADD CONSTRAINT "available_balance_spends_source_project_id_projects_id_fk" FOREIGN KEY ("source_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "available_balance_spends" ADD CONSTRAINT "available_balance_spends_destination_project_id_projects_id_fk" FOREIGN KEY ("destination_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "available_balance_spends" ADD CONSTRAINT "available_balance_spends_destination_requirement_id_investment_requirements_id_fk" FOREIGN KEY ("destination_requirement_id") REFERENCES "public"."investment_requirements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "available_balance_spends" ADD CONSTRAINT "available_balance_spends_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "available_balances" ADD CONSTRAINT "available_balances_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "available_balance_spends_source_project_id_idx" ON "available_balance_spends" USING btree ("source_project_id");--> statement-breakpoint
ALTER TABLE "money_movements" ADD CONSTRAINT "money_movements_available_balance_spend_id_available_balance_spends_id_fk" FOREIGN KEY ("available_balance_spend_id") REFERENCES "public"."available_balance_spends"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "money_movements_available_balance_spend_id_idx" ON "money_movements" USING btree ("available_balance_spend_id");--> statement-breakpoint
ALTER TABLE "money_movements" ADD CONSTRAINT "money_movements_exactly_one_source_check" CHECK (("money_movements"."withdrawal_destination_allocation_id" is null) <> ("money_movements"."available_balance_spend_id" is null));