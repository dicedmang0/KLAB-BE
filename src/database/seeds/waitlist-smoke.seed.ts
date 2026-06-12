import { DataSource, EntityManager, In } from 'typeorm';
import { Room, RoomStatus } from '../../modules/rooms/entities/room.entity';
import {
  Instructor,
  InstructorStatus,
} from '../../modules/instructors/entities/instructor.entity';
import { ClassType, ClassTypeStatus } from '../../modules/class-types/entities/class-type.entity';
import { Member, MemberStatus } from '../../modules/members/entities/member.entity';
import { Schedule, ScheduleStatus } from '../../modules/schedules/entities/schedule.entity';
import {
  Booking,
  BookingStatus,
  AttendanceStatus,
  BookingSource,
} from '../../modules/bookings/entities/booking.entity';
import { CreditLedger } from '../../modules/credits/entities/credit-ledger.entity';

/**
 * LOCAL/DEV-ONLY waitlist smoke seed.
 *
 * Creates a small, self-contained fixture set so the Admin "Waitlist Management"
 * UI (FE Phase 5) can be exercised end-to-end without real data:
 *
 *   A. Promotable entry      → POST /admin/waitlist/:id/promote  succeeds (200)
 *   B. Full-class entry      → POST /admin/waitlist/:id/promote  fails 409 (full)
 *   C. Insufficient-credit   → POST /admin/waitlist/:id/promote  fails 400 (credit)
 *   D. Removable entry       → POST /admin/bookings/:id/cancel   cancels it
 *
 * A waitlist entry is just a `bookings` row with status='waitlisted' and a
 * waitlist_position — there is no separate waitlist table. This seed never calls
 * or mutates the production booking/waitlist services; it writes fixture rows
 * directly and is safe to run repeatedly (see "Idempotency" below).
 *
 * Idempotency: every fixture is keyed by a recognizable, stable identifier
 * (unique emails, room/instructor names, booking codes). On each run the master
 * rows and member balances are reconciled in place, and the seed bookings plus
 * the seed members' ledger rows are deleted and recreated — so re-running never
 * duplicates rows and always restores the baseline, even after a smoke test has
 * promoted/cancelled an entry.
 */

// All seeded names/emails are prefixed so they are obvious in the admin UI and
// trivially distinguishable from real data.
const ROOM_NAME = 'Smoke Waitlist Room';
const INSTRUCTOR_EMAIL = 'smoke.waitlist.instructor@klab.test';
const CLASS_TYPE_NAME = 'Smoke Waitlist Class Type';
const CREDIT_COST = 1; // class credit cost — drives the credit-sufficiency scenarios

// Capacities chosen so one schedule always has an open seat and the other is full.
const OPEN_CAPACITY = 2; // 0 confirmed → free seats (scenarios A, C, D)
const FULL_CAPACITY = 1; // 1 confirmed filler → no free seats (scenario B)

interface MemberSpec {
  key: string;
  email: string;
  firstName: string;
  lastName: string;
  creditBalance: number;
}

const MEMBERS: Record<string, MemberSpec> = {
  filler: {
    key: 'filler',
    email: 'smoke.waitlist.filler@klab.test',
    firstName: 'Smoke Waitlist',
    lastName: 'Filler',
    creditBalance: 5,
  },
  promotable: {
    key: 'promotable',
    email: 'smoke.waitlist.promotable@klab.test',
    firstName: 'Smoke Waitlist',
    lastName: 'Promotable',
    creditBalance: 5,
  },
  fullClass: {
    key: 'fullClass',
    email: 'smoke.waitlist.full@klab.test',
    firstName: 'Smoke Waitlist',
    lastName: 'FullClass',
    creditBalance: 5,
  },
  insufficient: {
    key: 'insufficient',
    email: 'smoke.waitlist.insufficient@klab.test',
    firstName: 'Smoke Waitlist',
    lastName: 'Insufficient',
    creditBalance: 0, // < CREDIT_COST → promote must fail 400
  },
  removable: {
    key: 'removable',
    email: 'smoke.waitlist.removable@klab.test',
    firstName: 'Smoke Waitlist',
    lastName: 'Removable',
    creditBalance: 5,
  },
};

// Fixed booking codes so re-runs target the same rows (delete + recreate).
const BOOKING_CODES = {
  filler: 'BK-SMOKE-WL-FILLER',
  promote: 'BK-SMOKE-WL-PROMOTE',
  full: 'BK-SMOKE-WL-FULL',
  insufficient: 'BK-SMOKE-WL-INSUFF',
  removable: 'BK-SMOKE-WL-REMOVE',
};

const ALL_BOOKING_CODES = Object.values(BOOKING_CODES);

function assertDevEnvironment(): void {
  const env = (process.env.APP_ENV ?? process.env.NODE_ENV ?? '').toLowerCase();
  if (env === 'production' || env === 'staging') {
    throw new Error(
      `[waitlist-smoke] refusing to run: APP_ENV/NODE_ENV is "${env}". ` +
        'This seed is local/dev-only.',
    );
  }
}

export async function seedWaitlistSmoke(dataSource: DataSource): Promise<void> {
  assertDevEnvironment();

  const summary = await dataSource.transaction(async (manager) => {
    // ── Master data (find-or-create, reconcile in place) ──────────────────────
    const room = await upsertRoom(manager);
    const instructor = await upsertInstructor(manager);
    const classType = await upsertClassType(manager);

    // ── Members (find-or-create by email, reconcile balance) ──────────────────
    const members: Record<string, Member> = {};
    for (const spec of Object.values(MEMBERS)) {
      members[spec.key] = await upsertMember(manager, spec);
    }

    // ── Schedules (one open, one full; both published + in the future) ────────
    const start = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // +7 days
    const openSchedule = await upsertSchedule(manager, {
      classTypeId: classType.id,
      instructorId: instructor.id,
      roomId: room.id,
      capacity: OPEN_CAPACITY,
      start,
    });
    const fullSchedule = await upsertSchedule(manager, {
      classTypeId: classType.id,
      instructorId: instructor.id,
      roomId: room.id,
      capacity: FULL_CAPACITY,
      start,
    });

    // ── Reset prior fixture bookings + this seed's ledger rows ─────────────────
    // Order matters: ledger rows reference bookings, so clear them first. Both
    // FKs are ON DELETE SET NULL, but explicit cleanup keeps balances reconciled
    // and lets bookings be recreated cleanly. Dev-only fixture data.
    const memberIds = Object.values(members).map((m) => m.id);
    await manager.delete(CreditLedger, { member_id: In(memberIds) });
    await manager.delete(Booking, { booking_code: In(ALL_BOOKING_CODES) });

    // ── Fixture bookings ──────────────────────────────────────────────────────
    // B (filler): a CONFIRMED booking that fills the full schedule to capacity.
    await manager.save(
      Booking,
      manager.create(Booking, {
        booking_code: BOOKING_CODES.filler,
        member_id: members.filler.id,
        schedule_id: fullSchedule.id,
        status: BookingStatus.CONFIRMED,
        attendance_status: AttendanceStatus.NOT_CHECKED_IN,
        source: BookingSource.ADMIN,
        credit_cost: CREDIT_COST,
      }),
    );

    // A: promotable waitlist entry on the open schedule (member has credit).
    const promote = await manager.save(
      Booking,
      manager.create(Booking, {
        booking_code: BOOKING_CODES.promote,
        member_id: members.promotable.id,
        schedule_id: openSchedule.id,
        status: BookingStatus.WAITLISTED,
        attendance_status: AttendanceStatus.NOT_CHECKED_IN,
        source: BookingSource.MEMBER,
        credit_cost: CREDIT_COST,
        waitlist_position: 1,
      }),
    );

    // B: waitlist entry on the FULL schedule (member has credit → blocked by 409).
    const full = await manager.save(
      Booking,
      manager.create(Booking, {
        booking_code: BOOKING_CODES.full,
        member_id: members.fullClass.id,
        schedule_id: fullSchedule.id,
        status: BookingStatus.WAITLISTED,
        attendance_status: AttendanceStatus.NOT_CHECKED_IN,
        source: BookingSource.MEMBER,
        credit_cost: CREDIT_COST,
        waitlist_position: 1,
      }),
    );

    // C: waitlist entry on the open schedule, member has 0 credit → blocked by 400.
    const insufficient = await manager.save(
      Booking,
      manager.create(Booking, {
        booking_code: BOOKING_CODES.insufficient,
        member_id: members.insufficient.id,
        schedule_id: openSchedule.id,
        status: BookingStatus.WAITLISTED,
        attendance_status: AttendanceStatus.NOT_CHECKED_IN,
        source: BookingSource.MEMBER,
        credit_cost: CREDIT_COST,
        waitlist_position: 2,
      }),
    );

    // D: an extra waitlist entry on the open schedule, safe to cancel/remove.
    const removable = await manager.save(
      Booking,
      manager.create(Booking, {
        booking_code: BOOKING_CODES.removable,
        member_id: members.removable.id,
        schedule_id: openSchedule.id,
        status: BookingStatus.WAITLISTED,
        attendance_status: AttendanceStatus.NOT_CHECKED_IN,
        source: BookingSource.MEMBER,
        credit_cost: CREDIT_COST,
        waitlist_position: 3,
      }),
    );

    return {
      openScheduleId: openSchedule.id,
      fullScheduleId: fullSchedule.id,
      promoteBookingId: promote.id,
      fullBookingId: full.id,
      insufficientBookingId: insufficient.id,
      removableBookingId: removable.id,
    };
  });

  console.log('[waitlist-smoke] Seed complete. Fixture IDs:');
  console.log(`  Open schedule (free seats):  ${summary.openScheduleId}`);
  console.log(`  Full schedule (at capacity): ${summary.fullScheduleId}`);
  console.log('  Waitlist entries:');
  console.log(
    `    A promote-OK   (${BOOKING_CODES.promote})  booking_id=${summary.promoteBookingId}`,
  );
  console.log(
    `    B full-409     (${BOOKING_CODES.full})     booking_id=${summary.fullBookingId}`,
  );
  console.log(
    `    C credit-400   (${BOOKING_CODES.insufficient})    booking_id=${summary.insufficientBookingId}`,
  );
  console.log(
    `    D removable    (${BOOKING_CODES.removable})    booking_id=${summary.removableBookingId}`,
  );
  console.log('  Verify:  GET /admin/bookings?status=waitlisted');
}

// ── upsert helpers ───────────────────────────────────────────────────────────

async function upsertRoom(manager: EntityManager): Promise<Room> {
  let room = await manager.findOne(Room, { where: { name: ROOM_NAME } });
  if (!room) {
    room = manager.create(Room, {
      name: ROOM_NAME,
      description: 'Local/dev waitlist smoke-test room',
      capacity: 10,
      status: RoomStatus.ACTIVE,
    });
  } else {
    room.status = RoomStatus.ACTIVE;
  }
  return manager.save(Room, room);
}

async function upsertInstructor(manager: EntityManager): Promise<Instructor> {
  let instructor = await manager.findOne(Instructor, { where: { email: INSTRUCTOR_EMAIL } });
  if (!instructor) {
    instructor = manager.create(Instructor, {
      first_name: 'Smoke Waitlist',
      last_name: 'Instructor',
      email: INSTRUCTOR_EMAIL,
      status: InstructorStatus.ACTIVE,
    });
  } else {
    instructor.status = InstructorStatus.ACTIVE;
  }
  return manager.save(Instructor, instructor);
}

async function upsertClassType(manager: EntityManager): Promise<ClassType> {
  let classType = await manager.findOne(ClassType, { where: { name: CLASS_TYPE_NAME } });
  if (!classType) {
    classType = manager.create(ClassType, {
      name: CLASS_TYPE_NAME,
      category: 'Smoke Test',
      level: 'all',
      duration_minutes: 60,
      description: 'Local/dev waitlist smoke-test class type',
      default_capacity: OPEN_CAPACITY,
      default_price_idr: 0,
      credit_cost: CREDIT_COST,
      is_published: true,
      status: ClassTypeStatus.ACTIVE,
    });
  } else {
    classType.credit_cost = CREDIT_COST;
    classType.is_published = true;
    classType.status = ClassTypeStatus.ACTIVE;
  }
  return manager.save(ClassType, classType);
}

async function upsertMember(manager: EntityManager, spec: MemberSpec): Promise<Member> {
  let member = await manager.findOne(Member, { where: { email: spec.email } });
  if (!member) {
    member = manager.create(Member, {
      first_name: spec.firstName,
      last_name: spec.lastName,
      email: spec.email,
      status: MemberStatus.ACTIVE,
      credit_balance: spec.creditBalance,
    });
  } else {
    member.first_name = spec.firstName;
    member.last_name = spec.lastName;
    member.status = MemberStatus.ACTIVE;
    member.credit_balance = spec.creditBalance; // reconcile to baseline every run
  }
  return manager.save(Member, member);
}

async function upsertSchedule(
  manager: EntityManager,
  opts: {
    classTypeId: string;
    instructorId: string;
    roomId: string;
    capacity: number;
    start: Date;
  },
): Promise<Schedule> {
  const end = new Date(opts.start.getTime() + 60 * 60 * 1000);
  // The seed's class_type + room + capacity combination uniquely identifies each
  // of the two fixture schedules (open=cap 2, full=cap 1), so re-runs reconcile
  // the same row instead of creating new ones.
  let schedule = await manager.findOne(Schedule, {
    where: {
      class_type_id: opts.classTypeId,
      room_id: opts.roomId,
      capacity: opts.capacity,
    },
  });
  if (!schedule) {
    schedule = manager.create(Schedule, {
      class_type_id: opts.classTypeId,
      instructor_id: opts.instructorId,
      room_id: opts.roomId,
      start_time: opts.start,
      end_time: end,
      capacity: opts.capacity,
      status: ScheduleStatus.PUBLISHED,
      is_published: true,
    });
  } else {
    schedule.instructor_id = opts.instructorId;
    schedule.start_time = opts.start; // keep it in the future on every run
    schedule.end_time = end;
    schedule.status = ScheduleStatus.PUBLISHED;
    schedule.is_published = true;
  }
  return manager.save(Schedule, schedule);
}
