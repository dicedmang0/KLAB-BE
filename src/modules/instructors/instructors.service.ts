import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Instructor, InstructorStatus } from './entities/instructor.entity';
import { CreateInstructorDto } from './dto/create-instructor.dto';
import { UpdateInstructorDto } from './dto/update-instructor.dto';

@Injectable()
export class InstructorsService {
  constructor(
    @InjectRepository(Instructor)
    private readonly instructorsRepo: Repository<Instructor>,
  ) {}

  findAll(): Promise<Instructor[]> {
    return this.instructorsRepo.find({ order: { last_name: 'ASC', first_name: 'ASC' } });
  }

  findById(id: string): Promise<Instructor | null> {
    return this.instructorsRepo.findOneBy({ id });
  }

  async create(dto: CreateInstructorDto): Promise<Instructor> {
    const existing = await this.instructorsRepo.findOneBy({ email: dto.email });
    if (existing) {
      throw new ConflictException(`An instructor with email "${dto.email}" already exists`);
    }
    const instructor = this.instructorsRepo.create(dto);
    return this.instructorsRepo.save(instructor);
  }

  async update(id: string, dto: UpdateInstructorDto): Promise<Instructor> {
    const instructor = await this.findByIdOrFail(id);
    if (dto.email && dto.email !== instructor.email) {
      const existing = await this.instructorsRepo.findOneBy({ email: dto.email });
      if (existing) {
        throw new ConflictException(`An instructor with email "${dto.email}" already exists`);
      }
    }
    Object.assign(instructor, dto);
    return this.instructorsRepo.save(instructor);
  }

  async deactivate(id: string): Promise<Instructor> {
    const instructor = await this.findByIdOrFail(id);
    instructor.status = InstructorStatus.INACTIVE;
    return this.instructorsRepo.save(instructor);
  }

  private async findByIdOrFail(id: string): Promise<Instructor> {
    const instructor = await this.instructorsRepo.findOneBy({ id });
    if (!instructor) throw new NotFoundException(`Instructor ${id} not found`);
    return instructor;
  }
}
