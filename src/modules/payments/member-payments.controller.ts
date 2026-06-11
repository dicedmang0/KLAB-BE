import { Controller, Post, Param, Request } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { Permissions } from '../../common/decorators/permissions.decorator';

@Controller('member/packages')
export class MemberPaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * Start a DOKU Checkout purchase for a package. Creates a pending payment and
   * returns the DOKU payment URL. Own-scoped via req.user.id; gated by
   * `packages:read` (held by the member role), consistent with purchase-intent.
   */
  @Post(':packageId/checkout')
  @Permissions('packages:read')
  checkout(@Param('packageId') packageId: string, @Request() req: any) {
    return this.paymentsService.createCheckout(req.user.id, packageId);
  }
}
