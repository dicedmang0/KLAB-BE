import { IsEmail, IsUUID, ValidateIf } from 'class-validator';

/**
 * Admin allocation target. `user_id` is canonical (eligibility is keyed to
 * users.id, which exists before any members row); `email` is an alternative
 * lookup. Exactly one is required.
 */
export class AllocateParticipantDto {
  @ValidateIf((o) => !o.email)
  @IsUUID()
  user_id?: string;

  @ValidateIf((o) => !o.user_id)
  @IsEmail()
  email?: string;
}
