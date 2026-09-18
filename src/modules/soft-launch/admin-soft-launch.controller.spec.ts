import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AdminSoftLaunchController } from './admin-soft-launch.controller';
import { SoftLaunchService, SOFT_LAUNCH_QUOTA_FULL } from './soft-launch.service';

const mockParticipant = {
  id: 'p-1',
  code: 'KLAB-SL-7H3KQ9',
  slot_no: 1,
  source: 'admin',
  status: 'pending',
  allocated_by: 'admin-1',
  allocated_at: new Date('2026-09-18T04:12:00Z'),
  user: { id: 'u-1', email: 'alice@test.com', full_name: 'Alice Tan' },
  member: null,
  soft_launch_bookings: 0,
};

describe('AdminSoftLaunchController', () => {
  let controller: AdminSoftLaunchController;
  let service: jest.Mocked<Pick<SoftLaunchService, 'listForAdmin' | 'allocateByAdmin'>>;

  beforeEach(async () => {
    service = { listForAdmin: jest.fn(), allocateByAdmin: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminSoftLaunchController],
      providers: [{ provide: SoftLaunchService, useValue: service }],
    }).compile();

    controller = module.get(AdminSoftLaunchController);
  });

  describe('GET /admin/soft-launch/participants', () => {
    it('returns the quota summary and participants', async () => {
      const list = {
        summary: {
          enabled: true,
          active: false,
          start: null,
          end: null,
          quota: 80,
          allocated: 1,
          remaining: 79,
        },
        items: [mockParticipant],
      };
      service.listForAdmin.mockResolvedValue(list as any);
      await expect(controller.list()).resolves.toBe(list);
    });
  });

  describe('POST /admin/soft-launch/participants', () => {
    it('allocates by user_id on behalf of the acting admin', async () => {
      service.allocateByAdmin.mockResolvedValue(mockParticipant as any);
      const result = await controller.allocate({ user_id: 'u-1' }, { user: { id: 'admin-1' } });
      expect(service.allocateByAdmin).toHaveBeenCalledWith({ user_id: 'u-1' }, 'admin-1');
      expect(result).toBe(mockParticipant);
    });

    it('propagates 404 for an unknown user', async () => {
      service.allocateByAdmin.mockRejectedValue(new NotFoundException());
      await expect(
        controller.allocate({ email: 'nobody@test.com' }, { user: { id: 'admin-1' } }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('propagates 409 when the quota is full', async () => {
      service.allocateByAdmin.mockRejectedValue(
        new ConflictException({
          message: 'Soft-launch quota is full',
          code: SOFT_LAUNCH_QUOTA_FULL,
        }),
      );
      await expect(
        controller.allocate({ user_id: 'u-1' }, { user: { id: 'admin-1' } }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
