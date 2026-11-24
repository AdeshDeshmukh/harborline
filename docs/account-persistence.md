# Private account persistence — HL-09

## What exists

The first migration, `drizzle/0001_account_foundation.sql`, creates:

- `harborline.profiles`: authenticated identity UUID, timezone, disabled pilot
  flag, unknown eligibility by default, and timestamps.
- `harborline.gateway_accounts`: one mapping per owner, unique external reference,
  unique non-null provider user ID, provisioning state, public signer key,
  wallet-address metadata, policy revision, and a future operation-slot UUID.
- `harborline_private.signer_secrets`: account-bound ciphertext, 12-byte nonce,
  16-byte authentication tag, and encryption-key version. There is no plaintext
  key column. Encryption itself is not implemented in this slice; the byte-length
  constraints do not prove that supplied data was encrypted correctly.

Unique constraints create their own indexes; extra duplicate indexes are not
needed. Foreign keys restrict deletion. `active_operation_id` has no intent FK
yet because intent tables do not exist. Later migrations must establish that
relationship before financial operation slots are used.

The profile identity is not yet an FK into Supabase's `auth.users`: the schema
can be verified on standalone PostgreSQL, and identity integration comes next.
HL-10/11 must validate sessions and establish mappings from verified identity.
The schema alone does not authenticate a UUID. Timezone and wallet-address
semantic validation also belong in the consuming adapters.

## Roles and ownership

The migration creates two restricted **NOLOGIN** group roles:

| Role | Access |
| --- | --- |
| `harborline_app` | Read owned profiles; insert identity/timezone; update timezone; read/insert/update owned account mappings. No eligibility/pilot changes, secret access, DELETE or TRUNCATE grants. |
| `harborline_key_store` | Read only ID/owner columns of owned account mappings and read/insert/update that account's encrypted signer record. No profile grants. |
| PUBLIC / unrelated roles | No grants on either application schema or its tables. |

RLS is enabled and forced on all three tables. A missing owner context returns
no rows. Both USING and WITH CHECK constrain reads and writes. The migration
administrator owns the tables; application roles do not. PostgreSQL superusers
still bypass RLS, which is why they must not be runtime identities.

`createDatabase(url).withOwner(ownerId, callback)` opens one transaction, refuses
superuser/BYPASSRLS/role-creation/database-creation identities and identities with
key-store membership, switches locally to `harborline_app`, and sets
`harborline.owner_id` with a parameterized transaction-local setting. Drizzle
queries in the callback use that transaction. Commit/rollback clears the context;
callback failures roll back and expose only a fixed error plus SQLSTATE when
available, without SQL parameters or driver details.

**Trust boundary:** only trusted server code may supply owner IDs. A database
login can set custom PostgreSQL settings; RLS is defense against missing filters
and cross-owner queries, not proof of user authentication or protection from
compromise of the trusted application. HL-11 must derive the owner from the
verified session. No HTTP endpoint exposes this helper in HL-09.

`getDatabase()` is lazy and requires `APP_MODE=pilot` plus `DATABASE_URL` only
when called. The default demo continues to need no database. The runtime URL
must identify a dedicated least-privilege login that can SET ROLE to
`harborline_app` and has no key-store/admin memberships. A database administrator
must provision that login and secret separately; this migration creates no
login/password. The application does not retain migration credentials. Remote
runtime URLs require `sslmode=verify-full`; local sockets/loopback are supported
for tests. No certificate checks are disabled.

## Generate and apply migrations deliberately

`pnpm db:generate` compares the declared Drizzle schema with its snapshot and
does not connect to a database. The checked-in SQL additionally includes
hand-reviewed schema bootstrap, roles, column grants and FORCE RLS. Preserve
these protections when reviewing later migrations; the ORM snapshot does not
express all of them. Applied migrations must never be edited in place.

The migration journal's first entry points to `0001_account_foundation.sql`.
The runner uses that journal, a dedicated connection and a PostgreSQL advisory
lock to serialize migration attempts. Re-running it skips applied migrations.
The migration includes role DDL and requires an explicitly selected administrator
with the necessary privileges. Existing incompatible role capabilities abort it.

```sh
# Supply the intended administrator URL privately in the shell environment.
pnpm db:migrate --target local
```

The runner reads **only** `MIGRATION_DATABASE_URL`, never the runtime URL or an
automatically loaded `.env` file. It requires `--target local`, `test`, or `pilot`.
Local/test targets reject remote hosts; test additionally requires the database
name `harborline_test`. Remote pilot URLs require certificate-verifying TLS.
A target argument is an operational guard, not user authorization: live pilot
migrations still require explicit approval for the actual environment.

No live database was contacted or migrated during this work. There is no
automatic deployment migration and no destructive down migration. Back up before
an authorized live change; prefer forward corrective migrations once data exists.

## Real PostgreSQL verification

`pnpm test:db` requires both `TEST_DATABASE_URL` and
`TEST_DATABASE_DISPOSABLE=true`. It refuses non-local targets and names other
than `harborline_test`, then resets only the three schemas inside that dedicated
test database. **Never label a persistent database disposable.** Test-role logins
and their synthetic passwords exist only in the test fixture, not migrations.

Local verification uses a newly initialized PostgreSQL 16.15 cluster under `/tmp`
with a private Unix socket, no TCP listener, and no access to an existing database.
For a new local run, initialize a separate cluster before setting the test URL,
or use the isolated PostgreSQL service supplied in CI. The test URL must use
loopback or a socket under `/tmp/harborline-hl09.*`.

With PostgreSQL 16 tools already installed and Node 24 selected, this creates
and stops a disposable socket-only cluster without touching an existing server:

```sh
(
  set -e
  task_pg_dir=$(mktemp -d /tmp/harborline-hl09.XXXXXX)
  mkdir "$task_pg_dir/socket"
  initdb -D "$task_pg_dir/data" -U postgres --auth-local=trust --auth-host=reject
  pg_ctl -D "$task_pg_dir/data" -l "$task_pg_dir/server.log" \
    -o "-k $task_pg_dir/socket -c listen_addresses=''" start
  trap 'pg_ctl -D "$task_pg_dir/data" stop -m fast' EXIT
  createdb -h "$task_pg_dir/socket" -U postgres harborline_test
  TEST_DATABASE_URL="postgresql://postgres@localhost/harborline_test?host=$task_pg_dir/socket" \
    TEST_DATABASE_DISPOSABLE=true pnpm test
)
```

The tests run the real journaled migration and exercise forced RLS, default
values, missing context, two-owner isolation, denied guest/secret/eligibility
access, encryption-storage shape, concurrent owner uniqueness, global reference
uniqueness, runtime-role rejection, transaction rollback and migration reruns.
`pnpm test` runs both existing suites and these database tests; it intentionally
requires the disposable database rather than silently skipping integration tests.

CI adds an official PostgreSQL 16.15 service with ephemeral test credentials and
health checks. Hosted execution remains to be verified when this slice is
published. Supabase-specific roles, pooler behavior, migration privileges and
deployed session handling are not proven by the local PostgreSQL tests.

## Sources and trade-offs

Drizzle 0.45.4 and its matching stable migration tool are pinned. The current v1
docs describe newer APIs; this code uses the APIs present in the installed stable
packages. A separate key-store role reduces accidental secret exposure, at the
cost of an additional controlled credential path in later signer work. Using
transaction-local owner context keeps queries composable but trusts server identity
resolution. Neither choice enables customer rollout before the existing live gates.

[PostgreSQL RLS](https://www.postgresql.org/docs/16/ddl-rowsecurity.html),
[column grants](https://www.postgresql.org/docs/16/sql-grant.html),
[Drizzle PostgreSQL](https://orm.drizzle.team/docs/get-started-postgresql), and
[migration generation](https://orm.drizzle.team/docs/drizzle-kit-generate).
