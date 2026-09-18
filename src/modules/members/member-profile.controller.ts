import { Controller, Get, Request } from '@nestjs/common';
import { MembersService } from './members.service';
import { CreditsService } from '../credits/credits.service';
import { SoftLaunchService } from '../soft-launch/soft-launch.service';
import { Permissions } from '../../common/decorators/permissions.decorator';

@Controller('member')
export class MemberProfileController {
  constructor(
    private readonly membersService: MembersService,
    private readonly creditsService: CreditsService,
    private readonly softLaunchService: SoftLaunchService,
  ) {}

  /**
   * The authenticated member's own safe profile. Never exposes password_hash, notes,
   * or the linked user object. Permission verified against the member role's
   * `users:read_own` assignment.
   */
  @Get('me')
  @Permissions('users:read_own')
  async getMe(@Request() req: any) {
    const profile = await this.membersService.findMemberProfile(req.user.id);
    return { ...profile, soft_launch: await this.softLaunchService.viewFor(req.user.id) };
  }

  /**
   * The authenticated member's credit balance and recent ledger history.
   * Returns credit_balance + last 50 entries newest-first. Strips the internal
   * `created_by` admin user ID. Permission: `payments:read_own` (member role).
   */
  @Get('credits')
  @Permissions('payments:read_own')
  async getCredits(@Request() req: any) {
    const member = await this.membersService.findByUserId(req.user.id);
    if (!member) return { credit_balance: 0, ledger: [] };
    const ledger = await this.creditsService.findRecentLedger(member.id);
    return { credit_balance: member.credit_balance, ledger };
  }
}
