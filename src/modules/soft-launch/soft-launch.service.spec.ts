import { ForbiddenException } from '@nestjs/common';
import { SoftLaunchService, SOFT_LAUNCH_NOT_ELIGIBLE } from './soft-launch.service';
import { SoftLaunchConfig } from '../../config/soft-launch.config';

// 2026-09-20 00:00:00 WIB .. 2026-09-25 23:59:59 WIB, expressed as instants.
const START = new Date('2026-09-20T00:00:00+07:00');
const END = new Date('2026-09-25T23:59:59+07:00');
const IN_WINDOW_NOW = new Date('2026-09-22T10:00:00+07:00');
const IN_WINDOW_CLASS = new Date('2026-09-23T09:00:00+07:00');
const AFTER_WINDOW_CLASS = new Date('2026-09-26T09:00:00+07:00');

describe('SoftLaunchService', () => {
  let cfg: SoftLaunchConfig;
  let repo: { findOne: jest.Mock; count: jest.Mock };
  let manager: { findOne: jest.Mock };
  let service: SoftLaunchService;

  beforeEach(() => {
    cfg = { enabled: true, start: START, end: END, quota: 80 };
    repo = { findOne: jest.fn(), count: jest.fn() };
    manager = { findOne: jest.fn() };
    const dataSource = { getRepository: () => repo };
    const config = { get: () => cfg };
    service = new SoftLaunchService(dataSource as any, config as any);
    jest.useFakeTimers({ now: IN_WINDOW_NOW });
  });

  afterEach(() => jest.useRealTimers());

  describe('windowActive', () => {
    it('is false when the feature is disabled', () => {
      cfg.enabled = false;
      expect(service.windowActive(IN_WINDOW_NOW)).toBe(false);
    });

    it('is inclusive at both boundaries', () => {
      expect(service.windowActive(START)).toBe(true);
      expect(service.windowActive(END)).toBe(true);
      expect(service.windowActive(new Date(START.getTime() - 1))).toBe(false);
      expect(service.windowActive(new Date(END.getTime() + 1))).toBe(false);
    });
  });

  describe('allocationOpen', () => {
    it('is open from enable until END, even before START', () => {
      jest.setSystemTime(new Date('2026-09-18T12:00:00+07:00'));
      expect(service.allocationOpen()).toBe(true);
    });

    it('closes after END and when disabled', () => {
      jest.setSystemTime(new Date(END.getTime() + 1000));
      expect(service.allocationOpen()).toBe(false);
      jest.setSystemTime(IN_WINDOW_NOW);
      cfg.enabled = false;
      expect(service.allocationOpen()).toBe(false);
    });
  });

  describe('checkBooking', () => {
    it('returns false (normal rules, no lookup) when now is outside the window', async () => {
      jest.setSystemTime(new Date('2026-09-19T23:59:59+07:00'));
      await expect(service.checkBooking(manager as any, 'u1', IN_WINDOW_CLASS)).resolves.toBe(
        false,
      );
      expect(manager.findOne).not.toHaveBeenCalled();
    });

    it('returns false (normal rules) when the class starts outside the window', async () => {
      await expect(service.checkBooking(manager as any, 'u1', AFTER_WINDOW_CLASS)).resolves.toBe(
        false,
      );
      expect(manager.findOne).not.toHaveBeenCalled();
    });

    it('returns true (bypass) for a participant on an in-window class', async () => {
      manager.findOne.mockResolvedValue({ id: 'p1', user_id: 'u1', code: 'KLAB-SL-ABC234' });
      await expect(service.checkBooking(manager as any, 'u1', IN_WINDOW_CLASS)).resolves.toBe(true);
      // Eligibility is looked up by the authenticated user id only.
      expect(manager.findOne).toHaveBeenCalledWith(expect.anything(), {
        where: { user_id: 'u1' },
      });
    });

    it('throws 403 SOFT_LAUNCH_NOT_ELIGIBLE for a non-participant on an in-window class', async () => {
      manager.findOne.mockResolvedValue(null);
      const err = await service.checkBooking(manager as any, 'u2', IN_WINDOW_CLASS).catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err.getResponse() as any).code).toBe(SOFT_LAUNCH_NOT_ELIGIBLE);
    });

    it('throws 403 when there is no user id (member without a linked account)', async () => {
      await expect(
        service.checkBooking(manager as any, null, IN_WINDOW_CLASS),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(manager.findOne).not.toHaveBeenCalled();
    });

    it('is a no-op (false) when disabled, regardless of allocation', async () => {
      cfg.enabled = false;
      await expect(service.checkBooking(manager as any, 'u1', IN_WINDOW_CLASS)).resolves.toBe(
        false,
      );
    });
  });

  describe('viewFor', () => {
    it('exposes the owner code and skips the quota count when eligible', async () => {
      const allocatedAt = new Date('2026-09-18T04:12:00Z');
      repo.findOne.mockResolvedValue({ code: 'KLAB-SL-7H3KQ9', allocated_at: allocatedAt });
      await expect(service.viewFor('u1')).resolves.toEqual({
        enabled: true,
        active: true,
        eligible: true,
        participant_code: 'KLAB-SL-7H3KQ9',
        allocated_at: allocatedAt,
        quota_full: false,
      });
      expect(repo.count).not.toHaveBeenCalled();
    });

    it('reports quota_full for a non-participant once the quota is reached', async () => {
      repo.findOne.mockResolvedValue(null);
      repo.count.mockResolvedValue(80);
      await expect(service.viewFor('u2')).resolves.toMatchObject({
        eligible: false,
        participant_code: null,
        allocated_at: null,
        quota_full: true,
      });
    });

    it('never reports quota_full while disabled', async () => {
      cfg.enabled = false;
      repo.findOne.mockResolvedValue(null);
      await expect(service.viewFor('u2')).resolves.toMatchObject({
        enabled: false,
        active: false,
        quota_full: false,
      });
      expect(repo.count).not.toHaveBeenCalled();
    });
  });
});
