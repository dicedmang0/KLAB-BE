import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { MemberPackageStatus } from '../entities/member-package.entity';

export class ListMemberPackagesDto {
  @IsOptional()
  @IsUUID()
  member_id?: string;

  @IsOptional()
  @IsEnum(MemberPackageStatus)
  status?: MemberPackageStatus;
}
