CREATE TABLE "care_handoff_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"baby_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"actor_membership_id" uuid,
	"source" "care_source" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_request_id" uuid,
	"trace_id" text NOT NULL,
	CONSTRAINT "care_handoff_checkpoints_manual_actor_required" CHECK ("care_handoff_checkpoints"."source" <> 'manual' or ("care_handoff_checkpoints"."actor_user_id" is not null and "care_handoff_checkpoints"."actor_membership_id" is not null and "care_handoff_checkpoints"."client_request_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "care_handoff_reminder_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"baby_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"actor_membership_id" uuid NOT NULL,
	"local_time" text NOT NULL,
	"weekday_mask" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "care_handoff_reminder_rules_weekday_mask_valid" CHECK ("care_handoff_reminder_rules"."weekday_mask" between 1 and 127),
	CONSTRAINT "care_handoff_reminder_rules_local_time_valid" CHECK ("care_handoff_reminder_rules"."local_time" ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
ALTER TABLE "care_handoff_checkpoints" ADD CONSTRAINT "care_handoff_checkpoints_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_handoff_checkpoints" ADD CONSTRAINT "care_handoff_checkpoints_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_handoff_checkpoints" ADD CONSTRAINT "care_handoff_checkpoints_family_baby_fk" FOREIGN KEY ("family_id","baby_id") REFERENCES "public"."babies"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_handoff_checkpoints" ADD CONSTRAINT "care_handoff_checkpoints_actor_membership_fk" FOREIGN KEY ("family_id","actor_membership_id","actor_user_id") REFERENCES "public"."family_memberships"("family_id","id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_handoff_reminder_rules" ADD CONSTRAINT "care_handoff_reminder_rules_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_handoff_reminder_rules" ADD CONSTRAINT "care_handoff_reminder_rules_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_handoff_reminder_rules" ADD CONSTRAINT "care_handoff_reminder_rules_family_baby_fk" FOREIGN KEY ("family_id","baby_id") REFERENCES "public"."babies"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_handoff_reminder_rules" ADD CONSTRAINT "care_handoff_reminder_rules_actor_membership_fk" FOREIGN KEY ("family_id","actor_membership_id","actor_user_id") REFERENCES "public"."family_memberships"("family_id","id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "care_handoff_checkpoints_idempotency_idx" ON "care_handoff_checkpoints" USING btree ("family_id","actor_user_id","client_request_id") WHERE "care_handoff_checkpoints"."client_request_id" is not null;--> statement-breakpoint
CREATE INDEX "care_handoff_checkpoints_family_baby_occurred_idx" ON "care_handoff_checkpoints" USING btree ("family_id","baby_id","occurred_at");--> statement-breakpoint
CREATE INDEX "care_handoff_reminder_rules_owner_idx" ON "care_handoff_reminder_rules" USING btree ("family_id","baby_id","actor_membership_id");