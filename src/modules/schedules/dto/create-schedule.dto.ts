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

export class CreateScheduleDto {
  @IsUUID()
  class_type_id: string;

  @IsUUID()
  instructor_id: string;

  @IsUUID()
  room_id: string;

  @Type(() => Date)
  @IsDate()
  start_time: Date;

  @Type(() => Date)
  @IsDate()
  end_time: Date;

  @IsInt()
  @Min(1)
  capacity: number;

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
