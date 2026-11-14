import 'dotenv/config';
import { defineConfig } from 'prisma/config';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL || 'postgresql://build:build@localhost:5432/build';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'ts-node prisma/seed.ts' },
  experimental: { adapter: true },
  // Generation uses the stable JS query compiler, without native runtime binaries.
  // Production migrations retain Prisma's classic migration engine. The optional
  // portable mode lets isolated CI tests run the same SQL with the WASM migrator.
  ...(process.env.PRISMA_PORTABLE_CLI === 'true'
    ? { engine: 'js' as const, adapter: async () => new PrismaPg({ connectionString }) }
    : { engine: 'classic' as const, datasource: { url: connectionString } }),
});
