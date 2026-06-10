import { IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { ClassTypeStatus } from '../entities/class-type.entity';

export class CreateClassTypeDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  level?: string;

  @IsInt()
  @Min(1)
  duration_minutes: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsInt()
  @Min(1)
  default_capacity: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  default_price_idr?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  credit_cost?: number;

  @IsOptional()
  @IsString()
  image_url?: string;

  @IsOptional()
  @IsBoolean()
  is_published?: boolean;

  @IsOptional()
  @IsEnum(ClassTypeStatus)
  status?: ClassTypeStatus;
}
