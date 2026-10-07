import { IsUUID } from 'class-validator';

export class AdminCreateBookingDto {
  @IsUUID()
  member_id: string;

  @IsUUID()
  schedule_id: string;
}
