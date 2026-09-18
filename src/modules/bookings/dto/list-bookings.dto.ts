import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { BookingSource, BookingStatus } from '../entities/booking.entity';

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

  // e.g. `soft_launch` to list bookings made under the soft-launch bypass.
  @IsOptional()
  @IsEnum(BookingSource)
  source?: BookingSource;
}
