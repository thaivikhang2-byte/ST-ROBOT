import { Injectable } from '@nestjs/common';
import { PaginationQueryDto, PaginatedResult } from '../../shared/sdk';

@Injectable()
export class SettingsService {
  async findAll(query: PaginationQueryDto): Promise<PaginatedResult<any>> {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  async findById(id: string): Promise<any> {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  async create(data: any): Promise<any> {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  async update(id: string, data: any): Promise<any> {
    // TODO: Implement
    throw new Error('Not implemented');
  }

  async delete(id: string): Promise<any> {
    // TODO: Implement
    throw new Error('Not implemented');
  }
}
