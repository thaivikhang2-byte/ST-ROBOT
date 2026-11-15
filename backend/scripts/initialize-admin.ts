import { PrismaClient } from '../src/database/client';
import { bootstrapInitialAdministrator } from './bootstrap-admin';
import { importLearning } from '../prisma/import-learning';

class CatalogInitializationError extends Error {}

async function assertCatalogRetryOwner(prisma: PrismaClient, id: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id }, include: { role: true, role_assignments: true },
  });
  const now = new Date();
  const activeAssignment = user.role_assignments.some(assignment =>
    assignment.role_id === user.role.id && !assignment.revoked_at &&
    (!assignment.expires_at || assignment.expires_at > now) &&
    assignment.scope_type === 'SYSTEM' && assignment.scope_id === '');
  const audit = await prisma.auditLog.findFirst({
    where: { user_id: id, resource_id: id, action: 'user.bootstrap' },
    select: { new_data: true },
  });
  const attested = audit?.new_data && typeof audit.new_data === 'object' &&
    !Array.isArray(audit.new_data) && audit.new_data.verificationMethod === 'operator-attested';
  if (!user.is_active || user.deleted_at || !user.is_email_verified ||
      user.role.name !== 'superadmin' || !user.role.is_active ||
      user.role.status !== 'ACTIVE' || user.role.group !== 'MANAGER' ||
      !activeAssignment || !attested)
    throw new Error('Catalog retry requires the existing active operator-attested initial administrator.');
}

function clearBootstrapEnvironment(environment: NodeJS.ProcessEnv) {
  for (const key of Object.keys(environment)) {
    if (key.startsWith('INITIAL_ADMIN_') || key.startsWith('BOOTSTRAP_ADMIN_'))
      delete environment[key];
  }
}

/** One-off startup process; credentials never appear in arguments or logs. */
export async function initializeAdministrator(
  prisma: PrismaClient,
  environment: NodeJS.ProcessEnv = process.env,
  dependencies = { bootstrap: bootstrapInitialAdministrator, importCatalog: importLearning,
    retryOwner: assertCatalogRetryOwner, log: (message: string) => console.log(message) },
) {
  const initial = {
    INITIAL_ADMIN_ENABLED: environment.INITIAL_ADMIN_ENABLED,
    INITIAL_ADMIN_EMAIL: environment.INITIAL_ADMIN_EMAIL,
    INITIAL_ADMIN_PASSWORD: environment.INITIAL_ADMIN_PASSWORD,
    INITIAL_ADMIN_CATALOG_RETRY_ID: environment.INITIAL_ADMIN_CATALOG_RETRY_ID,
  };
  clearBootstrapEnvironment(environment);
  try {
    const enabled = initial.INITIAL_ADMIN_ENABLED;
    const retryId = initial.INITIAL_ADMIN_CATALOG_RETRY_ID;
    if (enabled !== undefined && enabled !== 'true' && enabled !== 'false')
      throw new Error('Initial administrator configuration is invalid.');
    if (retryId !== undefined) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(retryId) || enabled === 'true')
        throw new Error('Initial administrator catalog retry configuration is invalid.');
      await dependencies.retryOwner(prisma, retryId);
      const imported = await dependencies.importCatalog(prisma, retryId);
      dependencies.log(`Approved learning catalog initialized: ${imported.sourceCourses} courses, ${imported.sourceLessons} lessons. Remove INITIAL_ADMIN_CATALOG_RETRY_ID from Render Environment.`);
      return { created: false as const };
    }
    if (enabled !== 'true') return { created: false as const };
    const result = await dependencies.bootstrap(prisma, initial);
    if (!result.created) {
      dependencies.log('An administrator already exists; initial setup skipped. No account or role was changed. Remove INITIAL_ADMIN_* from Render Environment.');
      return result;
    }
    dependencies.log('Initial administrator created with explicit operator identity attestation. Remove INITIAL_ADMIN_* from Render Environment.');
    try {
      const imported = await dependencies.importCatalog(prisma, result.id);
      dependencies.log(`Approved learning catalog initialized: ${imported.sourceCourses} courses, ${imported.sourceLessons} lessons.`);
    } catch {
      // The identity transaction committed already. Never retry bootstrap or
      // enable recovery to repair a separate catalog transaction.
      throw new CatalogInitializationError(`Administrator already exists: creation succeeded, but catalog import failed and rolled back. Remove INITIAL_ADMIN_ENABLED, INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD from Render Environment; set INITIAL_ADMIN_CATALOG_RETRY_ID=${result.id} and redeploy to retry content only. Do not rerun bootstrap or enable recovery. Remove the retry variable after success.`);
    }
    return result;
  } catch (error) {
    if (error instanceof CatalogInitializationError) throw error;
    throw new Error('Initial administrator setup or content-only retry failed. Check configuration, credentials, existing administrator eligibility, migrations and seed. No credentials logged.');
  } finally {
    delete initial.INITIAL_ADMIN_EMAIL;
    delete initial.INITIAL_ADMIN_PASSWORD;
    clearBootstrapEnvironment(initial);
    clearBootstrapEnvironment(environment);
  }
}

async function main() {
  let prisma: PrismaClient | undefined;
  try {
    prisma = new PrismaClient();
    await initializeAdministrator(prisma);
  } finally {
    clearBootstrapEnvironment(process.env);
    if (prisma) await prisma.$disconnect();
  }
}

if (require.main === module) main().catch((error: unknown) => {
  // Only our controlled catalog-retry message is safe to expose. Prisma and
  // validation errors can carry user input or connection details.
  if (error instanceof CatalogInitializationError)
    console.error(error.message);
  else console.error('Initial administrator setup failed. Check opt-in, credentials, migrations and seed. API was not started. No credentials logged.');
  process.exitCode = 1;
});
