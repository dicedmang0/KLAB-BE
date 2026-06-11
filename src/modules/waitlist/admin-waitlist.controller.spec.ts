import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AdminWaitlistController } from './admin-waitlist.controller';
import { WaitlistService } from './waitlist.service';
import { BookingStatus } from '../bookings/entities/booking.entity';
import { ScheduleStatus } from '../schedules/entities/schedule.entity';

const mockAdminEntry = {
  id: 'wl-1',
  booking_code: 'BK-ABC123',
  member: { id: 'mem-1', first_name: 'Alice', last_name: 'Tan', email: 'alice@test.com' },
  status: BookingStatus.WAITLISTED,
  waitlist_position: 1,
  credit_cost: 2,
  created_at: new Date('2026-06-11T10:00:00Z'),
};

const mockPromotedView = {
  id: 'wl-1',
  booking_code: 'BK-ABC123',
  schedule_id: 'sch-1',
  status: BookingStatus.CONFIRMED,
  waitlist_position: 1,
  credit_cost: 2,
  created_at: new Date('2026-06-11T10:00:00Z'),
  schedule: {
    id: 'sch-1',
    start_time: new Date('2026-06-15T09:00:00Z'),
    end_time: new Date('2026-06-15T10:00:00Z'),
    status: ScheduleStatus.PUBLISHED,
  },
};

describe('AdminWaitlistController', () => {
  let controller: AdminWaitlistController;
  let service: jest.Mocked<Pick<WaitlistService, 'findScheduleWaitlist' | 'promote'>>;

  beforeEach(async () => {
    service = {
      findScheduleWaitlist: jest.fn(),
      promote: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminWaitlistController],
      providers: [{ provide: WaitlistService, useValue: service }],
    }).compile();

    controller = module.get(AdminWaitlistController);
  });

  describe('GET /admin/schedules/:id/waitlist', () => {
    it('returns the schedule waitlist queue', async () => {
      service.findScheduleWaitlist.mockResolvedValue([mockAdminEntry] as any);
      const result = await controller.scheduleWaitlist('sch-1');
      expect(service.findScheduleWaitlist).toHaveBeenCalledWith('sch-1');
      expect(result).toEqual([mockAdminEntry]);
    });

    it('propagates 404 for an unknown schedule', async () => {
      service.findScheduleWaitlist.mockRejectedValue(new NotFoundException());
      await expect(controller.scheduleWaitlist('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('POST /admin/waitlist/:id/promote', () => {
    it('promotes a waitlisted entry to a confirmed booking', async () => {
      service.promote.mockResolvedValue(mockPromotedView as any);
      const result = await controller.promote('wl-1');
      expect(service.promote).toHaveBeenCalledWith('wl-1');
      expect(result).toBe(mockPromotedView);
      expect((result as any).status).toBe(BookingStatus.CONFIRMED);
    });

    it('propagates 409 when the schedule is full', async () => {
      service.promote.mockRejectedValue(new ConflictException('Schedule is full'));
      await expect(controller.promote('wl-1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('propagates 400 when the member lacks credit', async () => {
      service.promote.mockRejectedValue(new BadRequestException('insufficient credit'));
      await expect(controller.promote('wl-1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
