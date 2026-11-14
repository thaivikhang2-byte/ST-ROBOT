import { PrismaClient as GeneratedClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/** PostgreSQL runtime adapter; credentials come only from the process environment. */
export class PrismaClient extends GeneratedClient {
  constructor(options: Prisma.PrismaClientOptions = {}) {
    const { datasourceUrl, datasources, ...rest } = options;
    const connectionString = datasourceUrl || datasources?.db?.url || process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required');
    super({ ...rest, adapter: options.adapter || new PrismaPg({ connectionString }) });
  }
}
