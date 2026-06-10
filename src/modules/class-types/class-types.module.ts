import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClassType } from './entities/class-type.entity';
import { ClassTypesService } from './class-types.service';
import { ClassTypesController } from './class-types.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ClassType])],
  controllers: [ClassTypesController],
  providers: [ClassTypesService],
  exports: [ClassTypesService],
})
export class ClassTypesModule {}
