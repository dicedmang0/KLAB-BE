import { Controller, Get, Post, Param, Request } from '@nestjs/common';
import { MemberPackagesService } from './member-packages.service';
import { Permissions } from '../../common/decorators/permissions.decorator';

@Controller('member/packages')
export class MemberPackagesController {
  constructor(private readonly memberPackagesService: MemberPackagesService) {}

  @Get('my')
  @Permissions('packages:read')
  findMy(@Request() req: any) {
    return this.memberPackagesService.findOwn(req.user.id);
  }

  @Post(':packageId/purchase-intent')
  @Permissions('packages:read')
  purchaseIntent(@Param('packageId') packageId: string, @Request() req: any) {
    return this.memberPackagesService.buildPurchaseIntent(req.user.id, packageId);
  }
}
