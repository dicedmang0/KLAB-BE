import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PackageStatus } from '../entities/package.entity';

export class UpdatePackageDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  price_idr?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  credit_amount?: number;

  @IsOptional()
  @IsBoolean()
  is_unlimited?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  validity_days?: number;

  @IsOptional()
  @IsBoolean()
  is_published?: boolean;

  @IsOptional()
  @IsEnum(PackageStatus)
  status?: PackageStatus;
}
