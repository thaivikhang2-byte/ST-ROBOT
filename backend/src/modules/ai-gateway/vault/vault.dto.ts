import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
export class VaultRevisionDto {
  @ApiProperty() @IsInt() @Min(0) expectedRevision!: number;
}
export class ProviderConfigurationDto extends VaultRevisionDto {
  @ApiProperty({
    type: Object,
    description: 'Strict versioned provider metadata; no credentials/encryption fields',
  })
  @IsObject()
  provider!: Record<string, unknown>;
}
export class CredentialLimitsDto {
  @ApiProperty() @IsInt() @Min(1) @Max(10000) requestsPerMinute!: number;
  @ApiProperty() @IsInt() @Min(0) @Max(1000000000) tokensPerDay!: number;
  @ApiProperty() @IsInt() @Min(1) @Max(100) maxConcurrent!: number;
}
export class CreateCredentialDto extends VaultRevisionDto {
  @ApiPropertyOptional() @IsOptional() @Matches(/^[a-zA-Z0-9_-]{1,64}$/) id?: string;
  @ApiProperty({
    writeOnly: true,
    description: 'TLS admin connection only; encrypted immediately, never returned',
  })
  @IsString()
  @Length(8, 4096)
  @Matches(/^\S+$/)
  apiKey!: string;
  @ApiProperty() @IsBoolean() enabled!: boolean;
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @ArrayUnique()
  @Matches(/^[a-zA-Z0-9_-]{1,64}$/, { each: true })
  endpointIds!: string[];
  @ApiProperty({ type: CredentialLimitsDto })
  @ValidateNested()
  @Type(() => CredentialLimitsDto)
  limits!: CredentialLimitsDto;
}
