import { Controller, Get, Param, Query } from '@nestjs/common';
import { MemberPackagesService } from './member-packages.service';
import { ListMemberPackagesDto } from './dto/list-member-packages.dto';
import { Permissions } from '../../common/decorators/permissions.decorator';

/**
 * Admin views over members' package ownership. Gated by `members:read` (admin /
 * front-desk), NOT `packages:read` — the latter is held by the member role for
 * browsing the public package catalogue, so using it here would let a member list
 * every other member's grants. member_packages are member account data.
 */
@Controller('admin/member-packages')
export class AdminMemberPackagesController {
  constructor(private readonly memberPackagesService: MemberPackagesService) {}

  @Get()
  @Permissions('members:read')
  findAll(@Query() query: ListMemberPackagesDto) {
    return this.memberPackagesService.findAllForAdmin(query);
  }

  @Get(':id')
  @Permissions('members:read')
  findOne(@Param('id') id: string) {
    return this.memberPackagesService.findByIdForAdmin(id);
  }
}
