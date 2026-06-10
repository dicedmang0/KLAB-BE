import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  NotFoundException,
} from '@nestjs/common';
import { InstructorsService } from './instructors.service';
import { CreateInstructorDto } from './dto/create-instructor.dto';
import { UpdateInstructorDto } from './dto/update-instructor.dto';
import { Permissions } from '../../common/decorators/permissions.decorator';

@Controller('admin/instructors')
export class InstructorsController {
  constructor(private readonly instructorsService: InstructorsService) {}

  @Get()
  @Permissions('instructors:read')
  findAll() {
    return this.instructorsService.findAll();
  }

  @Get(':id')
  @Permissions('instructors:read')
  async findOne(@Param('id') id: string) {
    const instructor = await this.instructorsService.findById(id);
    if (!instructor) throw new NotFoundException(`Instructor ${id} not found`);
    return instructor;
  }

  @Post()
  @Permissions('instructors:create')
  create(@Body() dto: CreateInstructorDto) {
    return this.instructorsService.create(dto);
  }

  @Patch(':id')
  @Permissions('instructors:update')
  update(@Param('id') id: string, @Body() dto: UpdateInstructorDto) {
    return this.instructorsService.update(id, dto);
  }

  @Delete(':id')
  @Permissions('instructors:delete')
  deactivate(@Param('id') id: string) {
    return this.instructorsService.deactivate(id);
  }
}
