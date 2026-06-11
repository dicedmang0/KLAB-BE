import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { MemberStatus } from '../entities/member.entity';

export class ListMembersDto {
  @IsOptional()
  @IsEnum(MemberStatus)
  status?: MemberStatus;

  // Case-insensitive search across the linked user's email/full_name and the
  // member's phone.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;
}
