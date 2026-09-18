import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Member } from './entities/member.entity';
import { MembersService } from './members.service';
import { MembersController } from './members.controller';
import { MemberProfileController } from './member-profile.controller';
import { CreditsModule } from '../credits/credits.module';
import { SoftLaunchModule } from '../soft-launch/soft-launch.module';

@Module({
  imports: [TypeOrmModule.forFeature([Member]), CreditsModule, SoftLaunchModule],
  controllers: [MembersController, MemberProfileController],
  providers: [MembersService],
  exports: [MembersService],
})
export class MembersModule {}
