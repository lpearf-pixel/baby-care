import { CareTimelineQuerySchema } from '@baby-care/contracts';
import { z } from 'zod';

import type { CareActorContext } from '../care/care-auth.js';
import { createQueryService, inReadSnapshot } from '../care/query-service.js';
import type { DatabaseContext } from '../db.js';

const RestoreActorRowSchema = z
  .object({
    family_id: z.string().uuid(),
    baby_id: z.string().uuid(),
    user_id: z.string().uuid(),
    membership_id: z.string().uuid(),
    relationship: z.enum(['dad', 'mom', 'nanny']),
    permission_level: z.enum(['family_admin', 'caregiver']),
    as_of: z.coerce.date(),
  })
  .strict();

const RESTORE_ACTOR_QUERY = `/* restore-verifier-actor-v1 */
select f.id as family_id,
       b.id as baby_id,
       u.id as user_id,
       fm.id as membership_id,
       fm.relationship,
       fm.permission_level,
       statement_timestamp() as as_of
  from families f
  join babies b on b.family_id = f.id and b.status = 'active'
  join family_memberships fm on fm.family_id = f.id and fm.status = 'active'
  join users u on u.id = fm.user_id and u.status = 'active'
 where f.status = 'active'
 order by case fm.relationship when 'dad' then 1 when 'mom' then 2 else 3 end,
          fm.id
 limit 1`;

export class RestoredDatabaseVerifierError extends Error {
  readonly code = 'restore_read_model_failed';

  constructor() {
    super('restore_read_model_failed');
    this.name = 'RestoredDatabaseVerifierError';
  }
}

export async function verifyRestoredDatabase(database: DatabaseContext): Promise<{
  summaryExecutable: true;
  timelineExecutable: true;
}> {
  try {
    return await inReadSnapshot(database, async (client) => {
      const result = await client.query(RESTORE_ACTOR_QUERY);
      if (result.rows.length !== 1) throw new RestoredDatabaseVerifierError();
      const row = RestoreActorRowSchema.parse(result.rows[0]);
      const actor: CareActorContext = {
        familyId: row.family_id,
        babyId: row.baby_id,
        userId: row.user_id,
        membershipId: row.membership_id,
        relationship: row.relationship,
        permissionLevel: row.permission_level,
      };
      const queryService = createQueryService(database);
      await queryService.summary(actor, row.as_of, client);
      await queryService.timeline(
        actor,
        CareTimelineQuerySchema.parse({ category: 'all', limit: 1 }),
        client,
      );
      return { summaryExecutable: true, timelineExecutable: true };
    });
  } catch {
    throw new RestoredDatabaseVerifierError();
  }
}
