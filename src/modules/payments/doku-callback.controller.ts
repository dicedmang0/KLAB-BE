import {
  Controller,
  Post,
  Req,
  Headers,
  HttpCode,
  HttpStatus,
  BadRequestException,
  RawBodyRequest,
} from '@nestjs/common';
import { Request } from 'express';
import { PaymentsService } from './payments.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller('payments/doku')
export class DokuCallbackController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * DOKU payment notification. Public (no JWT) but signature-verified inside the
   * service. The raw request body is required to recompute the signature digest,
   * so `rawBody: true` is enabled in main.ts.
   */
  @Post('callback')
  @Public()
  @HttpCode(HttpStatus.OK)
  handleCallback(
    @Req() req: RawBodyRequest<Request>,
    @Headers('Client-Id') clientId: string,
    @Headers('Request-Id') requestId: string,
    @Headers('Request-Timestamp') requestTimestamp: string,
    @Headers('Signature') signature: string,
  ) {
    const rawBody = req.rawBody;
    if (!rawBody || rawBody.length === 0) {
      throw new BadRequestException('Missing callback body');
    }
    return this.paymentsService.handleDokuCallback(rawBody, {
      clientId,
      requestId,
      requestTimestamp,
      signature,
    });
  }
}
