import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SoftLaunchParticipant } from './entities/soft-launch-participant.entity';
import { SoftLaunchService } from './soft-launch.service';
import { AdminSoftLaunchController } from './admin-soft-launch.controller';

/**
 * Soft-launch participant codes: allocation (registration/admin), the booking
 * gate, and the member/admin views. Imports nothing from Auth/Bookings/Members/
 * Waitlist (they import this), so there are no module cycles.
 */
@Module({
  imports: [TypeOrmModule.forFeature([SoftLaunchParticipant])],
  controllers: [AdminSoftLaunchController],
  providers: [SoftLaunchService],
  exports: [SoftLaunchService],
})
export class SoftLaunchModule {}
