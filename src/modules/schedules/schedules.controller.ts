import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  NotFoundException,
  Request,
} from '@nestjs/common';
import { SchedulesService } from './schedules.service';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { Permissions } from '../../common/decorators/permissions.decorator';

@Controller('admin/schedules')
export class SchedulesController {
  constructor(private readonly schedulesService: SchedulesService) {}

  @Get()
  @Permissions('schedules:read')
  findAll() {
    return this.schedulesService.findAll();
  }

  @Get(':id')
  @Permissions('schedules:read')
  async findOne(@Param('id') id: string) {
    const schedule = await this.schedulesService.findById(id);
    if (!schedule) throw new NotFoundException(`Schedule ${id} not found`);
    return schedule;
  }

  @Post()
  @Permissions('schedules:create')
  create(@Body() dto: CreateScheduleDto, @Request() req: any) {
    return this.schedulesService.create(dto, req.user.id);
  }

  @Patch(':id')
  @Permissions('schedules:update')
  update(@Param('id') id: string, @Body() dto: UpdateScheduleDto) {
    return this.schedulesService.update(id, dto);
  }

  @Delete(':id')
  @Permissions('schedules:cancel')
  cancel(@Param('id') id: string) {
    return this.schedulesService.cancel(id);
  }
}
