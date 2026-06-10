import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { ScheduleStatus } from '../entities/schedule.entity';

export class UpdateScheduleDto {
  @IsOptional()
  @IsUUID()
  class_type_id?: string;

  @IsOptional()
  @IsUUID()
  instructor_id?: string;

  @IsOptional()
  @IsUUID()
  room_id?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  start_time?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  end_time?: Date;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;

  @IsOptional()
  @IsEnum(ScheduleStatus)
  status?: ScheduleStatus;

  @IsOptional()
  @IsBoolean()
  is_published?: boolean;

  @IsOptional()
  @IsString()
  recurrence_rule?: string;
}
