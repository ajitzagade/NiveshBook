CREATE TABLE "investment_adjustments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"party_type" text NOT NULL,
	"share_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"should_pay" numeric(14, 2) NOT NULL,
	"actual_paid" numeric(14, 2) NOT NULL,
	"adjustment_amount" numeric(14, 2) NOT NULL,
	"adjustment_type" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_adjustments_party_share_project_unique" UNIQUE("party_type","share_id","project_id")
);
--> statement-breakpoint
ALTER TABLE "investment_adjustments" ADD CONSTRAINT "investment_adjustments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_adjustments" ADD CONSTRAINT "investment_adjustments_requirement_id_investment_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."investment_requirements"("id") ON DELETE cascade ON UPDATE no action;