ALTER TABLE "care_event_revisions" ADD COLUMN "from_version" integer;--> statement-breakpoint
ALTER TABLE "care_event_revisions" ADD COLUMN "to_version" integer;--> statement-breakpoint
-- Legacy rows did not persist an event-local sequence. This deterministic
-- created_at/id ranking is a best-effort fallback only; equal timestamps
-- cannot reconstruct historical commit order. New writes persist lock-held
-- from/to versions directly.
WITH ranked_revisions AS (
  SELECT id,
         row_number() OVER (PARTITION BY event_id ORDER BY created_at, id)::integer AS from_version
    FROM "care_event_revisions"
)
UPDATE "care_event_revisions" AS revision
   SET "from_version" = ranked.from_version,
       "to_version" = ranked.from_version + 1
  FROM ranked_revisions AS ranked
 WHERE revision.id = ranked.id;--> statement-breakpoint
ALTER TABLE "care_event_revisions" ALTER COLUMN "from_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "care_event_revisions" ALTER COLUMN "to_version" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "care_event_revisions_event_from_version_idx" ON "care_event_revisions" USING btree ("event_id","from_version");--> statement-breakpoint
ALTER TABLE "care_event_revisions" ADD CONSTRAINT "care_event_revisions_version_positive" CHECK ("care_event_revisions"."from_version" > 0);--> statement-breakpoint
ALTER TABLE "care_event_revisions" ADD CONSTRAINT "care_event_revisions_version_step" CHECK ("care_event_revisions"."to_version" = "care_event_revisions"."from_version" + 1);
