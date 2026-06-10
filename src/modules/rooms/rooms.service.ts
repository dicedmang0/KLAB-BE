import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Room, RoomStatus } from './entities/room.entity';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';

@Injectable()
export class RoomsService {
  constructor(
    @InjectRepository(Room)
    private readonly roomsRepo: Repository<Room>,
  ) {}

  findAll(): Promise<Room[]> {
    return this.roomsRepo.find({ order: { name: 'ASC' } });
  }

  findById(id: string): Promise<Room | null> {
    return this.roomsRepo.findOneBy({ id });
  }

  async create(dto: CreateRoomDto): Promise<Room> {
    const existing = await this.roomsRepo.findOneBy({ name: dto.name });
    if (existing) {
      throw new ConflictException(`A room named "${dto.name}" already exists`);
    }
    const room = this.roomsRepo.create(dto);
    return this.roomsRepo.save(room);
  }

  async update(id: string, dto: UpdateRoomDto): Promise<Room> {
    const room = await this.findByIdOrFail(id);
    if (dto.name && dto.name !== room.name) {
      const existing = await this.roomsRepo.findOneBy({ name: dto.name });
      if (existing) {
        throw new ConflictException(`A room named "${dto.name}" already exists`);
      }
    }
    Object.assign(room, dto);
    return this.roomsRepo.save(room);
  }

  async deactivate(id: string): Promise<Room> {
    const room = await this.findByIdOrFail(id);
    room.status = RoomStatus.INACTIVE;
    return this.roomsRepo.save(room);
  }

  private async findByIdOrFail(id: string): Promise<Room> {
    const room = await this.roomsRepo.findOneBy({ id });
    if (!room) throw new NotFoundException(`Room ${id} not found`);
    return room;
  }
}
