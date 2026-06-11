import { Controller, Get, Post, Param, Body, Query, Request } from '@nestjs/common';
import { MembersService } from './members.service';
import { CreditsService } from '../credits/credits.service';
import { CreditAdjustmentDto } from './dto/credit-adjustment.dto';
import { ListMembersDto } from './dto/list-members.dto';
import { Permissions } from '../../common/decorators/permissions.decorator';

@Controller('admin/members')
export class MembersController {
  constructor(
    private readonly membersService: MembersService,
    private readonly creditsService: CreditsService,
  ) {}

  @Get()
  @Permissions('members:read')
  findAll(@Query() query: ListMembersDto) {
    return this.membersService.findAllForAdmin(query);
  }

  @Get(':id')
  @Permissions('members:read')
  findOne(@Param('id') id: string) {
    return this.membersService.findByIdForAdmin(id);
  }

  @Post(':id/credit-adjustment')
  @Permissions('members:credit_adjust')
  adjustCredit(@Param('id') id: string, @Body() dto: CreditAdjustmentDto, @Request() req: any) {
    return this.creditsService.manualAdjust(id, dto.amount, dto.reason, req.user.id);
  }
}
