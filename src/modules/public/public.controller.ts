import { Controller, Get, Param } from '@nestjs/common';
import { PublicService } from './public.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller('public')
@Public()
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get('class-types')
  findAllClassTypes() {
    return this.publicService.findPublishedClassTypes();
  }

  @Get('class-types/:id')
  findClassType(@Param('id') id: string) {
    return this.publicService.findPublishedClassTypeById(id);
  }

  @Get('packages')
  findAllPackages() {
    return this.publicService.findPublishedPackages();
  }

  @Get('packages/:id')
  findPackage(@Param('id') id: string) {
    return this.publicService.findPublishedPackageById(id);
  }

  @Get('schedules')
  findAllSchedules() {
    return this.publicService.findPublishedSchedules();
  }

  @Get('schedules/:id')
  findSchedule(@Param('id') id: string) {
    return this.publicService.findPublishedScheduleById(id);
  }
}
