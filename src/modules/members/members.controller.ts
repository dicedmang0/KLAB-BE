import { Controller, Get, Post, Param, Body, Query, Request, Res, Header } from '@nestjs/common';
import type { Response } from 'express';
import { MembersService } from './members.service';
import { CreditsService } from '../credits/credits.service';
import { CreditAdjustmentDto } from './dto/credit-adjustment.dto';
import { ListMembersDto } from './dto/list-members.dto';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ExportMembersDto } from './dto/export-members.dto';

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

  @Post('export/vibefam')
  @Permissions('members:read')
  @Header('Cache-Control', 'no-store')
  async exportVibefam(@Body() dto: ExportMembersDto, @Res() res: Response): Promise<void> {
    const csv = await this.membersService.exportForVibefam(dto);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="klab-members-vibefam-${dto.date_purchased}.csv"`,
    );
    res.send(csv);
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
