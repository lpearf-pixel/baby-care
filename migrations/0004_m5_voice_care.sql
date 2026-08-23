ALTER TYPE "public"."care_source" ADD VALUE IF NOT EXISTS 'voice';--> statement-breakpoint
CREATE TABLE "voice_care_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"public_key" "bytea" NOT NULL,
	"capability" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "voice_care_devices_public_key_length" CHECK (octet_length("voice_care_devices"."public_key") = 32),
	CONSTRAINT "voice_care_devices_capability_fixed" CHECK ("voice_care_devices"."capability" = 'voice_care.intent.submit'),
	CONSTRAINT "voice_care_devices_status_closed" CHECK ("voice_care_devices"."status" in ('active', 'revoked')),
	CONSTRAINT "voice_care_devices_status_shape" CHECK (("voice_care_devices"."status" = 'active' and "voice_care_devices"."revoked_at" is null) or ("voice_care_devices"."status" = 'revoked' and "voice_care_devices"."revoked_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "voice_care_feeding_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"baby_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"lease_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"actor_membership_id" uuid NOT NULL,
	"start_request_id" uuid NOT NULL,
	"source" text DEFAULT 'voice' NOT NULL,
	"state" text NOT NULL,
	"proposal_json" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"proposal_digest" "bytea",
	"warning_digest" "bytea",
	"warning_codes_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"final_care_event_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voice_care_feeding_sessions_source_fixed" CHECK ("voice_care_feeding_sessions"."source" = 'voice'),
	CONSTRAINT "voice_care_feeding_sessions_state_closed" CHECK ("voice_care_feeding_sessions"."state" in ('pending', 'needs_confirmation', 'needs_review', 'cancelled', 'committing', 'committed')),
	CONSTRAINT "voice_care_feeding_sessions_version_positive" CHECK ("voice_care_feeding_sessions"."version" > 0),
	CONSTRAINT "voice_care_feeding_sessions_proposal_object" CHECK (jsonb_typeof("voice_care_feeding_sessions"."proposal_json") = 'object'),
	CONSTRAINT "voice_care_feeding_sessions_warning_codes_array" CHECK (jsonb_typeof("voice_care_feeding_sessions"."warning_codes_json") = 'array'),
	CONSTRAINT "voice_care_feeding_sessions_proposal_digest_length" CHECK ("voice_care_feeding_sessions"."proposal_digest" is null or octet_length("voice_care_feeding_sessions"."proposal_digest") = 32),
	CONSTRAINT "voice_care_feeding_sessions_warning_digest_length" CHECK ("voice_care_feeding_sessions"."warning_digest" is null or octet_length("voice_care_feeding_sessions"."warning_digest") = 32),
	CONSTRAINT "voice_care_feeding_sessions_warning_shape" CHECK (("voice_care_feeding_sessions"."warning_digest" is null) = ("voice_care_feeding_sessions"."warning_codes_json" = '[]'::jsonb)),
	CONSTRAINT "voice_care_feeding_sessions_expiry_bound" CHECK ("voice_care_feeding_sessions"."expires_at" > "voice_care_feeding_sessions"."started_at" and "voice_care_feeding_sessions"."expires_at" <= "voice_care_feeding_sessions"."started_at" + interval '6 hours'),
	CONSTRAINT "voice_care_feeding_sessions_timestamp_order" CHECK (("voice_care_feeding_sessions"."ended_at" is null or "voice_care_feeding_sessions"."ended_at" >= "voice_care_feeding_sessions"."started_at") and ("voice_care_feeding_sessions"."confirmed_at" is null or ("voice_care_feeding_sessions"."ended_at" is not null and "voice_care_feeding_sessions"."confirmed_at" >= "voice_care_feeding_sessions"."ended_at")) and ("voice_care_feeding_sessions"."cancelled_at" is null or "voice_care_feeding_sessions"."cancelled_at" >= "voice_care_feeding_sessions"."started_at")),
	CONSTRAINT "voice_care_feeding_sessions_state_shape" CHECK ((
        ("voice_care_feeding_sessions"."state" = 'pending' and "voice_care_feeding_sessions"."proposal_digest" is null and "voice_care_feeding_sessions"."final_care_event_id" is null and "voice_care_feeding_sessions"."ended_at" is null and "voice_care_feeding_sessions"."confirmed_at" is null and "voice_care_feeding_sessions"."cancelled_at" is null)
        or ("voice_care_feeding_sessions"."state" = 'needs_confirmation' and "voice_care_feeding_sessions"."proposal_digest" is not null and "voice_care_feeding_sessions"."final_care_event_id" is null and "voice_care_feeding_sessions"."ended_at" is not null and "voice_care_feeding_sessions"."confirmed_at" is null and "voice_care_feeding_sessions"."cancelled_at" is null)
        or ("voice_care_feeding_sessions"."state" = 'needs_review' and "voice_care_feeding_sessions"."final_care_event_id" is null and "voice_care_feeding_sessions"."confirmed_at" is null and "voice_care_feeding_sessions"."cancelled_at" is null)
        or ("voice_care_feeding_sessions"."state" = 'cancelled' and "voice_care_feeding_sessions"."final_care_event_id" is null and "voice_care_feeding_sessions"."confirmed_at" is null and "voice_care_feeding_sessions"."cancelled_at" is not null)
        or ("voice_care_feeding_sessions"."state" = 'committing' and "voice_care_feeding_sessions"."proposal_digest" is not null and "voice_care_feeding_sessions"."final_care_event_id" is null and "voice_care_feeding_sessions"."ended_at" is not null and "voice_care_feeding_sessions"."confirmed_at" is null and "voice_care_feeding_sessions"."cancelled_at" is null)
        or ("voice_care_feeding_sessions"."state" = 'committed' and "voice_care_feeding_sessions"."proposal_digest" is not null and "voice_care_feeding_sessions"."final_care_event_id" is not null and "voice_care_feeding_sessions"."ended_at" is not null and "voice_care_feeding_sessions"."confirmed_at" is not null and "voice_care_feeding_sessions"."cancelled_at" is null)
      ))
);
--> statement-breakpoint
CREATE TABLE "voice_care_intent_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"request_digest" "bytea" NOT NULL,
	"result_json" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voice_care_intent_receipts_digest_length" CHECK (octet_length("voice_care_intent_receipts"."request_digest") = 32),
	CONSTRAINT "voice_care_intent_receipts_result_object" CHECK (jsonb_typeof("voice_care_intent_receipts"."result_json") = 'object')
);
--> statement-breakpoint
CREATE TABLE "voice_care_leases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"baby_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"actor_membership_id" uuid NOT NULL,
	"client_request_id" uuid NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voice_care_leases_expiry_bound" CHECK ("voice_care_leases"."expires_at" > "voice_care_leases"."issued_at" and "voice_care_leases"."expires_at" <= "voice_care_leases"."issued_at" + interval '8 hours'),
	CONSTRAINT "voice_care_leases_revocation_order" CHECK ("voice_care_leases"."revoked_at" is null or "voice_care_leases"."revoked_at" >= "voice_care_leases"."issued_at")
);
--> statement-breakpoint
CREATE TABLE "voice_care_pairing_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_by_membership_id" uuid NOT NULL,
	"challenge_digest" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"consumed_by_device_id" uuid,
	CONSTRAINT "voice_care_pairing_challenges_digest_length" CHECK (octet_length("voice_care_pairing_challenges"."challenge_digest") = 32),
	CONSTRAINT "voice_care_pairing_challenges_expiry_bound" CHECK ("voice_care_pairing_challenges"."expires_at" > "voice_care_pairing_challenges"."created_at" and "voice_care_pairing_challenges"."expires_at" <= "voice_care_pairing_challenges"."created_at" + interval '5 minutes'),
	CONSTRAINT "voice_care_pairing_challenges_consumption_shape" CHECK (("voice_care_pairing_challenges"."consumed_at" is null and "voice_care_pairing_challenges"."consumed_by_device_id" is null) or ("voice_care_pairing_challenges"."consumed_at" between "voice_care_pairing_challenges"."created_at" and "voice_care_pairing_challenges"."expires_at" and "voice_care_pairing_challenges"."consumed_by_device_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "care_events" DROP CONSTRAINT "care_events_manual_actor_required";--> statement-breakpoint
ALTER TABLE "care_handoff_checkpoints" DROP CONSTRAINT "care_handoff_checkpoints_manual_actor_required";--> statement-breakpoint
CREATE UNIQUE INDEX "voice_care_devices_family_identity_idx" ON "voice_care_devices" USING btree ("family_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "voice_care_leases_session_owner_idx" ON "voice_care_leases" USING btree ("family_id","id","device_id","baby_id","actor_membership_id","actor_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "care_events_family_identity_idx" ON "care_events" USING btree ("family_id","id");--> statement-breakpoint
ALTER TABLE "voice_care_devices" ADD CONSTRAINT "voice_care_devices_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_care_feeding_sessions" ADD CONSTRAINT "voice_care_feeding_sessions_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_care_feeding_sessions" ADD CONSTRAINT "voice_care_feeding_sessions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_care_feeding_sessions" ADD CONSTRAINT "voice_care_feeding_sessions_family_baby_fk" FOREIGN KEY ("family_id","baby_id") REFERENCES "public"."babies"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_care_feeding_sessions" ADD CONSTRAINT "voice_care_feeding_sessions_lease_owner_fk" FOREIGN KEY ("family_id","lease_id","device_id","baby_id","actor_membership_id","actor_user_id") REFERENCES "public"."voice_care_leases"("family_id","id","device_id","baby_id","actor_membership_id","actor_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_care_feeding_sessions" ADD CONSTRAINT "voice_care_feeding_sessions_final_event_fk" FOREIGN KEY ("family_id","final_care_event_id") REFERENCES "public"."care_events"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_care_intent_receipts" ADD CONSTRAINT "voice_care_intent_receipts_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_care_intent_receipts" ADD CONSTRAINT "voice_care_intent_receipts_family_device_fk" FOREIGN KEY ("family_id","device_id") REFERENCES "public"."voice_care_devices"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_care_leases" ADD CONSTRAINT "voice_care_leases_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_care_leases" ADD CONSTRAINT "voice_care_leases_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_care_leases" ADD CONSTRAINT "voice_care_leases_family_baby_fk" FOREIGN KEY ("family_id","baby_id") REFERENCES "public"."babies"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_care_leases" ADD CONSTRAINT "voice_care_leases_family_device_fk" FOREIGN KEY ("family_id","device_id") REFERENCES "public"."voice_care_devices"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_care_leases" ADD CONSTRAINT "voice_care_leases_actor_membership_fk" FOREIGN KEY ("family_id","actor_membership_id","actor_user_id") REFERENCES "public"."family_memberships"("family_id","id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_care_pairing_challenges" ADD CONSTRAINT "voice_care_pairing_challenges_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_care_pairing_challenges" ADD CONSTRAINT "voice_care_pairing_challenges_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_care_pairing_challenges" ADD CONSTRAINT "voice_care_pairing_challenges_creator_membership_fk" FOREIGN KEY ("family_id","created_by_membership_id","created_by_user_id") REFERENCES "public"."family_memberships"("family_id","id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_care_pairing_challenges" ADD CONSTRAINT "voice_care_pairing_challenges_family_device_fk" FOREIGN KEY ("family_id","consumed_by_device_id") REFERENCES "public"."voice_care_devices"("family_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "voice_care_devices_public_key_idx" ON "voice_care_devices" USING btree ("public_key");--> statement-breakpoint
CREATE INDEX "voice_care_devices_family_status_idx" ON "voice_care_devices" USING btree ("family_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "voice_care_feeding_sessions_device_request_idx" ON "voice_care_feeding_sessions" USING btree ("device_id","start_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "voice_care_feeding_sessions_final_event_idx" ON "voice_care_feeding_sessions" USING btree ("final_care_event_id") WHERE "voice_care_feeding_sessions"."final_care_event_id" is not null;--> statement-breakpoint
CREATE INDEX "voice_care_feeding_sessions_family_baby_state_idx" ON "voice_care_feeding_sessions" USING btree ("family_id","baby_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "voice_care_intent_receipts_device_request_idx" ON "voice_care_intent_receipts" USING btree ("device_id","request_id");--> statement-breakpoint
CREATE INDEX "voice_care_intent_receipts_family_received_idx" ON "voice_care_intent_receipts" USING btree ("family_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "voice_care_leases_family_identity_idx" ON "voice_care_leases" USING btree ("family_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "voice_care_leases_idempotency_idx" ON "voice_care_leases" USING btree ("family_id","actor_user_id","client_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "voice_care_leases_one_active_device_idx" ON "voice_care_leases" USING btree ("family_id","device_id") WHERE "voice_care_leases"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "voice_care_pairing_challenges_digest_idx" ON "voice_care_pairing_challenges" USING btree ("challenge_digest");--> statement-breakpoint
CREATE INDEX "voice_care_pairing_challenges_family_expires_idx" ON "voice_care_pairing_challenges" USING btree ("family_id","expires_at");--> statement-breakpoint
ALTER TABLE "care_events" ADD CONSTRAINT "care_events_manual_actor_required" CHECK ("care_events"."source"::text not in ('manual', 'voice') or ("care_events"."actor_user_id" is not null and "care_events"."actor_membership_id" is not null and "care_events"."client_request_id" is not null));--> statement-breakpoint
ALTER TABLE "care_handoff_checkpoints" ADD CONSTRAINT "care_handoff_checkpoints_manual_actor_required" CHECK ("care_handoff_checkpoints"."source"::text not in ('manual', 'voice') or ("care_handoff_checkpoints"."actor_user_id" is not null and "care_handoff_checkpoints"."actor_membership_id" is not null and "care_handoff_checkpoints"."client_request_id" is not null));
