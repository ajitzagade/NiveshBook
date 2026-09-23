CREATE TABLE "subpartner_shares" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sub_partner_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"share_percent" numeric(7, 4) NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subpartner_shares" ADD CONSTRAINT "subpartner_shares_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subpartner_shares_project_id_idx" ON "subpartner_shares" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "subpartner_shares_partner_id_idx" ON "subpartner_shares" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "subpartner_shares_sub_partner_id_idx" ON "subpartner_shares" USING btree ("sub_partner_id");