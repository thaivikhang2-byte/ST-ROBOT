import { PrismaClient } from '../src/database/client';
import { hashPassword } from '../src/shared/utils/hash.util';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { RegisterDto } from '../src/modules/auth/dto/register.dto';

// Explicit operator-only process. No default credentials; never promotes an existing account.
async function bootstrap() {
  if (process.env.ALLOW_INITIAL_ADMIN_BOOTSTRAP !== 'true')
    throw new Error('Explicit initial bootstrap opt-in is required');
  const dto = plainToInstance(RegisterDto, {
    email: process.env.BOOTSTRAP_ADMIN_EMAIL,
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
    firstName: process.env.BOOTSTRAP_ADMIN_FIRST_NAME || 'System',
    lastName: process.env.BOOTSTRAP_ADMIN_LAST_NAME || 'Administrator',
  });
  if ((await validate(dto)).length) throw new Error('Bootstrap credentials failed validation');
  const prisma = new PrismaClient();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.authorizationState.update({
        where: { id: 'default' },
        data: { version: { increment: 1 } },
      });
      const role = await tx.role.findUniqueOrThrow({ where: { name: 'superadmin' } });
      // Lock the role so concurrent bootstrap requests cannot create two initial accounts.
      await tx.role.update({ where: { id: role.id }, data: { updated_at: new Date() } });
      const recovery = (await tx.user.count({ where: { role_id: role.id } })) > 0;
      const reason = process.env.BOOTSTRAP_RECOVERY_REASON?.trim();
      if (
        recovery &&
        (process.env.ALLOW_ADMIN_RECOVERY !== 'true' ||
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
          is_email_verified: false,
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
          ...(recovery ? { new_data: { reason } } : {}),
        },
      });
    });
    console.log('Initial administrator created. Verify its email through the normal workflow.');
  } finally {
    await prisma.$disconnect();
  }
}
bootstrap().catch(() => {
  console.error(
    'Administrator bootstrap failed. Check opt-in, validation, database seed and existing administrators. No credentials logged.',
  );
  process.exitCode = 1;
});
