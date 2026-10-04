import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from '../bookings/entities/booking.entity';
import { Schedule } from '../schedules/entities/schedule.entity';
import { WaitlistService } from './waitlist.service';
import { MemberWaitlistController } from './member-waitlist.controller';
import { AdminWaitlistController } from './admin-waitlist.controller';
import { BookingsModule } from '../bookings/bookings.module';
import { MembersModule } from '../members/members.module';
import { SoftLaunchModule } from '../soft-launch/soft-launch.module';

/**
 * Waitlist sits on top of the existing bookings table (a waitlist entry is a
 * Booking with status='waitlisted'). Promotion rules live in
 * WaitlistPromotionService (exported by BookingsModule) so the admin promote
 * endpoint and automatic fill after a confirmed cancellation share one
 * implementation. MembersService resolves members; Booking + Schedule
 * repositories serve reads.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, Schedule]),
    BookingsModule,
    MembersModule,
    SoftLaunchModule,
  ],
  controllers: [MemberWaitlistController, AdminWaitlistController],
  providers: [WaitlistService],
  exports: [WaitlistService],
})
export class WaitlistModule {}
