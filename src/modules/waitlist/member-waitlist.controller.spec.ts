import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { MemberWaitlistController } from './member-waitlist.controller';
import { WaitlistService } from './waitlist.service';
import { BookingStatus } from '../bookings/entities/booking.entity';
import { ScheduleStatus } from '../schedules/entities/schedule.entity';

const mockWaitlistView = {
  id: 'wl-1',
  booking_code: 'BK-ABC123',
  schedule_id: 'sch-1',
  status: BookingStatus.WAITLISTED,
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

const reqFor = (userId: string) => ({ user: { id: userId } });

describe('MemberWaitlistController', () => {
  let controller: MemberWaitlistController;
  let service: jest.Mocked<
    Pick<WaitlistService, 'joinWaitlist' | 'findOwnWaitlist' | 'leaveWaitlist'>
  >;

  beforeEach(async () => {
    service = {
      joinWaitlist: jest.fn(),
      findOwnWaitlist: jest.fn(),
      leaveWaitlist: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MemberWaitlistController],
      providers: [{ provide: WaitlistService, useValue: service }],
    }).compile();

    controller = module.get(MemberWaitlistController);
  });

  describe('POST /member/schedules/:scheduleId/waitlist', () => {
    it('joins the waitlist for the authenticated member', async () => {
      service.joinWaitlist.mockResolvedValue(mockWaitlistView as any);
      const result = await controller.join('sch-1', reqFor('user-1'));
      expect(service.joinWaitlist).toHaveBeenCalledWith('user-1', 'sch-1');
      expect(result).toBe(mockWaitlistView);
    });

    it('propagates 400 when the schedule still has open slots', async () => {
      service.joinWaitlist.mockRejectedValue(new BadRequestException('open slots'));
      await expect(controller.join('sch-1', reqFor('user-1'))).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('propagates 409 when the member is already active on the schedule', async () => {
      service.joinWaitlist.mockRejectedValue(new ConflictException('duplicate'));
      await expect(controller.join('sch-1', reqFor('user-1'))).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('GET /member/waitlist', () => {
    it('returns the member’s waitlist entries', async () => {
      service.findOwnWaitlist.mockResolvedValue([mockWaitlistView] as any);
      const result = await controller.list(reqFor('user-1'));
      expect(service.findOwnWaitlist).toHaveBeenCalledWith('user-1');
      expect(result).toEqual([mockWaitlistView]);
    });
  });

  describe('DELETE /member/waitlist/:id', () => {
    it('leaves the waitlist', async () => {
      const cancelled = { ...mockWaitlistView, status: BookingStatus.CANCELLED };
      service.leaveWaitlist.mockResolvedValue(cancelled as any);
      const result = await controller.leave('wl-1', reqFor('user-1'));
      expect(service.leaveWaitlist).toHaveBeenCalledWith('user-1', 'wl-1');
      expect(result).toBe(cancelled);
    });

    it('propagates 404 for an unknown entry', async () => {
      service.leaveWaitlist.mockRejectedValue(new NotFoundException());
      await expect(controller.leave('nope', reqFor('user-1'))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
