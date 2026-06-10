import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Schedule } from './entities/schedule.entity';
import { ClassType } from '../class-types/entities/class-type.entity';
import { Instructor } from '../instructors/entities/instructor.entity';
import { Room } from '../rooms/entities/room.entity';
import { SchedulesService } from './schedules.service';
import { SchedulesController } from './schedules.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Schedule, ClassType, Instructor, Room])],
  controllers: [SchedulesController],
  providers: [SchedulesService],
  exports: [SchedulesService],
})
export class SchedulesModule {}
