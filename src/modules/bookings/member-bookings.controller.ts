import { Controller, Get, Post, Param, Body, Request } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { CancelBookingDto } from './dto/cancel-booking.dto';
import { Permissions } from '../../common/decorators/permissions.decorator';

@Controller('member/bookings')
export class MemberBookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Get()
  @Permissions('bookings:read_own')
  findOwn(@Request() req: any) {
    return this.bookingsService.findOwn(req.user.id);
  }

  @Get(':id')
  @Permissions('bookings:read_own')
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.bookingsService.findOwnDetail(req.user.id, id);
  }

  @Post()
  @Permissions('bookings:create')
  create(@Body() dto: CreateBookingDto, @Request() req: any) {
    return this.bookingsService.createForMember(req.user.id, dto);
  }

  @Post(':id/cancel')
  @Permissions('bookings:cancel_own')
  cancel(@Param('id') id: string, @Body() dto: CancelBookingDto, @Request() req: any) {
    return this.bookingsService.cancelOwn(req.user.id, id, dto?.reason);
  }
}
