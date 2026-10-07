import { ConflictException } from '@nestjs/common';
import { FindOperator } from 'typeorm';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { MembersService } from '../members/members.service';
import { SoftLaunchService } from '../soft-launch/soft-launch.service';
import { User } from '../users/entities/user.entity';
import { Member, MemberStatus } from '../members/entities/member.entity';
import { SoftLaunchParticipant } from '../soft-launch/entities/soft-launch-participant.entity';
import { SoftLaunchConfig } from '../../config/soft-launch.config';

jest.mock('bcrypt', () => ({ hash: async () => 'hashed', compare: async () => true }));

/**
 * Registration writes users + members in ONE transaction, then runs soft-launch
 * allocation best-effort after commit. The in-memory DB below gives each
 * transaction a private copy of the tables that replaces the committed state
 * only when the callback resolves (rollback = discard), and enforces the real
 * UNIQUE constraints. Real Postgres rollback is covered by the disposable-DB smoke.
 */

type Row = Record<string, any>;
type Tables = Map<unknown, Row[]>;

const UNIQUE: [unknown, string[]][] = [
  [User, ['email']],
  [Member, ['user_id']],
  [SoftLaunchParticipant, ['user_id', 'code', 'slot_no']],
];

const START = new Date('2026-10-07T00:00:00+07:00');
const END = new Date('2026-10-11T23:59:59+07:00');
const NOW = new Date('2026-10-07T15:00:00+07:00');

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v instanceof FindOperator) {
      const [from, to] = v.value as unknown as [Date, Date];
      const t = new Date(row[k]).getTime();
      return t >= new Date(from).getTime() && t <= new Date(to).getTime();
    }
    return row[k] === v;
  });
}

class Db {
  committed: Tables = new Map(UNIQUE.map(([e]) => [e, []]));
  private seq = 0;

  rows = (entity: unknown) => this.committed.get(entity)!;

  private repo(tables: Tables, entity: unknown) {
    const rows = () => tables.get(entity)!;
    return {
      findOne: async ({ where }: Row) => rows().find((r) => matches(r, where)) ?? null,
      exists: async ({ where }: Row) => rows().some((r) => matches(r, where)),
      count: async (o: Row = {}) => rows().filter((r) => matches(r, o.where)).length,
      create: (x: Row) => ({ ...x }),
      save: async (x: Row) => {
        const keys = UNIQUE.find(([e]) => e === entity)![1];
        for (const k of keys) {
          if (rows().some((r) => r[k] === x[k]))
            throw Object.assign(new Error(k), { code: '23505' });
        }
        const row = { id: `id-${++this.seq}`, allocated_at: new Date(Date.now()), ...x };
        rows().push(row);
        return row;
      },
      createQueryBuilder: () => ({
        select: () => ({
          getRawOne: async () => ({ max: rows().reduce((m, r) => Math.max(m, r.slot_no), 0) }),
        }),
      }),
    };
  }

  managerFor(tables: Tables) {
    return {
      query: async () => [],
      getRepository: (e: unknown) => this.repo(tables, e),
      findOne: (e: unknown, o: Row) => this.repo(tables, e).findOne(o),
      count: (e: unknown, o: Row) => this.repo(tables, e).count(o),
      exists: (e: unknown, o: Row) => this.repo(tables, e).exists(o),
    };
  }

  manager = this.managerFor(this.committed);

  transaction = async <T>(cb: (m: unknown) => Promise<T>): Promise<T> => {
    const draft: Tables = new Map([...this.committed].map(([e, r]) => [e, [...r]]));
    const result = await cb(this.managerFor(draft)); // throws → draft discarded (rollback)
    this.committed = draft;
    this.manager = this.managerFor(this.committed);
    return result;
  };

  getRepository = (e: unknown) => this.repo(this.committed, e);
}

function setup(cfgOverride: Partial<SoftLaunchConfig> = {}) {
  const db = new Db();
  const dataSource = {
    transaction: (cb: any) => db.transaction(cb),
    get manager() {
      return db.manager;
    },
    getRepository: (e: unknown) => db.getRepository(e),
  };
  const cfg: SoftLaunchConfig = {
    enabled: true,
    start: START,
    end: END,
    quota: 280,
    ...cfgOverride,
  };
  const usersService = new UsersService(db.getRepository(User) as any);
  // findByEmail reads committed users through the (re-bound) committed repo.
  jest
    .spyOn(usersService, 'findByEmail')
    .mockImplementation(
      async (email) => (await db.getRepository(User).findOne({ where: { email } })) as any,
    );
  const membersService = new MembersService(null as any);
  const softLaunch = new SoftLaunchService(dataSource as any, { get: () => cfg } as any);
  const roles = { findByName: async () => ({ id: 'role-member', name: 'member' }) };
  const jwt = { sign: () => 'token' };
  const auth = new AuthService(
    usersService,
    roles as any,
    jwt as any,
    softLaunch,
    membersService,
    dataSource as any,
  );
  return { db, auth, membersService, softLaunch };
}

const DTO = {
  email: 'alice@example.com',
  password: 'Secret123!',
  full_name: 'Alice Tan',
  phone: '0812',
};

beforeEach(() => jest.useFakeTimers({ now: NOW }));
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('AuthService.register — users + members invariant', () => {
  it('A. normal registration commits a users row and a members row', async () => {
    const { db, auth } = setup();
    const res = await auth.register(DTO as any);

    expect(db.rows(User)).toHaveLength(1);
    expect(db.rows(Member)).toHaveLength(1);
    expect(res.access_token).toBe('token');
    expect(res.user).not.toHaveProperty('password_hash');
  });

  it('B. member is created by ensureForUser inside the user transaction, with its canonical mapping', async () => {
    const { db, auth, membersService } = setup();
    const ensure = jest.spyOn(membersService, 'ensureForUser');
    await auth.register(DTO as any);

    const [user] = db.rows(User);
    const [member] = db.rows(Member);
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(ensure.mock.calls[0][1]).toBe(user.id);
    expect(member).toMatchObject({
      user_id: user.id,
      first_name: 'Alice Tan',
      email: 'alice@example.com',
      phone: '0812',
      status: MemberStatus.ACTIVE,
      credit_balance: 0,
    });
    expect(member.last_name).toBeUndefined();
  });

  it('soft-launch allocation runs only after users + members are committed', async () => {
    const { db, auth, softLaunch } = setup();
    const seen: number[] = [];
    const real = softLaunch.tryAllocateOnRegistration.bind(softLaunch);
    jest.spyOn(softLaunch, 'tryAllocateOnRegistration').mockImplementation(async (id) => {
      seen.push(db.rows(User).length, db.rows(Member).length);
      return real(id);
    });
    const res = await auth.register(DTO as any);

    expect(seen).toEqual([1, 1]);
    expect(db.rows(SoftLaunchParticipant)).toHaveLength(1);
    expect(res.soft_launch).toMatchObject({ eligible: true, quota_full: false });
  });

  it('C. soft launch full → users + members committed, no participant, quota-full response', async () => {
    const { db, auth } = setup({ quota: 1 });
    db.rows(SoftLaunchParticipant).push({
      id: 'p0',
      user_id: 'someone-else',
      code: 'KLAB-SL-AAAAAA',
      slot_no: 1,
      allocated_at: NOW,
    });
    const res = await auth.register(DTO as any);

    expect(db.rows(User)).toHaveLength(1);
    expect(db.rows(Member)).toHaveLength(1);
    expect(db.rows(SoftLaunchParticipant)).toHaveLength(1);
    expect(res.soft_launch).toMatchObject({ eligible: false, quota_full: true });
  });

  it('D. soft launch disabled → users + members committed, no participant', async () => {
    const { db, auth } = setup({ enabled: false });
    const res = await auth.register(DTO as any);

    expect(db.rows(User)).toHaveLength(1);
    expect(db.rows(Member)).toHaveLength(1);
    expect(db.rows(SoftLaunchParticipant)).toHaveLength(0);
    expect(res.soft_launch).toMatchObject({ enabled: false, eligible: false });
  });

  it('E. member creation failure rolls back the users insert; no soft-launch attempt', async () => {
    const { db, auth, membersService, softLaunch } = setup();
    jest
      .spyOn(membersService, 'ensureForUser')
      .mockRejectedValue(new Error('members insert failed'));
    const allocate = jest.spyOn(softLaunch, 'tryAllocateOnRegistration');

    await expect(auth.register(DTO as any)).rejects.toThrow('members insert failed');
    expect(db.rows(User)).toHaveLength(0);
    expect(db.rows(Member)).toHaveLength(0);
    expect(allocate).not.toHaveBeenCalled();
  });

  it('F. duplicate email → 409 as before, no second user or member', async () => {
    const { db, auth } = setup();
    await auth.register(DTO as any);
    await expect(auth.register(DTO as any)).rejects.toBeInstanceOf(ConflictException);
    expect(db.rows(User)).toHaveLength(1);
    expect(db.rows(Member)).toHaveLength(1);
  });

  it('G. soft-launch allocation throwing → registration still succeeds, users + members kept', async () => {
    const { db, auth, softLaunch } = setup();
    jest.spyOn(softLaunch, 'allocate').mockRejectedValue(new Error('db hiccup'));
    jest.spyOn((softLaunch as any).logger, 'error').mockImplementation(() => undefined);
    const res = await auth.register(DTO as any);

    expect(res.access_token).toBe('token');
    expect(db.rows(User)).toHaveLength(1);
    expect(db.rows(Member)).toHaveLength(1);
    expect(db.rows(SoftLaunchParticipant)).toHaveLength(0);
    expect(res.soft_launch).toMatchObject({ eligible: false });
  });
});
