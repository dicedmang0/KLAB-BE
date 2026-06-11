import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { BookingStatus } from '../entities/booking.entity';

export class ListBookingsDto {
  @IsOptional()
  @IsUUID()
  schedule_id?: string;

  @IsOptional()
  @IsUUID()
  member_id?: string;

  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;
}
