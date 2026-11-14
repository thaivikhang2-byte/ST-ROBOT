// Read only the explicitly whitelisted disposable database; never reset a database.
require('../test/setup-env.cjs');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const target = path.resolve(__dirname, '../prisma/migrations/20261025000100_dynamic_authorization');
if (fs.existsSync(target)) throw new Error('Migration already exists');
const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'diff', '--from-url', process.env.DATABASE_URL, '--to-schema-datamodel', 'prisma/schema.prisma', '--script'], { encoding: 'utf8', env: process.env });
if (result.status !== 0) throw new Error('Schema diff failed; inspect schema validation without logging connection arguments');
fs.mkdirSync(target);
fs.writeFileSync(path.join(target, 'migration.sql'), result.stdout + `
-- Preserve the legacy role relationship while making migrated assignments authoritative.
UPDATE "roles" SET "group" = CASE WHEN "name" IN ('admin','superadmin') THEN 'MANAGER'::"RoleGroup" WHEN "name"='teacher' THEN 'TEACHER'::"RoleGroup" ELSE 'STUDENT'::"RoleGroup" END;
INSERT INTO "authorization_state" ("id","version") VALUES ('default',1);
INSERT INTO "user_role_assignments" ("id","user_id","role_id","scope_type","scope_id","created_at")
 SELECT gen_random_uuid(),"id","role_id",'SYSTEM','',CURRENT_TIMESTAMP FROM "users";
UPDATE "users" SET "rbac_migrated"=true;
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "assignment_scope_valid" CHECK (("scope_type"='SYSTEM' AND "scope_id"='') OR ("scope_type"<>'SYSTEM' AND "scope_id" ~* '^[a-f0-9-]{36}$'));
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_threshold_valid" CHECK ("required_approvals" BETWEEN 1 AND 2 AND "approval_count" BETWEEN 0 AND 2);
CREATE UNIQUE INDEX "active_assignment_unique" ON "user_role_assignments"("user_id","role_id","scope_type","scope_id") WHERE "revoked_at" IS NULL;
`);
console.log('Created additive Phase 9 migration with legacy assignment backfill');
