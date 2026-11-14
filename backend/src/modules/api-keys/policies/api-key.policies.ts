import { Injectable } from '@nestjs/common';
import { BasePolicy } from '../../../shared/sdk/policy/base.policy';
import { RequestUser } from '../../../shared/sdk/auth/interfaces/request-user.interface';

/**
 * Only the API key owner or admin can manage the key.
 */
@Injectable()
export class ApiKeyOwnerPolicy extends BasePolicy {
  async validate(user: RequestUser, context: any): Promise<boolean> {
    if (this.isAdmin(user)) return true;

    // TODO: Fetch API key and check ownership
    return false;
  }
}
