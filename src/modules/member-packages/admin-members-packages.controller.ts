import { Controller, Post, Param, Body, Request } from '@nestjs/common';
import { MemberPackagesService } from './member-packages.service';
import { AssignPackageDto } from './dto/assign-package.dto';
import { Permissions } from '../../common/decorators/permissions.decorator';

/**
 * Member-scoped package assignment. Kept in MemberPackagesModule (separate from
 * MembersController) so the package-grant logic stays in this module and no
 * MembersModule ↔ MemberPackagesModule cycle is introduced.
 */
@Controller('admin/members')
export class AdminMembersPackagesController {
  constructor(private readonly memberPackagesService: MemberPackagesService) {}

  @Post(':id/packages')
  @Permissions('packages:sell')
  assign(@Param('id') id: string, @Body() dto: AssignPackageDto, @Request() req: any) {
    return this.memberPackagesService.assignToMember(id, dto, req.user.id);
  }
}
