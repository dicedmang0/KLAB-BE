import { IsUUID } from 'class-validator';

export class CreateBookingDto {
  @IsUUID()
  schedule_id: string;
}
