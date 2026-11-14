-- CreateEnum
CREATE TYPE "RoleGroup" AS ENUM ('STUDENT', 'TEACHER', 'MANAGER');

-- CreateEnum
CREATE TYPE "RoleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DISABLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AuthorizationScope" AS ENUM ('SYSTEM', 'SELF', 'COURSE');

-- CreateEnum
CREATE TYPE "ApprovalType" AS ENUM ('TEACHER_APPLICATION', 'MANAGER_APPOINTMENT', 'ROLE_CHANGE', 'COURSE_ENROLLMENT');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'PARTIALLY_APPROVED', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "enrollment_approval_required" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "group" "RoleGroup" NOT NULL DEFAULT 'STUDENT',
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "scope_type" "AuthorizationScope" NOT NULL DEFAULT 'SYSTEM',
ADD COLUMN     "status" "RoleStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "rbac_migrated" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "authorization_state" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "authorization_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_role_assignments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "assigned_by" UUID,
    "scope_type" "AuthorizationScope" NOT NULL DEFAULT 'SYSTEM',
    "scope_id" VARCHAR(36) NOT NULL DEFAULT '',
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_delegation_policies" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "scope_type" "AuthorizationScope" NOT NULL,
    "scope_id" VARCHAR(36) NOT NULL DEFAULT '',
    "allowed_groups" "RoleGroup"[],
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_delegation_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" UUID NOT NULL,
    "type" "ApprovalType" NOT NULL,
    "requester_id" UUID NOT NULL,
    "beneficiary_id" UUID NOT NULL,
    "proposed" JSONB NOT NULL,
    "required_approvals" INTEGER NOT NULL,
    "approval_count" INTEGER NOT NULL DEFAULT 0,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "scope_type" "AuthorizationScope" NOT NULL DEFAULT 'SYSTEM',
    "scope_id" VARCHAR(36) NOT NULL DEFAULT '',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_decisions" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "approver_id" UUID NOT NULL,
    "approved" BOOLEAN NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_role_assignments_user_id_revoked_at_expires_at_idx" ON "user_role_assignments"("user_id", "revoked_at", "expires_at");

-- CreateIndex
CREATE INDEX "user_role_assignments_scope_type_scope_id_idx" ON "user_role_assignments"("scope_type", "scope_id");

-- CreateIndex
CREATE INDEX "role_delegation_policies_user_id_revoked_at_idx" ON "role_delegation_policies"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "approval_requests_status_type_created_at_idx" ON "approval_requests"("status", "type", "created_at");

-- CreateIndex
CREATE INDEX "approval_requests_beneficiary_id_idx" ON "approval_requests"("beneficiary_id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_decisions_request_id_approver_id_key" ON "approval_decisions"("request_id", "approver_id");

-- AddForeignKey
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_delegation_policies" ADD CONSTRAINT "role_delegation_policies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_delegation_policies" ADD CONSTRAINT "role_delegation_policies_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_beneficiary_id_fkey" FOREIGN KEY ("beneficiary_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Preserve the legacy role relationship while making migrated assignments authoritative.
UPDATE "roles" SET "group" = CASE WHEN "name" IN ('admin','superadmin') THEN 'MANAGER'::"RoleGroup" WHEN "name"='teacher' THEN 'TEACHER'::"RoleGroup" ELSE 'STUDENT'::"RoleGroup" END;
INSERT INTO "authorization_state" ("id","version") VALUES ('default',1);
INSERT INTO "user_role_assignments" ("id","user_id","role_id","scope_type","scope_id","created_at")
 SELECT gen_random_uuid(),"id","role_id",'SYSTEM','',CURRENT_TIMESTAMP FROM "users";
UPDATE "users" SET "rbac_migrated"=true;
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "assignment_scope_valid" CHECK (("scope_type"='SYSTEM' AND "scope_id"='') OR ("scope_type"<>'SYSTEM' AND "scope_id" ~* '^[a-f0-9-]{36}$'));
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_threshold_valid" CHECK ("required_approvals" BETWEEN 1 AND 2 AND "approval_count" BETWEEN 0 AND 2);
CREATE UNIQUE INDEX "active_assignment_unique" ON "user_role_assignments"("user_id","role_id","scope_type","scope_id") WHERE "revoked_at" IS NULL;
