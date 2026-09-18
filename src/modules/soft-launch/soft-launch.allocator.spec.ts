import {
  allocateParticipant,
  generateParticipantCode,
  CODE_PATTERN,
} from './soft-launch.allocator';
import { SoftLaunchAllocationSource } from './entities/soft-launch-participant.entity';

function fakeManager() {
  const count = jest.fn().mockResolvedValue(0);
  const repo = {
    findOne: jest.fn().mockResolvedValue(null),
    count,
    exists: jest.fn().mockResolvedValue(false),
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ id: 'p1', allocated_at: new Date(), ...x })),
    // MAX(slot_no) mirrors the mocked count (a clean, never-deleted table).
    createQueryBuilder: () => ({
      select: () => ({ getRawOne: async () => ({ max: await count() }) }),
    }),
  };
  const manager = { query: jest.fn().mockResolvedValue([]), getRepository: () => repo };
  return { manager, repo };
}

const OPTS = { userId: 'u1', quota: 80, source: SoftLaunchAllocationSource.REGISTRATION };

describe('generateParticipantCode', () => {
  it('produces KLAB-SL- + 6 unambiguous chars, never user data', () => {
    for (let i = 0; i < 200; i++) expect(generateParticipantCode()).toMatch(CODE_PATTERN);
  });
});

describe('allocateParticipant', () => {
  it('takes the advisory lock before reading anything', async () => {
    const { manager, repo } = fakeManager();
    await allocateParticipant(manager as any, OPTS);
    expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
      repo.findOne.mock.invocationCallOrder[0],
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock'),
      expect.any(Array),
    );
  });

  it('is idempotent: an allocated user gets the same row back without consuming a slot', async () => {
    const { manager, repo } = fakeManager();
    repo.findOne.mockResolvedValue({ id: 'existing', user_id: 'u1', code: 'KLAB-SL-ABC234' });
    const res = await allocateParticipant(manager as any, OPTS);
    expect(res).toEqual({
      participant: expect.objectContaining({ id: 'existing' }),
      created: false,
    });
    expect(repo.count).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('returns null and writes nothing once the quota is reached', async () => {
    const { manager, repo } = fakeManager();
    repo.count.mockResolvedValue(80);
    await expect(allocateParticipant(manager as any, OPTS)).resolves.toBeNull();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('assigns the next slot (count + 1) and a well-formed code', async () => {
    const { manager, repo } = fakeManager();
    repo.count.mockResolvedValue(79);
    const res = await allocateParticipant(manager as any, {
      ...OPTS,
      source: SoftLaunchAllocationSource.ADMIN,
      allocatedBy: 'admin-1',
    });
    expect(res?.created).toBe(true);
    expect(res?.participant).toMatchObject({
      user_id: 'u1',
      slot_no: 80,
      source: 'admin',
      allocated_by: 'admin-1',
    });
    expect(res?.participant.code).toMatch(CODE_PATTERN);
  });

  it('regenerates on a code collision', async () => {
    const { manager, repo } = fakeManager();
    repo.exists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const res = await allocateParticipant(manager as any, OPTS);
    expect(repo.exists).toHaveBeenCalledTimes(2);
    expect(res?.participant.code).toMatch(CODE_PATTERN);
  });
});
