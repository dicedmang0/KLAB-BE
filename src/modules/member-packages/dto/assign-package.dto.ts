import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class AssignPackageDto {
  // The package to grant. Credits / validity are derived from the package itself.
  @IsUUID()
  package_id: string;

  // Optional note recorded on the credit_ledger entry for the grant.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
