import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from './entities/payment.entity';
import { Package } from '../packages/entities/package.entity';
import { MemberPackage } from '../member-packages/entities/member-package.entity';
import { PaymentsService } from './payments.service';
import { MemberPaymentsController } from './member-payments.controller';
import { DokuCallbackController } from './doku-callback.controller';
import { MembersModule } from '../members/members.module';
import { CreditsModule } from '../credits/credits.module';
import { DokuModule } from '../doku/doku.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, Package, MemberPackage]),
    MembersModule,
    CreditsModule,
    DokuModule,
  ],
  controllers: [MemberPaymentsController, DokuCallbackController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
