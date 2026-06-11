import { Controller, Get, Post, Param } from '@nestjs/common';
import { WaitlistService } from './waitlist.service';
import { Permissions } from '../../common/decorators/permissions.decorator';

@Controller('admin')
export class AdminWaitlistController {
  constructor(private readonly waitlistService: WaitlistService) {}

  /** The waitlist queue for a schedule, ordered by position. 404 if no such schedule. */
  @Get('schedules/:id/waitlist')
  @Permissions('bookings:read_all')
  scheduleWaitlist(@Param('id') id: string) {
    return this.waitlistService.findScheduleWaitlist(id);
  }

  /**
   * Promote a waitlisted entry to a confirmed booking (debits credit). Returns
   * 409 if the schedule is full, 400 if the member lacks credit.
   */
  @Post('waitlist/:id/promote')
  @Permissions('bookings:update')
  promote(@Param('id') id: string) {
    return this.waitlistService.promote(id);
  }
}
