import { Controller, Get, Post, Delete, Param, Request } from '@nestjs/common';
import { WaitlistService } from './waitlist.service';
import { Permissions } from '../../common/decorators/permissions.decorator';

@Controller('member')
export class MemberWaitlistController {
  constructor(private readonly waitlistService: WaitlistService) {}

  /**
   * Join the waitlist for a full schedule. Returns 400 if the schedule still has
   * open slots (book directly instead) and 409 if the member is already active
   * (booked or waitlisted) on this schedule.
   */
  @Post('schedules/:scheduleId/waitlist')
  @Permissions('bookings:create')
  join(@Param('scheduleId') scheduleId: string, @Request() req: any) {
    return this.waitlistService.joinWaitlist(req.user.id, scheduleId);
  }

  @Get('waitlist')
  @Permissions('bookings:read_own')
  list(@Request() req: any) {
    return this.waitlistService.findOwnWaitlist(req.user.id);
  }

  @Delete('waitlist/:id')
  @Permissions('bookings:cancel_own')
  leave(@Param('id') id: string, @Request() req: any) {
    return this.waitlistService.leaveWaitlist(req.user.id, id);
  }
}
