import { Controller, Get, Param, Query } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { DokuTransactionsService } from '../doku/doku-transactions.service';
import { ListPaymentsDto } from './dto/list-payments.dto';
import { Permissions } from '../../common/decorators/permissions.decorator';

@Controller('admin/payments')
export class AdminPaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly dokuTransactions: DokuTransactionsService,
  ) {}

  @Get()
  @Permissions('payments:read_all')
  findAll(@Query() query: ListPaymentsDto) {
    return this.paymentsService.findAllForAdmin(query);
  }

  @Get(':id')
  @Permissions('payments:read_all')
  findOne(@Param('id') id: string) {
    return this.paymentsService.findByIdForAdmin(id);
  }

  /**
   * Returns all DOKU callback records for a specific payment. Throws 404 if the
   * payment itself does not exist, so the caller can distinguish "no callbacks
   * yet" (empty array) from "payment not found".
   */
  @Get(':id/doku-transactions')
  @Permissions('payments:read_all')
  async findDokuTransactions(@Param('id') id: string) {
    await this.paymentsService.findByIdForAdmin(id);
    return this.dokuTransactions.findByPaymentIdForAdmin(id);
  }
}
