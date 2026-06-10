import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Package, PackageStatus } from './entities/package.entity';
import { CreatePackageDto } from './dto/create-package.dto';
import { UpdatePackageDto } from './dto/update-package.dto';

@Injectable()
export class PackagesService {
  constructor(
    @InjectRepository(Package)
    private readonly packagesRepo: Repository<Package>,
  ) {}

  findAll(): Promise<Package[]> {
    return this.packagesRepo.find({ order: { name: 'ASC' } });
  }

  findById(id: string): Promise<Package | null> {
    return this.packagesRepo.findOneBy({ id });
  }

  async create(dto: CreatePackageDto): Promise<Package> {
    const pkg = this.packagesRepo.create(dto);
    return this.packagesRepo.save(pkg);
  }

  async update(id: string, dto: UpdatePackageDto): Promise<Package> {
    const pkg = await this.findByIdOrFail(id);
    Object.assign(pkg, dto);
    return this.packagesRepo.save(pkg);
  }

  async deactivate(id: string): Promise<Package> {
    const pkg = await this.findByIdOrFail(id);
    pkg.status = PackageStatus.INACTIVE;
    return this.packagesRepo.save(pkg);
  }

  private async findByIdOrFail(id: string): Promise<Package> {
    const pkg = await this.packagesRepo.findOneBy({ id });
    if (!pkg) throw new NotFoundException(`Package ${id} not found`);
    return pkg;
  }
}
