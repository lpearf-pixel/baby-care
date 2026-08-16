import type { CareWarning, SleepIntervalDto, StartSleepInput, WakeSleepInput } from '@baby-care/contracts';
import { validateOccurredAt } from '@baby-care/domain';
import type { DatabaseContext } from '../db.js';
import type { CareActorContext } from './care-auth.js';
import { CareConfirmationRequiredError, CareStateConflictError, CareValidationError } from './care-errors.js';
import {
  appendCareRevision,
  createCareEvent,
  findByClientRequestId,
  loadCareEventForUpdate,
} from './care-event-repository.js';

interface SleepRow {
  id: string;
  occurred_at: Date;
  status: 'active' | 'voided';
  version: number;
  note: string | null;
  started_at: Date;
  ended_at: Date | null;
}

function toDto(row: SleepRow): SleepIntervalDto {
  return {
    id: row.id,
    occurredAt: row.occurred_at.toISOString(),
    status: row.status,
    startedAt: row.started_at.toISOString(),
    endedAt: row.ended_at ? row.ended_at.toISOString() : null,
    note: row.note,
    version: row.version,
  };
}

async function loadSleep(database: DatabaseContext, actor: CareActorContext, eventId: string): Promise<SleepIntervalDto | null> {
  const result = await database.pool.query<SleepRow>(
    `select ce.id, ce.occurred_at, ce.status, ce.version, ce.note, si.started_at, si.ended_at
       from care_events ce
       join sleep_intervals si on si.event_id = ce.id
      where ce.id = $1 and ce.family_id = $2 and ce.baby_id = $3
      limit 1`,
    [eventId, actor.familyId, actor.babyId],
  );
  return result.rows[0] ? toDto(result.rows[0]) : null;
}

async function openSleeps(database: DatabaseContext, actor: CareActorContext): Promise<SleepRow[]> {
  const result = await database.pool.query<SleepRow>(
    `select ce.id, ce.occurred_at, ce.status, ce.version, ce.note, si.started_at, si.ended_at
       from care_events ce
       join sleep_intervals si on si.event_id = ce.id
      where ce.family_id = $1 and ce.baby_id = $2 and ce.status = 'active'
        and ce.event_type = 'sleep' and si.ended_at is null
      order by si.started_at desc, ce.created_at desc`,
    [actor.familyId, actor.babyId],
  );
  return result.rows;
}

function timeWarnings(occurredAt: Date, now: Date): CareWarning[] {
  const result = validateOccurredAt(occurredAt, now);
  if (!result.ok) throw new CareValidationError('The care time is too far in the future.');
  return result.warning === 'old_backfill'
    ? [{ code: 'old_backfill', summary: 'This record is more than 24 hours old.' }]
    : [];
}

function requireConfirmed(warnings: CareWarning[], confirmedWarnings: readonly string[] | undefined): void {
  const confirmed = new Set(confirmedWarnings ?? []);
  const pending = warnings.filter((warning) => !confirmed.has(warning.code));
  if (pending.length > 0) throw new CareConfirmationRequiredError(pending);
}

export function createSleepService(database: DatabaseContext, now: () => Date = () => new Date()) {
  return {
    async start(actor: CareActorContext, input: StartSleepInput, traceId: string): Promise<SleepIntervalDto> {
      const lookup = await database.pool.connect();
      try {
        const existing = await findByClientRequestId(lookup, actor, input.clientRequestId);
        if (existing) {
          const dto = await loadSleep(database, actor, existing.id);
          if (dto) return dto;
        }
      } finally {
        lookup.release();
      }

      const occurredAt = new Date(input.occurredAt);
      const warnings = timeWarnings(occurredAt, now());
      const open = await openSleeps(database, actor);
      if (open.length > 0) {
        warnings.push({
          code: 'sleep_overlap',
          summary: 'Another sleep interval is already open.',
          recentEventId: open[0]!.id,
        });
      }
      requireConfirmed(warnings, input.confirmedWarnings);

      const client = await database.pool.connect();
      try {
        await client.query('begin');
        const event = await createCareEvent(client, {
          actor,
          eventType: 'sleep',
          occurredAt,
          clientRequestId: input.clientRequestId,
          note: input.note ?? null,
          traceId,
        });
        await client.query(
          `insert into sleep_intervals (event_id, started_at) values ($1,$2)
           on conflict (event_id) do nothing`,
          [event.id, occurredAt],
        );
        await client.query('commit');
        const dto = await loadSleep(database, actor, event.id);
        if (!dto) throw new Error('sleep interval was not persisted');
        return dto;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async wake(actor: CareActorContext, input: WakeSleepInput, traceId: string): Promise<SleepIntervalDto> {
      const occurredAt = new Date(input.occurredAt);
      const warnings = timeWarnings(occurredAt, now());
      requireConfirmed(warnings, input.confirmedWarnings);

      const open = await openSleeps(database, actor);
      const current = open[0];
      if (!current) {
        const repeated = await database.pool.query<SleepRow>(
          `select ce.id, ce.occurred_at, ce.status, ce.version, ce.note, si.started_at, si.ended_at
             from care_events ce
             join sleep_intervals si on si.event_id = ce.id
            where ce.family_id = $1 and ce.baby_id = $2 and ce.status = 'active'
              and ce.event_type = 'sleep' and si.ended_at = $3
            order by si.started_at desc limit 1`,
          [actor.familyId, actor.babyId, occurredAt],
        );
        if (repeated.rows[0]) return toDto(repeated.rows[0]);
        throw new CareStateConflictError('There is no open sleep interval to wake.');
      }
      const client = await database.pool.connect();
      try {
        await client.query('begin');
        const lockedEvent = await loadCareEventForUpdate(client, actor, current.id);
        if (!lockedEvent || lockedEvent.status !== 'active' || lockedEvent.eventType !== 'sleep') {
          throw new CareStateConflictError('The sleep interval changed before wake was saved.');
        }
        const interval = await client.query<{ started_at: Date; ended_at: Date | null }>(
          `select started_at, ended_at from sleep_intervals where event_id = $1 for update`,
          [lockedEvent.id],
        );
        const lockedInterval = interval.rows[0];
        if (!lockedInterval) throw new CareStateConflictError('The sleep interval changed before wake was saved.');
        if (lockedInterval.ended_at) {
          if (lockedInterval.ended_at.getTime() !== occurredAt.getTime()) {
            throw new CareStateConflictError('The sleep interval was already completed at another time.');
          }
          const repeated: SleepIntervalDto = {
            id: lockedEvent.id,
            occurredAt: lockedEvent.occurredAt.toISOString(),
            status: 'active',
            startedAt: lockedInterval.started_at.toISOString(),
            endedAt: lockedInterval.ended_at.toISOString(),
            note: lockedEvent.note,
            version: lockedEvent.version,
          };
          await client.query('commit');
          return repeated;
        }
        if (occurredAt.getTime() < lockedInterval.started_at.getTime()) {
          throw new CareStateConflictError('Wake time cannot be earlier than sleep start.');
        }
        const before = {
          eventType: 'sleep' as const,
          startedAt: lockedInterval.started_at.toISOString(),
          endedAt: null,
          ...(lockedEvent.note === null ? {} : { note: lockedEvent.note }),
        };
        await client.query(
          `update sleep_intervals set ended_at = $2 where event_id = $1 and ended_at is null`,
          [lockedEvent.id, occurredAt],
        );
        await client.query(
          `update care_events set updated_at = $2, version = version + 1 where id = $1`,
          [lockedEvent.id, now()],
        );
        await appendCareRevision(client, {
          eventId: lockedEvent.id,
          actor,
          action: 'edit',
          fromVersion: lockedEvent.version,
          toVersion: lockedEvent.version + 1,
          before,
          after: {
            eventType: 'sleep',
            startedAt: lockedInterval.started_at.toISOString(),
            endedAt: occurredAt.toISOString(),
            ...(lockedEvent.note === null ? {} : { note: lockedEvent.note }),
          },
          traceId,
        });
        const completed: SleepIntervalDto = {
          id: lockedEvent.id,
          occurredAt: lockedEvent.occurredAt.toISOString(),
          status: 'active',
          startedAt: lockedInterval.started_at.toISOString(),
          endedAt: occurredAt.toISOString(),
          note: lockedEvent.note,
          version: lockedEvent.version + 1,
        };
        await client.query('commit');
        return completed;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

export type SleepService = ReturnType<typeof createSleepService>;
