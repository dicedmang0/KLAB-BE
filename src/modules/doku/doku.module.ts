import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DokuTransaction } from './entities/doku-transaction.entity';
import { DokuSignatureService } from './doku-signature.service';
import { DokuClient } from './doku.client';
import { DokuTransactionsService } from './doku-transactions.service';

/**
 * Low-level DOKU concerns (signature, outbound client, callback audit log).
 * Has NO dependency on PaymentsModule, so PaymentsModule can import this without
 * a circular reference — the callback controller lives in PaymentsModule.
 */
@Module({
  imports: [TypeOrmModule.forFeature([DokuTransaction])],
  providers: [DokuSignatureService, DokuClient, DokuTransactionsService],
  exports: [DokuSignatureService, DokuClient, DokuTransactionsService],
})
export class DokuModule {}
