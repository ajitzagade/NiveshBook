CREATE TABLE "recommended_amounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"requirement_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"party_type" text NOT NULL,
	"share_id" uuid NOT NULL,
	"base_amount" numeric(14, 2) NOT NULL,
	"previous_pending" numeric(14, 2) NOT NULL,
	"previous_extra_paid" numeric(14, 2) NOT NULL,
	"recommended_amount" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommended_amounts_requirement_party_share_unique" UNIQUE("requirement_id","party_type","share_id")
);
--> statement-breakpoint
ALTER TABLE "recommended_amounts" ADD CONSTRAINT "recommended_amounts_requirement_id_investment_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."investment_requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommended_amounts" ADD CONSTRAINT "recommended_amounts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recommended_amounts_requirement_id_idx" ON "recommended_amounts" USING btree ("requirement_id");