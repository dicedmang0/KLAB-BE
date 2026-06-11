import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from './entities/booking.entity';
import { BookingsService } from './bookings.service';
import { MemberBookingsController } from './member-bookings.controller';
import { AdminBookingsController } from './admin-bookings.controller';
import { CreditsModule } from '../credits/credits.module';
import { MembersModule } from '../members/members.module';

@Module({
  imports: [TypeOrmModule.forFeature([Booking]), CreditsModule, MembersModule],
  controllers: [MemberBookingsController, AdminBookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
