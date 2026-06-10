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
import { ClassTypesService } from './class-types.service';
import { CreateClassTypeDto } from './dto/create-class-type.dto';
import { UpdateClassTypeDto } from './dto/update-class-type.dto';
import { Permissions } from '../../common/decorators/permissions.decorator';

@Controller('admin/class-types')
export class ClassTypesController {
  constructor(private readonly classTypesService: ClassTypesService) {}

  @Get()
  @Permissions('class_types:read')
  findAll() {
    return this.classTypesService.findAll();
  }

  @Get(':id')
  @Permissions('class_types:read')
  async findOne(@Param('id') id: string) {
    const classType = await this.classTypesService.findById(id);
    if (!classType) throw new NotFoundException(`Class type ${id} not found`);
    return classType;
  }

  @Post()
  @Permissions('class_types:create')
  create(@Body() dto: CreateClassTypeDto) {
    return this.classTypesService.create(dto);
  }

  @Patch(':id')
  @Permissions('class_types:update')
  update(@Param('id') id: string, @Body() dto: UpdateClassTypeDto) {
    return this.classTypesService.update(id, dto);
  }

  @Delete(':id')
  @Permissions('class_types:delete')
  deactivate(@Param('id') id: string) {
    return this.classTypesService.deactivate(id);
  }
}
