import { PrismaClient } from '../src/database/client';
import { hashPassword } from '../src/shared/utils/hash.util';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { RegisterDto } from '../src/modules/auth/dto/register.dto';
import { importLearning } from '../prisma/import-learning';

// Explicit operator-only process. No default credentials; never promotes an existing account.
export async function bootstrapAdministrator(
  prisma: PrismaClient,
  environment: NodeJS.ProcessEnv = process.env,
) {
  if (environment.ALLOW_INITIAL_ADMIN_BOOTSTRAP !== 'true')
    throw new Error('Explicit initial bootstrap opt-in is required');
  const dto = plainToInstance(RegisterDto, {
    email: environment.BOOTSTRAP_ADMIN_EMAIL,
    password: environment.BOOTSTRAP_ADMIN_PASSWORD,
    firstName: environment.BOOTSTRAP_ADMIN_FIRST_NAME || 'System',
    lastName: environment.BOOTSTRAP_ADMIN_LAST_NAME || 'Administrator',
  });
  if ((await validate(dto)).length) throw new Error('Bootstrap credentials failed validation');
  const attested = environment.BOOTSTRAP_ADMIN_VERIFIED === 'true';
  return prisma.$transaction(async (tx) => {
      await tx.authorizationState.update({
        where: { id: 'default' },
        data: { version: { increment: 1 } },
      });
      const role = await tx.role.findUniqueOrThrow({ where: { name: 'superadmin' } });
      if (!role.is_active || role.status !== 'ACTIVE' || role.group !== 'MANAGER')
        throw new Error('The active system administrator role is required');
      // Lock the role so concurrent bootstrap requests cannot create two initial accounts.
      await tx.role.update({ where: { id: role.id }, data: { updated_at: new Date() } });
      const recovery = (await tx.user.count({ where: { OR: [
        { role_id: role.id }, { role_assignments: { some: { role_id: role.id } } },
      ] } })) > 0;
      const reason = environment.BOOTSTRAP_RECOVERY_REASON?.trim();
      if (
        recovery &&
        (environment.ALLOW_ADMIN_RECOVERY !== 'true' ||
          !reason ||
          reason.length < 20 ||
          reason.length > 1000)
      )
        throw new Error(
          'Existing administrator: protected recovery opt-in and documented reason required',
        );
      const user = await tx.user.create({
        data: {
          email: dto.email,
          password_hash: await hashPassword(dto.password),
          first_name: dto.firstName,
          last_name: dto.lastName,
          role_id: role.id,
          is_email_verified: attested,
          rbac_migrated: true,
          role_assignments: { create: { role_id: role.id } },
        },
      });
      await tx.auditLog.create({
        data: {
          action: recovery ? 'user.bootstrap_recovery' : 'user.bootstrap',
          resource: 'identity',
          user_id: user.id,
          resource_id: user.id,
          new_data: {
            verificationMethod: attested ? 'operator-attested' : 'email-pending',
            ...(recovery ? { reason } : {}),
          },
        },
      });
      return { id: user.id, verified: attested };
  });
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await bootstrapAdministrator(prisma);
    console.log(result.verified
      ? 'Initial administrator created with explicit operator identity attestation.'
      : 'Initial administrator created. Verify its email through the normal workflow.');
    if (process.env.BOOTSTRAP_IMPORT_CATALOG === 'true') {
      try {
        const imported = await importLearning(prisma, result.id);
        console.log(`Approved learning catalog initialized: ${imported.sourceCourses} courses, ${imported.sourceLessons} lessons.`);
      } catch {
        // Account creation is already committed. Report that fact so an operator
        // retries only the content import rather than attempting another admin.
        console.error('Administrator creation succeeded; learning catalog import failed and was rolled back.');
        console.error(`Retry content only: npm run db:content -- ${result.id}`);
        process.exitCode = 1;
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}
if (require.main === module) main().catch(() => {
  console.error(
    'Administrator bootstrap failed. Check opt-in, validation, database seed and existing administrators. No credentials logged.',
  );
  process.exitCode = 1;
});
