CREATE TABLE "investment_requirements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"requirement_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "investment_requirements" ADD CONSTRAINT "investment_requirements_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "investment_requirements_project_id_idx" ON "investment_requirements" USING btree ("project_id");