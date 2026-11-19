import { ConfigService } from '@nestjs/config';

/** Managed schools use requests by default; legacy SMTP registration remains independent. */
export function approvalRegistrationEnabled(config: ConfigService): boolean {
  return config.get<boolean>('feature.managedAccountsEnabled', false) === true &&
    config.get<boolean>('feature.approvalRegistrationEnabled', true) === true;
}
