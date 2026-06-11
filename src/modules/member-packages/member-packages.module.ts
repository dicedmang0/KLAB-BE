import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MemberPackage } from './entities/member-package.entity';
import { Package } from '../packages/entities/package.entity';
import { MemberPackagesService } from './member-packages.service';
import { AdminMemberPackagesController } from './admin-member-packages.controller';
import { AdminMembersPackagesController } from './admin-members-packages.controller';
import { MemberPackagesController } from './member-packages.controller';
import { MembersModule } from '../members/members.module';
import { CreditsModule } from '../credits/credits.module';

@Module({
  imports: [TypeOrmModule.forFeature([MemberPackage, Package]), MembersModule, CreditsModule],
  controllers: [
    AdminMemberPackagesController,
    AdminMembersPackagesController,
    MemberPackagesController,
  ],
  providers: [MemberPackagesService],
  exports: [MemberPackagesService],
})
export class MemberPackagesModule {}
