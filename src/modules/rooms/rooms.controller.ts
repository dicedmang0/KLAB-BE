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
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { Permissions } from '../../common/decorators/permissions.decorator';

@Controller('admin/rooms')
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Get()
  @Permissions('rooms:read')
  findAll() {
    return this.roomsService.findAll();
  }

  @Get(':id')
  @Permissions('rooms:read')
  async findOne(@Param('id') id: string) {
    const room = await this.roomsService.findById(id);
    if (!room) throw new NotFoundException(`Room ${id} not found`);
    return room;
  }

  @Post()
  @Permissions('rooms:create')
  create(@Body() dto: CreateRoomDto) {
    return this.roomsService.create(dto);
  }

  @Patch(':id')
  @Permissions('rooms:update')
  update(@Param('id') id: string, @Body() dto: UpdateRoomDto) {
    return this.roomsService.update(id, dto);
  }

  @Delete(':id')
  @Permissions('rooms:delete')
  deactivate(@Param('id') id: string) {
    return this.roomsService.deactivate(id);
  }
}
