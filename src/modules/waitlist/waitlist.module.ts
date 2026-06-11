import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from '../bookings/entities/booking.entity';
import { Schedule } from '../schedules/entities/schedule.entity';
import { WaitlistService } from './waitlist.service';
import { MemberWaitlistController } from './member-waitlist.controller';
import { AdminWaitlistController } from './admin-waitlist.controller';
import { CreditsModule } from '../credits/credits.module';
import { MembersModule } from '../members/members.module';

/**
 * Waitlist sits on top of the existing bookings table (a waitlist entry is a
 * Booking with status='waitlisted'). It reuses CreditsService for promotion
 * debits and MembersService for member resolution, and registers Booking +
 * Schedule repositories for its own reads. BookingsService is intentionally left
 * untouched — no regression to the normal booking/cancellation flows.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Booking, Schedule]), CreditsModule, MembersModule],
  controllers: [MemberWaitlistController, AdminWaitlistController],
  providers: [WaitlistService],
  exports: [WaitlistService],
})
export class WaitlistModule {}
