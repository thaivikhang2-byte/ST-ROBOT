// ═══════════════════════════════════════════
// Internal SDK — Barrel Export
// Import everything from '@sdk/*' or this file
// ═══════════════════════════════════════════

// ── Logger ────────────────────────────────
export { AppLoggerService } from './logger/logger.service';
export { LoggerModule } from './logger/logger.module';

// ── Errors ────────────────────────────────
export { BaseException } from './errors/base.exception';
export { ApplicationException } from './errors/application.exception';
export {
  DomainException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from './errors/domain.exception';
export { ValidationException } from './errors/validation.exception';
export type { ValidationDetail } from './errors/validation.exception';
export {
  InfrastructureException,
  DatabaseException,
  RedisException,
  CdnException,
} from './errors/infrastructure.exception';
export { ErrorCode } from './errors/error-codes.enum';
export { GlobalExceptionFilter } from './errors/filters/global-exception.filter';
export { PrismaExceptionFilter } from './errors/filters/prisma-exception.filter';

// ── Events ────────────────────────────────
export { EventBusService } from './events/event-bus.service';
export { EventBusModule } from './events/event-bus.module';
export { BaseDomainEvent } from './events/base.event';
export type { IDomainEvent } from './events/interfaces/domain-event.interface';

// ── Response ──────────────────────────────
export { ApiResponse } from './response/api-response.dto';
export type { ResponseMeta, PaginationMeta, SortMeta } from './response/api-response.dto';
export { TransformInterceptor } from './response/transform.interceptor';

// ── Pagination ────────────────────────────
export { PaginationQueryDto } from './pagination/pagination-query.dto';
export { PaginatedResult } from './pagination/paginated-result.dto';
export { buildPrismaQuery } from './pagination/pagination.helper';

// ── Repository ────────────────────────────
export { BaseRepository } from './repository/base.repository';
export type { IRepository, ISoftDeletableRepository } from './repository/interfaces/repository.interface';

// ── Cache ─────────────────────────────────
export { CacheService, CACHE_STORE } from './cache/cache.service';
export { CacheModule } from './cache/cache.module';
export { CacheInterceptor } from './cache/cache.interceptor';
export { Cacheable } from './cache/decorators/cacheable.decorator';
export type { ICacheStore } from './cache/interfaces/cache-store.interface';

// ── Auth ──────────────────────────────────
export { CurrentUser } from './auth/decorators/current-user.decorator';
export { Roles, ROLES_KEY } from './auth/decorators/roles.decorator';
export { Permissions, PERMISSIONS_KEY } from './auth/decorators/permissions.decorator';
export { Public, IS_PUBLIC_KEY } from './auth/decorators/public.decorator';
export { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
export { RolesGuard } from './auth/guards/roles.guard';
export { PermissionsGuard } from './auth/guards/permissions.guard';
export type { RequestUser } from './auth/interfaces/request-user.interface';

// ── Policy ────────────────────────────────
export type { IPolicy } from './policy/policy.interface';
export { BasePolicy } from './policy/base.policy';
export { UsePolicy, POLICY_KEY } from './policy/policy.decorator';
export { PolicyGuard } from './policy/policy.guard';

// ── Idempotency ───────────────────────────
export { IdempotencyService } from './idempotency/idempotency.service';
export { IdempotencyInterceptor } from './idempotency/idempotency.interceptor';
export { IdempotencyModule } from './idempotency/idempotency.module';
export { Idempotent } from './idempotency/decorators/idempotent.decorator';

// ── Soft Delete ───────────────────────────
export {
  SOFT_DELETE_FILTER,
  isSoftDeleted,
  SOFT_DELETABLE_MODELS,
} from './soft-delete/soft-delete.interface';
export type { ISoftDeletable, SoftDeletableModel } from './soft-delete/soft-delete.interface';

// ── Lock ──────────────────────────────────
export { LockService } from './lock/lock.service';
export { LockModule } from './lock/lock.module';
export { WithLock } from './lock/decorators/with-lock.decorator';

// ── Secrets ───────────────────────────────
export { SecretsService } from './secrets/secrets.service';
export { SecretsModule } from './secrets/secrets.module';
export type { ISecretsProvider } from './secrets/providers/secrets-provider.interface';

// ── Deprecation ───────────────────────────
export { DeprecatedApi } from './deprecation/decorators/deprecated-api.decorator';
export { DeprecationInterceptor } from './deprecation/deprecation.interceptor';

// ── Retention ─────────────────────────────
export { RetentionService } from './retention/retention.service';
export { RetentionModule } from './retention/retention.module';
export type { IRetentionPolicy } from './retention/interfaces/retention-policy.interface';

// ── Storage ───────────────────────────────
export type {
  IStorageProvider,
  StorageUploadResult,
  StorageObjectMeta,
} from './storage/interfaces/storage-provider.interface';
export {
  MIME_TYPES,
  IMAGE_MIME_TYPES,
  VIDEO_MIME_TYPES,
  DOCUMENT_MIME_TYPES,
  ALLOWED_UPLOAD_TYPES,
} from './storage/constants/mime-types.constant';
