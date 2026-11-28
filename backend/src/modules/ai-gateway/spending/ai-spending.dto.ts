import { IsBoolean, IsDateString, IsInt, IsOptional, IsString, IsUUID, Matches, Min } from 'class-validator';

export class AiSpendingDto {
  @IsBoolean() enabled!: boolean;
  @IsBoolean() economyEnabled!: boolean;
  @IsString() @Matches(/^(?:0|[1-9]\d{0,3})(?:\.\d{1,8})?$/) totalBudgetUsd!: string;
  @IsString() @Matches(/^(?:0|[1-9]\d{0,3})(?:\.\d{1,8})?$/) dailyBudgetUsd!: string;
  @IsString() @Matches(/^(?:0|[1-9]\d{0,3})(?:\.\d{1,8})?$/) reserveUsd!: string;
  @IsDateString() startsAt!: string;
  @IsDateString() reserveFrom!: string;
  @IsDateString() endsAt!: string;
  @IsInt() @Min(0) expectedRevision!: number;
  @IsOptional() @IsUUID() modelId?: string;
  @IsOptional() @IsString() @Matches(/^(?:0|[1-9]\d{0,5})(?:\.\d{1,8})?$/) inputPricePerMillion?: string;
  @IsOptional() @IsString() @Matches(/^(?:0|[1-9]\d{0,5})(?:\.\d{1,8})?$/) outputPricePerMillion?: string;
  @IsOptional() @IsBoolean() pricesConfirmed?: boolean;
}
