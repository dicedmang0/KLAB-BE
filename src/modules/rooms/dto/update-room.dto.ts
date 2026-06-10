import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { RoomStatus } from '../entities/room.entity';

export class UpdateRoomDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;

  @IsOptional()
  @IsEnum(RoomStatus)
  status?: RoomStatus;
}
