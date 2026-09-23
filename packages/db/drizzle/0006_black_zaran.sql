ALTER TABLE "partner_shares" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "subpartner_shares" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "partner_shares" ADD CONSTRAINT "partner_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subpartner_shares" ADD CONSTRAINT "subpartner_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;