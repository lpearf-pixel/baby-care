# Private backup and restore operations

Baby Care backup bundles contain sensitive family and care data. Keep the backup parent
on owner-controlled local storage with mode `0700`. Never put a bundle, dump, export, or
operator environment file in Git, CI artifacts, shared cloud storage, logs, or support
messages.

## Prerequisites

- Node.js 24, pnpm, Docker, and Docker Compose are installed.
- `pnpm --filter @baby-care/operations build` has completed.
- The source PostgreSQL 16 service is the fixed `baby-care` project service `postgres`.
- The backup parent already exists, is owned by the current user, has mode `0700`, and
  has no symlink in its path.
- Choose a UTC bundle selector such as `baby-care-backup-YYYYMMDDTHHMMSSZ`. The create
  command creates exactly that final name and refuses to overwrite it.

Set only these operator variables in the local shell. Values shown here are placeholders,
not deployment settings:

```text
BABY_CARE_BACKUP_PARENT=<owner-private-absolute-directory>
BABY_CARE_BACKUP_BUNDLE=baby-care-backup-YYYYMMDDTHHMMSSZ
BABY_CARE_COMPOSE_PROJECT=baby-care
BABY_CARE_RESTORE_PROJECT=baby-care-restore
BABY_CARE_SOURCE_SERVICE=postgres
BABY_CARE_RESTORE_SERVICE=postgres_restore
BABY_CARE_RESTORE_PROBE_SERVICE=restored_api_probe
```

The CLI accepts no database URL, password, SQL, Compose file override, restore flags,
output override, overwrite, clean, create, role, or schema option.

## Fixed commands

```bash
pnpm backup:create
pnpm backup:verify
pnpm backup:restore
pnpm backup:restore-verify
```

`backup:restore` requires the fixed `baby-care-restore` target services to have been
started separately. It never creates or removes infrastructure. It is intended for an
already isolated, empty PostgreSQL 16 target only.

`backup:restore-verify` is the routine practice command. It creates a fresh randomly
named Compose project and private target volume, waits for PostgreSQL health, invokes
the guarded restore, starts a separate read-only post-restore probe only after Task 6
verification succeeds, and then removes only the resources it created. Failures emit a
stable code without raw subprocess output.

To inspect or clean up the separately managed ordinary-restore target, use the fixed
operations profile explicitly:

```bash
docker compose --profile operations --project-name baby-care-restore --file compose.yaml --file infra/backup/compose.operations.yaml ps --all
docker compose --profile operations --project-name baby-care-restore --file compose.yaml --file infra/backup/compose.operations.yaml down --volumes --remove-orphans
```

The source and restore target must be independent PostgreSQL clusters. In-place restore
is forbidden. The restore path rejects same-cluster identity, non-PostgreSQL-16 targets,
non-empty targets, and targets with migration history before reading the dump.

These commands do not provide automatic retention, automatic deletion, encryption, or
off-site durability. Establish those policies separately without weakening the private
filesystem and verification gates. A successful software practice does not prove a real
household backup is current or recoverable; verify real operational evidence separately.
