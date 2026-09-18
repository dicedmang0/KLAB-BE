import { Controller, Get, Post, Body, Request } from '@nestjs/common';
import { SoftLaunchService } from './soft-launch.service';
import { AllocateParticipantDto } from './dto/allocate-participant.dto';
import { Permissions } from '../../common/decorators/permissions.decorator';

@Controller('admin/soft-launch')
export class AdminSoftLaunchController {
  constructor(private readonly softLaunchService: SoftLaunchService) {}

  /** Quota summary + every participant (code, user, member if any, bookings count). */
  @Get('participants')
  @Permissions('members:read')
  list() {
    return this.softLaunchService.listForAdmin();
  }

  /**
   * Allocate a slot to an existing account by `user_id` (canonical) or `email`.
   * Idempotent: an already-allocated user returns their existing row (200).
   * 404 unknown user, 409 quota full / allocation period closed.
   */
  @Post('participants')
  @Permissions('members:update')
  allocate(@Body() dto: AllocateParticipantDto, @Request() req: any) {
    return this.softLaunchService.allocateByAdmin(dto, req.user.id);
  }
}
