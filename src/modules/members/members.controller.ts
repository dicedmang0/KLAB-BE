import { Controller, Post, Param, Body, Request } from '@nestjs/common';
import { CreditsService } from '../credits/credits.service';
import { CreditAdjustmentDto } from './dto/credit-adjustment.dto';
import { Permissions } from '../../common/decorators/permissions.decorator';

@Controller('admin/members')
export class MembersController {
  constructor(private readonly creditsService: CreditsService) {}

  @Post(':id/credit-adjustment')
  @Permissions('members:credit_adjust')
  adjustCredit(@Param('id') id: string, @Body() dto: CreditAdjustmentDto, @Request() req: any) {
    return this.creditsService.manualAdjust(id, dto.amount, dto.reason, req.user.id);
  }
}
