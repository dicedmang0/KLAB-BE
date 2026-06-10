import { IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { PackageStatus } from '../entities/package.entity';

export class CreatePackageDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsInt()
  @Min(0)
  price_idr: number;

  @IsInt()
  @Min(0)
  credit_amount: number;

  @IsBoolean()
  is_unlimited: boolean;

  @IsInt()
  @Min(1)
  validity_days: number;

  @IsOptional()
  @IsBoolean()
  is_published?: boolean;

  @IsOptional()
  @IsEnum(PackageStatus)
  status?: PackageStatus;
}
