import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClassType, ClassTypeStatus } from './entities/class-type.entity';
import { CreateClassTypeDto } from './dto/create-class-type.dto';
import { UpdateClassTypeDto } from './dto/update-class-type.dto';

@Injectable()
export class ClassTypesService {
  constructor(
    @InjectRepository(ClassType)
    private readonly classTypesRepo: Repository<ClassType>,
  ) {}

  findAll(): Promise<ClassType[]> {
    return this.classTypesRepo.find({ order: { name: 'ASC' } });
  }

  findById(id: string): Promise<ClassType | null> {
    return this.classTypesRepo.findOneBy({ id });
  }

  async create(dto: CreateClassTypeDto): Promise<ClassType> {
    const classType = this.classTypesRepo.create(dto);
    return this.classTypesRepo.save(classType);
  }

  async update(id: string, dto: UpdateClassTypeDto): Promise<ClassType> {
    const classType = await this.findByIdOrFail(id);
    Object.assign(classType, dto);
    return this.classTypesRepo.save(classType);
  }

  async deactivate(id: string): Promise<ClassType> {
    const classType = await this.findByIdOrFail(id);
    classType.status = ClassTypeStatus.INACTIVE;
    return this.classTypesRepo.save(classType);
  }

  private async findByIdOrFail(id: string): Promise<ClassType> {
    const classType = await this.classTypesRepo.findOneBy({ id });
    if (!classType) throw new NotFoundException(`Class type ${id} not found`);
    return classType;
  }
}
