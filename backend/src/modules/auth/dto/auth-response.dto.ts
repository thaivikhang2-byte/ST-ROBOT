import { ApiProperty, getSchemaPath } from '@nestjs/swagger';
import type {
  SchemaObject,
  ReferenceObject,
} from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
export class TokenPairResponseDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty() refreshToken!: string;
  @ApiProperty({ example: '15m' }) expiresIn!: string;
}
export class ProfileResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'email' }) email!: string;
  @ApiProperty() firstName!: string;
  @ApiProperty() lastName!: string;
  @ApiProperty({ nullable: true }) avatarUrl!: string | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() isEmailVerified!: boolean;
  @ApiProperty({
    type: 'object',
    properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' } },
  })
  role!: { id: string; name: string };
  @ApiProperty({ type: [String] }) permissions!: string[];
  @ApiProperty({
    type: 'array',
    description: 'Current explicit grants. Scoped permissions are not automatically global.',
    items: {
      type: 'object',
      properties: {
        roleId: { type: 'string', format: 'uuid' },
        roleName: { type: 'string' },
        group: { type: 'string', enum: ['STUDENT', 'TEACHER', 'MANAGER'] },
        scopeType: { type: 'string', enum: ['SYSTEM', 'COURSE', 'SELF'] },
        scopeId: { type: 'string' },
        permissions: { type: 'array', items: { type: 'string' } },
      },
    },
  })
  roles!: Record<string, unknown>[];
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastLoginAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
}
export class SessionResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt!: Date;
  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Last successful login or refresh',
  })
  lastActivityAt!: Date;
  @ApiProperty({ nullable: true }) deviceInfo!: string | null;
  @ApiProperty() current!: boolean;
}
export function envelope(data: SchemaObject | ReferenceObject): SchemaObject {
  return {
    type: 'object',
    required: ['success', 'message', 'data', 'meta'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      message: { type: 'string' },
      data,
      meta: {
        type: 'object',
        properties: {
          timestamp: { type: 'string', format: 'date-time' },
          path: { type: 'string' },
          method: { type: 'string' },
        },
      },
    },
  };
}
export const profileSchema = envelope({ $ref: getSchemaPath(ProfileResponseDto) });
export const tokensSchema = envelope({
  type: 'object',
  properties: { tokens: { $ref: getSchemaPath(TokenPairResponseDto) } },
});
export const authSchema = envelope({
  type: 'object',
  properties: {
    user: { $ref: getSchemaPath(ProfileResponseDto) },
    tokens: { $ref: getSchemaPath(TokenPairResponseDto) },
  },
});
export const sessionsSchema = envelope({
  type: 'array',
  items: { $ref: getSchemaPath(SessionResponseDto) },
});
export const messageSchema = envelope({
  type: 'object',
  properties: { message: { type: 'string' } },
});
