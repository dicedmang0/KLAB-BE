import { FindOperator } from 'typeorm';
import { ForbiddenException } from '@nestjs/common';
import { allocateParticipant, CODE_PATTERN, isInCampaign } from './soft-launch.allocator';
import { SoftLaunchService, SOFT_LAUNCH_NOT_ELIGIBLE } from './soft-launch.service';
import { SoftLaunchAllocationSource } from './entities/soft-launch-participant.entity';
import softLaunchConfig, { SoftLaunchConfig } from '../../config/soft-launch.config';

/**
 * Campaign-window scoping of quota + eligibility, against an in-memory
 * soft_launch_participants table that honours TypeORM `Between` (inclusive),
 * stamps allocated_at from the (fake) clock like the DB default, and enforces
 * the real UNIQUE(user_id / code / slot_no) constraints. The advisory lock is
 * modelled by serialising transactions; real Postgres locking is covered by the
 * disposable-DB smoke.
 */

type Row = Record<string, any>;

// Current campaign (production target): 7–11 Oct 2026 WIB.
const START = new Date('2026-10-07T00:00:00+07:00');
const END = new Date('2026-10-11T23:59:59+07:00');
const WINDOW = { start: START, end: END };
const NOW = new Date('2026-10-08T10:00:00+07:00');
const SEPTEMBER = new Date('2026-09-20T09:00:00+07:00');
const IN_WINDOW_CLASS = new Date('2026-10-09T09:00:00+07:00');

class Table {
  rows: Row[] = [];
  private seq = 0;
  private chain: Promise<unknown> = Promise.resolve();

  private matches(row: Row, where: Row = {}): boolean {
    return Object.entries(where).every(([k, v]) => {
      if (v instanceof FindOperator) {
        const [from, to] = v.value as unknown as [Date, Date];
        const t = new Date(row[k]).getTime();
        return t >= new Date(from).getTime() && t <= new Date(to).getTime();
      }
      return row[k] === v;
    });
  }

  maxSlot = () => this.rows.reduce((m, r) => Math.max(m, r.slot_no), 0);

  /** `n` rows allocated at `at`, continuing the global slot sequence. */
  seed(n: number, at: Date, prefix: string): void {
    for (let i = 0; i < n; i++) {
      const slot = this.maxSlot() + 1;
      this.rows.push({
        id: `p-${++this.seq}`,
        user_id: `${prefix}-${slot}`,
        code: `KLAB-SL-S${String(slot).padStart(5, '0')}`,
        slot_no: slot,
        source: 'registration',
        allocated_at: at,
      });
    }
  }

  current = () => this.rows.filter((r) => isInCampaign(r.allocated_at, WINDOW)).length;

  repo = {
    findOne: async ({ where }: Row) => this.rows.find((r) => this.matches(r, where)) ?? null,
    count: async (o: Row = {}) => this.rows.filter((r) => this.matches(r, o.where)).length,
    exists: async ({ where }: Row) => this.rows.some((r) => this.matches(r, where)),
    create: (x: Row) => ({ ...x }),
    save: async (x: Row) => {
      for (const k of ['user_id', 'code', 'slot_no']) {
        if (this.rows.some((r) => r[k] === x[k])) throw new Error(`UQ violation on ${k}`);
      }
      const row = { id: `p-${++this.seq}`, allocated_at: new Date(Date.now()), ...x };
      this.rows.push(row);
      return row;
    },
    createQueryBuilder: () => ({
      select: () => ({ getRawOne: async () => ({ max: this.maxSlot() }) }),
    }),
  };

  manager = {
    query: async () => [],
    getRepository: () => this.repo,
    findOne: (_e: unknown, o: Row) => this.repo.findOne(o),
    count: (_e: unknown, o: Row) => this.repo.count(o),
  };

  /** Serialised like pg_advisory_xact_lock: one allocation transaction at a time. */
  transaction = <T>(cb: (m: unknown) => Promise<T>): Promise<T> => {
    const next = this.chain.then(() => cb(this.manager));
    this.chain = next.catch(() => undefined);
    return next;
  };
}

function setup(quota = 280) {
  const table = new Table();
  const cfg: SoftLaunchConfig = { enabled: true, start: START, end: END, quota };
  const dataSource = { manager: table.manager, transaction: table.transaction };
  const service = new SoftLaunchService(dataSource as any, { get: () => cfg } as any);
  const allocate = (userId: string) =>
    table.transaction((m) =>
      allocateParticipant(m as any, {
        userId,
        quota,
        window: WINDOW,
        source: SoftLaunchAllocationSource.REGISTRATION,
      }),
    );
  return { table, cfg, service, allocate };
}

beforeEach(() => jest.useFakeTimers({ now: NOW }));
afterEach(() => jest.useRealTimers());

describe('quota counts only the current campaign window', () => {
  it('A. 80 historical rows, 0 current, quota 280 → not full', async () => {
    const { table, service, allocate } = setup();
    table.seed(80, SEPTEMBER, 'sep');

    await expect(service.viewFor('newcomer')).resolves.toMatchObject({ quota_full: false });
    await expect(allocate('newcomer')).resolves.toMatchObject({ kind: 'allocated', created: true });
  });

  it('B. 44 current, quota 280 → allocation succeeds', async () => {
    const { table, allocate } = setup();
    table.seed(44, NOW, 'oct');
    await expect(allocate('u-new')).resolves.toMatchObject({ kind: 'allocated', created: true });
    expect(table.current()).toBe(45);
  });

  it('C. 280 current, quota 280 → full, nothing written', async () => {
    const { table, service, allocate } = setup();
    table.seed(280, NOW, 'oct');
    await expect(allocate('u-late')).resolves.toEqual({ kind: 'full' });
    expect(table.rows).toHaveLength(280);
    await expect(service.viewFor('u-late')).resolves.toMatchObject({ quota_full: true });
  });

  it('D. 500 historical + 10 current, quota 280 → NOT full (global count irrelevant)', async () => {
    const { table, service, allocate } = setup();
    table.seed(500, SEPTEMBER, 'sep');
    table.seed(10, NOW, 'oct');
    await expect(service.viewFor('someone')).resolves.toMatchObject({ quota_full: false });
    await expect(allocate('u-new')).resolves.toMatchObject({ kind: 'allocated' });
  });

  it('the 281st current-window attempt creates no row', async () => {
    const { table, allocate } = setup();
    table.seed(80, SEPTEMBER, 'sep');
    table.seed(279, NOW, 'oct');
    await expect(allocate('u-280')).resolves.toMatchObject({ kind: 'allocated' });
    await expect(allocate('u-281')).resolves.toEqual({ kind: 'full' });
    expect(table.current()).toBe(280);
    expect(table.rows.some((r) => r.user_id === 'u-281')).toBe(false);
  });
});

describe('slot_no stays globally unique; quota is campaign-scoped', () => {
  it('after slots 1..80, the new campaign gets 81 then 82 while counting 1 then 2', async () => {
    const { table, allocate } = setup();
    table.seed(80, SEPTEMBER, 'sep');

    const first = await allocate('oct-1');
    const second = await allocate('oct-2');

    expect(first.kind === 'allocated' && first.participant.slot_no).toBe(81);
    expect(second.kind === 'allocated' && second.participant.slot_no).toBe(82);
    expect(table.rows).toHaveLength(82); // global
    expect(table.current()).toBe(2); // campaign
    expect(first.kind === 'allocated' && first.participant.code).toMatch(CODE_PATTERN);
    expect(new Set(table.rows.map((r) => r.code)).size).toBe(82);
  });
});

describe('concurrency at the quota boundary (serialised like the advisory lock)', () => {
  it('279 current + 20 concurrent attempts → exactly one more, final 280', async () => {
    const { table, allocate } = setup();
    table.seed(80, SEPTEMBER, 'sep');
    table.seed(279, NOW, 'oct');

    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => allocate(`racer-${i}`)));

    expect(results.filter((r) => r.kind === 'allocated')).toHaveLength(1);
    expect(results.filter((r) => r.kind === 'full')).toHaveLength(19);
    expect(table.current()).toBe(280);
    for (const k of ['user_id', 'code', 'slot_no']) {
      expect(new Set(table.rows.map((r) => r[k])).size).toBe(table.rows.length);
    }
  });
});

describe('eligibility = a participant row allocated inside the current window', () => {
  it.each([
    ['A. historical only (September)', SEPTEMBER, false],
    ['B. inside the window', NOW, true],
    ['C. exactly START', START, true],
    ['D. exactly END', END, true],
    ['E. 1 ms before START', new Date(START.getTime() - 1), false],
    ['F. after END', new Date(END.getTime() + 1000), false],
  ])('%s → eligible=%s', async (_l, allocatedAt, eligible) => {
    const { table, service } = setup();
    table.rows.push({
      id: 'p1',
      user_id: 'u1',
      code: 'KLAB-SL-ABC234',
      slot_no: 1,
      allocated_at: allocatedAt,
    });

    const view = await service.viewFor('u1');
    expect(view.eligible).toBe(eligible);
    expect(view.participant_code).toBe(eligible ? 'KLAB-SL-ABC234' : null);
    expect(view.allocated_at).toEqual(eligible ? allocatedAt : null);
  });

  it('a historical participant cannot be re-allocated (UQ(user_id)) — previous_campaign, no write', async () => {
    const { table, allocate } = setup();
    table.seed(1, SEPTEMBER, 'sep');
    const historicalUser = table.rows[0].user_id;

    await expect(allocate(historicalUser)).resolves.toEqual({ kind: 'previous_campaign' });
    expect(table.rows).toHaveLength(1);
  });

  it('a current participant re-allocating is idempotent', async () => {
    const { table, allocate } = setup();
    await allocate('u1');
    await expect(allocate('u1')).resolves.toMatchObject({ kind: 'allocated', created: false });
    expect(table.rows).toHaveLength(1);
  });
});

describe('checkBooking (direct booking, waitlist join, promotion)', () => {
  it('historical participant → 403 SOFT_LAUNCH_NOT_ELIGIBLE during the active window', async () => {
    const { table, service } = setup();
    table.rows.push({
      id: 'p1',
      user_id: 'u-sep',
      code: 'C1',
      slot_no: 1,
      allocated_at: SEPTEMBER,
    });
    const err = await service
      .checkBooking(table.manager as any, 'u-sep', IN_WINDOW_CLASS)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getResponse()).toMatchObject({ code: SOFT_LAUNCH_NOT_ELIGIBLE });
  });

  it('current-window participant → bypass (true)', async () => {
    const { table, service } = setup();
    table.rows.push({ id: 'p1', user_id: 'u-oct', code: 'C1', slot_no: 1, allocated_at: NOW });
    await expect(
      service.checkBooking(table.manager as any, 'u-oct', IN_WINDOW_CLASS),
    ).resolves.toBe(true);
  });

  it('non-participant → same existing 403', async () => {
    const { table, service } = setup();
    await expect(
      service.checkBooking(table.manager as any, 'nobody', IN_WINDOW_CLASS),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('outside the active window → normal rules (false), even for a historical participant', async () => {
    const { table, service } = setup();
    table.rows.push({
      id: 'p1',
      user_id: 'u-sep',
      code: 'C1',
      slot_no: 1,
      allocated_at: SEPTEMBER,
    });
    jest.setSystemTime(new Date(END.getTime() + 60_000));
    await expect(
      service.checkBooking(table.manager as any, 'u-sep', new Date('2026-10-20T09:00:00+07:00')),
    ).resolves.toBe(false);
  });
});

describe('allocation opens only inside the window', () => {
  it('registration before START allocates nothing (would be outside the campaign)', async () => {
    const { table, service } = setup();
    jest.setSystemTime(new Date(START.getTime() - 1));
    await service.tryAllocateOnRegistration('early-bird');
    expect(table.rows).toHaveLength(0);
    jest.setSystemTime(START);
    await service.tryAllocateOnRegistration('on-time');
    expect(table.rows.map((r) => r.user_id)).toEqual(['on-time']);
  });
});

describe('admin summary is current-campaign', () => {
  it('80 historical + 44 current, quota 280 → allocated 44, remaining 236', async () => {
    const { service } = setup();
    // The SQL window filter itself is exercised against real Postgres in the smoke.
    (service as any).queryAdminViews = jest.fn(async () => Array.from({ length: 44 }, () => ({})));
    const { summary } = await service.listForAdmin();
    expect(summary).toMatchObject({
      quota: 280,
      allocated: 44,
      remaining: 236,
      start: START,
      end: END,
    });
  });
});

describe('config', () => {
  it('SOFT_LAUNCH_QUOTA=280 is parsed as the number 280, with the window as instants', () => {
    const before = { ...process.env };
    Object.assign(process.env, {
      SOFT_LAUNCH_ENABLED: 'true',
      SOFT_LAUNCH_START: '2026-10-07T00:00:00+07:00',
      SOFT_LAUNCH_END: '2026-10-11T23:59:59+07:00',
      SOFT_LAUNCH_QUOTA: '280',
    });
    try {
      const cfg = (softLaunchConfig as unknown as () => SoftLaunchConfig)();
      expect(cfg.quota).toBe(280);
      expect(typeof cfg.quota).toBe('number');
      expect(cfg.start?.toISOString()).toBe('2026-10-06T17:00:00.000Z');
      expect(cfg.end?.toISOString()).toBe('2026-10-11T16:59:59.000Z');
    } finally {
      process.env = before;
    }
  });
});
