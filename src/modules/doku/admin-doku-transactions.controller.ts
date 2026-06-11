import { Controller, Get, Param, Query } from '@nestjs/common';
import { DokuTransactionsService } from './doku-transactions.service';
import { ListDokuTransactionsDto } from './dto/list-doku-transactions.dto';
import { Permissions } from '../../common/decorators/permissions.decorator';

@Controller('admin/doku-transactions')
export class AdminDokuTransactionsController {
  constructor(private readonly dokuTransactions: DokuTransactionsService) {}

  @Get()
  @Permissions('doku_transactions:read')
  findAll(@Query() query: ListDokuTransactionsDto) {
    return this.dokuTransactions.findAllForAdmin(query);
  }

  /** Detail view — includes raw_payload for full callback inspection. */
  @Get(':id')
  @Permissions('doku_transactions:read')
  findOne(@Param('id') id: string) {
    return this.dokuTransactions.findByIdForAdmin(id);
  }
}
