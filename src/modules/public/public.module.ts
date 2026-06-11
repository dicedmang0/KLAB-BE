import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Schedule } from '../schedules/entities/schedule.entity';
import { ClassType } from '../class-types/entities/class-type.entity';
import { Package } from '../packages/entities/package.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { PublicService } from './public.service';
import { PublicController } from './public.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Schedule, ClassType, Package, Booking])],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
