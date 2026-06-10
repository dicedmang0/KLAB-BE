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
import { PackagesService } from './packages.service';
import { CreatePackageDto } from './dto/create-package.dto';
import { UpdatePackageDto } from './dto/update-package.dto';
import { Permissions } from '../../common/decorators/permissions.decorator';

@Controller('admin/packages')
export class PackagesController {
  constructor(private readonly packagesService: PackagesService) {}

  @Get()
  @Permissions('packages:read')
  findAll() {
    return this.packagesService.findAll();
  }

  @Get(':id')
  @Permissions('packages:read')
  async findOne(@Param('id') id: string) {
    const pkg = await this.packagesService.findById(id);
    if (!pkg) throw new NotFoundException(`Package ${id} not found`);
    return pkg;
  }

  @Post()
  @Permissions('packages:create')
  create(@Body() dto: CreatePackageDto) {
    return this.packagesService.create(dto);
  }

  @Patch(':id')
  @Permissions('packages:update')
  update(@Param('id') id: string, @Body() dto: UpdatePackageDto) {
    return this.packagesService.update(id, dto);
  }

  @Delete(':id')
  @Permissions('packages:delete')
  deactivate(@Param('id') id: string) {
    return this.packagesService.deactivate(id);
  }
}
