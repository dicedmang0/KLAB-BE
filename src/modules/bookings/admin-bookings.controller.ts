import { Controller, Get, Post, Param, Body, Query, Request } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { CancelBookingDto } from './dto/cancel-booking.dto';
import { AdminCreateBookingDto } from './dto/admin-create-booking.dto';
import { ListBookingsDto } from './dto/list-bookings.dto';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('admin/bookings')
export class AdminBookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Get()
  @Permissions('bookings:read_all')
  findAll(@Query() query: ListBookingsDto) {
    return this.bookingsService.findAll(query);
  }

  @Get(':id')
  @Permissions('bookings:read_all')
  findOne(@Param('id') id: string) {
    return this.bookingsService.findDetail(id);
  }

  /**
   * Books an existing member into a class on their behalf. Confirms the seat
   * when one is free, otherwise adds the member to the back of the waitlist.
   * front_desk also holds `bookings:create` (for future flows), so the role
   * check narrows this endpoint to owner and admin.
   */
  @Post()
  @Roles('owner', 'admin')
  @Permissions('bookings:create')
  create(@Body() dto: AdminCreateBookingDto, @Request() req: any) {
    return this.bookingsService.createByAdmin(req.user.id, dto);
  }

  @Post(':id/check-in')
  @Permissions('bookings:check_in')
  checkIn(@Param('id') id: string) {
    return this.bookingsService.checkIn(id);
  }

  @Post(':id/no-show')
  @Permissions('bookings:mark_no_show')
  noShow(@Param('id') id: string) {
    return this.bookingsService.markNoShow(id);
  }

  @Post(':id/cancel')
  @Permissions('bookings:cancel_any')
  cancel(@Param('id') id: string, @Body() dto: CancelBookingDto, @Request() req: any) {
    return this.bookingsService.cancelAny(id, req.user.id, dto?.reason);
  }
}
