// ═══════════════════════════════════════════
// Config — Config Module
// ═══════════════════════════════════════════

import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { envValidationSchema } from './env.validation';
import {
  appConfig,
  loggingConfig,
  operationsConfig,
  databaseConfig,
  redisConfig,
  jwtConfig,
  mailConfig,
  cdnConfig,
  aiConfig,
  uploadConfig,
  featureConfig,
  throttleConfig,
  retentionConfig,
  storageConfig,
  aiVaultConfig,
  videoConfig,
} from './configurations';

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        `.env.${process.env.NODE_ENV || 'development'}`,
        '.env',
        `../.env.${process.env.NODE_ENV || 'development'}`,
        '../.env',
      ],
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false,
        allowUnknown: true,
      },
      load: [
        appConfig,
        loggingConfig,
        operationsConfig,
        databaseConfig,
        redisConfig,
        jwtConfig,
        mailConfig,
        cdnConfig,
        aiConfig,
        uploadConfig,
        featureConfig,
        throttleConfig,
        retentionConfig,
        storageConfig,
        aiVaultConfig,
        videoConfig,
      ],
    }),
  ],
})
export class AppConfigModule {}
