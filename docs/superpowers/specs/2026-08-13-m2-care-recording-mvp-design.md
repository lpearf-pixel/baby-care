# M2 Care Recording MVP Design

Status: approved design, implementation blocked on M1-H production startup closure  
Date: 2026-08-13  
Repository: `lpearf-pixel/baby-care`  
Branch: `codex/m2-care-recording-mvp`

## 1. Purpose

M2 turns Baby Care from an identity/family shell into a practical newborn care recorder for Dad, Mom, and Nanny. The design is based on the family's confirmed real usage habits, not placeholder assumptions.

M2 must preserve the project principle that common actions take about 2-3 taps, manual facts remain authoritative, every write is attributable to an actor/source, and the system remains useful without Baby Guardian.

## 2. Confirmed family habits

These are product inputs and must not be silently replaced by generic defaults:

- Baby display nickname: `xiangxiang`.
- Bottle capacities in use: 90 ml, 150 ml, and 200 ml. These are container capacities only, **not feeding quick values**.
- Bottle feeding must distinguish expressed breast milk from formula.
- Direct breastfeeding is recorded as total session duration, not left/right breast timers.
- Diaper/stool logging uses detailed mode: urine/stool classification plus stool color, consistency, amount, and notes when relevant.
- Sleep entry needs fast backfill choices.
- Nanny handoff schedule is not yet known and must not be hard-coded in M2.
- Frequently logged care actions: burping, spit-up, crying, bathing, temperature, weight, and medication administration.
- Home priorities: time since last feed plus last feed amount/duration, time since last diaper, and rolling 24-hour measurable bottle intake.
- Bottle intake quick values must be learned from recent actual intake values. They must not use bottle capacity as a default shortcut.

## 3. Chosen architecture

Use strongly typed care records plus a unified timeline envelope.

Rejected alternatives:

- One generic JSON event table: fastest initially, but weak for validation, aggregates, migrations, and safe editing.
- Full medical-grade schema from day one: too broad for Birth Ready and likely to encode unnecessary assumptions.

The chosen model keeps shared event metadata stable while each core care type has a typed payload/table with domain validation.

## 4. Unified care event envelope

Every record exposed in the Baby Timeline has these stable concepts:

- `id`
- `baby_id`
- `family_id`
- `actor_user_id` when a human actor exists
- `source`: `manual | guardian | device | import | ai`
- `event_type`
- `occurred_at`: when the care action actually happened
- `created_at`: when the record was entered
- `updated_at`
- `trace_id`
- `status`: active or voided/undone
- optional note
- revision metadata sufficient for edit/undo history

The timeline envelope is not a license for arbitrary care JSON. Type-specific fields remain validated by dedicated contracts.

For normal manual writes, `family_id`, `baby_id`, `actor_user_id`, and `source=manual` are assigned by the authenticated server context rather than trusted from the client.

## 5. Feeding model

### 5.1 Feeding Session

Feeding is modeled as a session so one real-world care episode can contain one or more feeding components and related actions.

A session can include:

- direct breastfeeding
- expressed breast milk by bottle
- formula by bottle
- burping
- spit-up
- free note

Example:

`02:10 direct breastfeeding 18 min -> formula 45 ml -> burped -> small spit-up`

When a session contains multiple feeding components, “last feeding” may display the compact combined summary rather than dropping one component.

### 5.2 Direct breastfeeding

Confirmed family preference:

- record total duration only
- no left/right breast split in M2
- duration is measurable in minutes
- do not infer milliliters from breastfeeding duration

Rolling 24-hour summary shows breastfeeding separately, for example:

`Direct breastfeeding: 5 sessions · 86 min`

### 5.3 Bottle feeding

Bottle feeding fields:

- liquid type: `expressed_breast_milk | formula`
- actual consumed amount in ml
- optional bottle capacity: 90 / 150 / 200 ml or another entered capacity
- optional note

`bottle_capacity_ml` is metadata about the container and must never be added to intake totals.

Only actual consumed amount contributes to bottle-volume aggregates.

### 5.4 Dynamic recent quick values

M2 must not seed 90/150/200 ml as feeding amount buttons.

Quick values are deterministic and maintained separately for expressed breast milk and formula:

1. take the most recent 20 active bottle-feeding components for that liquid type;
2. group by exact actual consumed ml;
3. rank by frequency descending;
4. break frequency ties by most recent use descending;
5. display at most the top 3 unique amounts;
6. always provide `Other` / numeric entry;
7. with no history, show numeric entry only rather than invented feeding defaults.

This simple recency/frequency rule is preferred over ML and must be covered by unit tests.

## 6. Diaper and stool model

Fast first classification:

- urine
- stool
- urine + stool

For urine-only records, saving should remain minimal.

For any stool record, optional detailed fields are available:

- color
- consistency
- amount
- note

Detailed mode must not force every field to be filled for every diaper event.

The UI should progressively disclose stool details so a normal urine-only change can still finish in roughly 2-3 taps.

No diagnosis is generated from stool attributes.

## 7. Sleep model

Sleep is modeled as intervals with explicit start/end times.

Primary actions:

- `Start sleep`
- `Woke up`

Both support fast time choices:

- now
- 10 minutes ago
- 20 minutes ago
- 30 minutes ago
- custom time

Requirements:

- manual backfill is supported without an arbitrary historical cutoff
- an `occurred_at` more than 5 minutes in the future relative to server time is rejected as structurally invalid; the 5-minute tolerance exists only for device clock skew
- older backfills may receive a soft “confirm this time” prompt but remain recordable
- manual correction/edit is supported
- overlapping or inconsistent intervals generate a soft correction flow, not silent data loss
- future Guardian suggestions may propose corrections but never silently overwrite manual sleep facts

## 8. Other frequent care events

M2 includes these typed/manual events:

### Burping

- occurred time
- optional note
- may be linked to a feeding session

### Spit-up

- occurred time
- approximate amount: small / medium / large
- optional note
- may be linked to a feeding session

### Crying

- occurred time
- optional duration if known
- optional note

M2 records the event; it does not diagnose cry cause.

### Bathing

- occurred time
- optional note

### Temperature

- numeric temperature
- unit stored canonically as Celsius
- optional measurement method
- occurred time
- note

### Weight

- numeric weight
- stored canonically in kilograms
- occurred time
- note

### Medication administration

- medication display name
- actual administered dose
- dose unit
- occurred time
- optional note

Baby Care records what was administered. It must not calculate, prescribe, or recommend medication doses.

## 9. Home/current-state priorities

M2 must expose enough query support for the following first-screen facts, even if richer workspace presentation is completed in M3:

1. Last feeding
   - elapsed time since feed
   - bottle: liquid type + actual consumed ml
   - direct breastfeeding: total duration
   - combined feeding session: compactly show both when applicable
2. Last diaper
   - elapsed time
   - urine/stool classification
3. Rolling previous 24 hours
   - total measurable bottle intake ml
   - direct breastfeeding session count and total minutes shown separately
4. Current sleep state when determinable from manual sleep intervals

No fake values are displayed when data is absent.

## 10. Rolling 24-hour semantics

The primary summary window is a rolling 24-hour window ending at query time, not midnight-to-midnight.

Bottle total:

- sum actual consumed ml for active bottle components whose actual care time falls inside the window
- expressed breast milk and formula may be shown separately and combined
- never include bottle capacity
- never estimate direct breastfeeding ml

Direct breastfeeding summary:

- component/session count
- total recorded minutes

Calendar-day summaries remain secondary and can be expanded later.

## 11. Fast edit, undo, and revision model

Every manual M2 write must support correction.

After save, the UI should surface the latest record with quick `Undo` and `Edit` actions.

Undo must preserve audit history; it should void/revise a record rather than erase accountability.

Editing must retain:

- original actor/source
- edit actor
- changed timestamp
- enough before/after information for audit/debugging without storing secrets

## 12. Duplicate warning

Likely duplicate events generate a warning but do not hard-block saving.

Examples:

- Dad records formula 60 ml and Nanny attempts another formula 60 ml two minutes later
- two diaper events with nearly identical type and time

The warning should show the recent relevant record and offer:

- continue recording
- inspect/reuse the recent record

The duplicate detector should be deterministic, care-type-specific, and conservative. It is not a deduplication engine that silently merges family facts.

## 13. Input sanity warnings

M2 uses soft validation for plausible input mistakes.

Example: recent feeding amounts cluster near 60 ml and a user enters 600 ml. The UI/API may flag the value as unusual and ask for confirmation, but must not silently rewrite it to 60 ml.

Hard validation remains for structurally invalid data such as negative amounts/durations or an `occurred_at` beyond the allowed 5-minute future clock-skew tolerance.

## 14. Nanny handoff boundary

The real Nanny handoff schedule is currently unknown.

M2 therefore:

- does not hard-code a shift window
- keeps actor attribution complete
- may store a free care note where appropriate
- provides event/query foundations that M3 can use for handoff summaries

M3 will finalize handoff/shift UX after real schedule information is available.

## 15. Authorization

M1 server-side authorization remains authoritative.

Dad/Mom and Nanny may create normal care records for `xiangxiang` according to their caregiver permissions.

Restricted family administration remains unavailable to Nanny.

UI visibility is convenience only; API policy remains the enforcement boundary.

## 16. API and domain boundaries

M2 should introduce focused modules rather than a single oversized care route/service.

Recommended boundaries:

- feeding
- diaper
- sleep
- measurements (temperature/weight)
- care actions (burping/spit-up/crying/bathing/medication)
- timeline query
- rolling summary query
- revisions/undo
- duplicate/sanity rules

All write contracts include `occurredAt` so backfilled events are first-class.

The server assigns actor/family/baby from the authenticated context; clients must not be able to forge another actor/family/baby ID in normal family writes.

## 17. Database principles

- PostgreSQL remains the source of truth.
- Use migration-backed typed tables/relations for core care records.
- Keep event/revision history queryable.
- Store canonical numeric units where practical.
- Timestamps are stored unambiguously and presented using the family timezone (`Asia/Shanghai` for the current family configuration).
- Database constraints prevent negative amounts/durations and broken foreign-key ownership.
- Do not add Guardian/AI-specific care tables in M2.

## 18. Privacy and audit

Care records are private Baby Data.

Audit/diagnostic data must not include:

- passwords
- session tokens/cookies
- setup token
- unnecessary IP/network details
- full care payloads when a compact event identifier/reason is sufficient

Medication facts, temperatures, weights, and notes stay in the private care database and must not be dumped wholesale into compact diagnostics.

## 19. Offline/weak-network behavior

M2 does not require a full offline-first synchronization engine.

Birth Ready minimum:

- prevent accidental duplicate submit from repeated taps
- show clear save failure state
- retain unsaved form data in the current page where practical
- allow the user to retry deliberately

Full offline queue/conflict sync is deferred unless family simulation proves it necessary.

## 20. Testing strategy

Each implementation segment uses RED -> GREEN -> exact-head CI.

Required focused/domain tests:

- bottle capacity never affects intake total
- breast milk bottle and formula histories learn quick values independently
- recent-20 frequency/recency quick-value ranking is deterministic
- direct breastfeeding contributes minutes/count, never inferred ml
- rolling 24-hour boundary behavior
- diaper progressive detail validation
- sleep now/10/20/30/custom backfill
- future timestamp tolerance/rejection
- sleep correction/overlap handling
- undo/edit audit semantics
- duplicate warning without silent merge
- abnormal value confirmation without silent correction
- Nanny actor attribution and authorization
- medication record does not expose recommendation behavior

Required PostgreSQL integration:

- authenticated actor ownership
- migration constraints
- feeding session/component persistence
- revisions/voids
- rolling 24-hour query correctness
- concurrent caregiver writes do not lose actor/source attribution

Required Web tests:

- common feed/diaper/sleep records fit the intended short interaction path
- no bottle-capacity-as-intake shortcuts
- recent actual volume shortcuts render when history exists
- direct breastfeeding uses total-duration flow
- diaper details are progressive
- fast sleep backfill buttons exist
- recent record offers edit/undo

Production Compose gate should eventually simulate:

`setup/login -> bottle feed -> direct breastfeeding -> diaper -> sleep backfill -> summary -> edit/undo -> Nanny record attribution`

## 21. M1-H prerequisite and repository-state correction

Repository verification on 2026-08-13 found that `codex/m1-family-baby-foundation` is at `f0f3bbc2035ea6c6af6c89e47b17bd1b0ca5419c` while `codex/m1-h-production-flow` is three commits ahead and contains RED startup/Compose work that was not fully integrated into the M1 branch.

Therefore:

- do not claim M1 production startup closure until the M1-H GREEN implementation is verified and fast-forwarded/merged into the M1 baseline
- M2 design may be committed now
- M2 implementation must begin by closing/reconciling M1-H, then rebase/advance the M2 implementation branch onto that verified M1 baseline
- PR metadata and milestone files must reflect this factual state

This prerequisite is a delivery correction, not a change to the approved M2 product design.

## 22. Explicit non-goals for M2

Do not add:

- Guardian event ingestion
- JoyAI/Qwen runtime
- automated feeding recognition
- medical diagnosis
- medication dose recommendation
- vaccination management
- photo/video library
- full offline sync engine
- fixed Nanny shift schedule
- advanced trend dashboards beyond the rolling 24-hour requirements

## 23. Definition of Done

M2 is complete only when:

- mixed feeding sessions work with actual ml and direct-breastfeeding duration semantics
- recent actual bottle amounts produce dynamic shortcuts without using bottle capacity as intake
- diaper/stool, sleep backfill, burping, spit-up, crying, bathing, temperature, weight, and medication facts are recordable
- edit/undo and duplicate warnings are operational
- rolling 24-hour bottle intake and breastfeeding count/minutes are correct
- Dad/Mom/Nanny writes preserve authenticated actor/source
- M1-H production startup prerequisite is closed
- static, unit, Web, PostgreSQL integration, production build, and production Compose gates pass on the exact final head
- no M3/M5/medical scope has leaked into M2
