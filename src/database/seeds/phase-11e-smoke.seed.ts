import * as bcrypt from 'bcrypt';
import { DataSource, EntityManager, In } from 'typeorm';
import { User, UserStatus } from '../../modules/users/entities/user.entity';
import { Member, MemberStatus } from '../../modules/members/entities/member.entity';
import { Role } from '../../modules/roles/entities/role.entity';
import { Room, RoomStatus } from '../../modules/rooms/entities/room.entity';
import {
  Instructor,
  InstructorStatus,
} from '../../modules/instructors/entities/instructor.entity';
import {
  ClassType,
  ClassTypeStatus,
} from '../../modules/class-types/entities/class-type.entity';
import {
  Schedule,
  ScheduleStatus,
} from '../../modules/schedules/entities/schedule.entity';
import {
  Booking,
  BookingStatus,
  AttendanceStatus,
  BookingSource,
} from '../../modules/bookings/entities/booking.entity';
import { CreditLedger } from '../../modules/credits/entities/credit-ledger.entity';

/**
 * LOCAL/DEV-ONLY Phase 11E smoke test fixture.
 *
 * Creates the seven QA user accounts (User + Member pairs) and the two QA
 * schedules needed to exercise every Phase 11E booking/waitlist scenario in the
 * browser without requiring real member data.
 *
 * Scenarios covered:
 *   C  Booking success          → qa.booking.success@klab.test        (credits=10)
 *   D  Duplicate booking        → qa.duplicate.booking@klab.test      (pre-existing confirmed booking)
 *   E  Insufficient credit      → qa.low.credit@klab.test             (credits=0)
 *   G  Waitlist success         → qa.waitlist.success@klab.test       (full schedule, no prior entry)
 *   H  Duplicate waitlist       → qa.duplicate.waitlist@klab.test     (pre-existing waitlist entry)
 *   I  Inactive member 403      → qa.inactive.member@klab.test        (member.status=inactive)
 *   B  Login redirect           → qa.redirect@klab.test               (clean active user)
 *
 * Idempotency:
 *   - Users and Members are upserted by email; credit balances are reconciled to
 *     their baseline values on every run.
 *   - Schedules are upserted by (class_type + room + capacity); start/end times
 *     are pushed +7 days from now on every run to keep them in the future.
 *   - Fixture bookings are deleted by booking_code and recreated, so re-running
 *     always restores the baseline even after a test changed them.
 *   - Credit ledger rows for seed members are deleted before recreating bookings
 *     to prevent ledger/balance drift from actual API calls during testing.
 *
 * Safety:
 *   assertDevEnvironment() refuses to run if NODE_ENV/APP_ENV is production or
 *   staging. All emails use the @klab.test domain.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const QA_PASSWORD = 'KlabSmokeTest123!';
const BCRYPT_ROUNDS = 12;

const QA_ROOM_NAME = 'QA Smoke Test Room';
const QA_INSTRUCTOR_EMAIL = 'qa.smoke.instructor@klab.test';
const QA_CLASS_TYPE_NAME = 'QA Smoke Test Class';

// credit_cost=2 so that qa.low.credit (balance=0) cannot book
const QA_CREDIT_COST = 2;
// capacity=5: room for the duplicate-booking fixture (1 slot) + 4 free slots
const AVAILABLE_CAPACITY = 5;
// capacity=1: one filler confirmed booking makes this full
const FULL_CAPACITY = 1;

// start 09:00 WIB (02:00 UTC) and 10:00 WIB (03:00 UTC) on the fixture date
const AVAILABLE_START_HOUR_UTC = 2;
const FULL_START_HOUR_UTC = 3;

// Stable booking codes so re-runs target and delete the same fixture rows
const BOOKING_CODES = {
  dupeBooking: 'BK-QA11E-DUPE-BOOK', // confirmed booking for qa.duplicate.booking
  fullFiller: 'BK-QA11E-FULL-FILL',  // confirmed booking that fills the full schedule
  dupeWaitlist: 'BK-QA11E-DUPE-WAIT', // waitlist entry for qa.duplicate.waitlist
} as const;

const ALL_FIXTURE_BOOKING_CODES = Object.values(BOOKING_CODES);

// ── Member specs ──────────────────────────────────────────────────────────────

interface QaMemberSpec {
  key: string;
  email: string;
  firstName: string;
  lastName: string;
  userStatus: UserStatus;
  memberStatus: MemberStatus;
  creditBalance: number;
  note: string;
}

const QA_MEMBERS: Record<string, QaMemberSpec> = {
  bookingSuccess: {
    key: 'bookingSuccess',
    email: 'qa.booking.success@klab.test',
    firstName: 'QA Booking',
    lastName: 'Success',
    userStatus: UserStatus.ACTIVE,
    memberStatus: MemberStatus.ACTIVE,
    creditBalance: 10,
    note: 'Scenario C: normal booking success',
  },
  lowCredit: {
    key: 'lowCredit',
    email: 'qa.low.credit@klab.test',
    firstName: 'QA Low',
    lastName: 'Credit',
    userStatus: UserStatus.ACTIVE,
    memberStatus: MemberStatus.ACTIVE,
    creditBalance: 0,
    note: 'Scenario E: booking fails — insufficient credit',
  },
  duplicateBooking: {
    key: 'duplicateBooking',
    email: 'qa.duplicate.booking@klab.test',
    firstName: 'QA Duplicate',
    lastName: 'Booking',
    userStatus: UserStatus.ACTIVE,
    memberStatus: MemberStatus.ACTIVE,
    creditBalance: 10,
    note: 'Scenario D: pre-seeded confirmed booking on the available schedule',
  },
  waitlistSuccess: {
    key: 'waitlistSuccess',
    email: 'qa.waitlist.success@klab.test',
    firstName: 'QA Waitlist',
    lastName: 'Success',
    userStatus: UserStatus.ACTIVE,
    memberStatus: MemberStatus.ACTIVE,
    creditBalance: 5,
    note: 'Scenario G: join waitlist on the full schedule (no prior entry)',
  },
  duplicateWaitlist: {
    key: 'duplicateWaitlist',
    email: 'qa.duplicate.waitlist@klab.test',
    firstName: 'QA Duplicate',
    lastName: 'Waitlist',
    userStatus: UserStatus.ACTIVE,
    memberStatus: MemberStatus.ACTIVE,
    creditBalance: 5,
    note: 'Scenario H: pre-seeded waitlist entry on the full schedule',
  },
  inactiveMember: {
    key: 'inactiveMember',
    email: 'qa.inactive.member@klab.test',
    firstName: 'QA Inactive',
    lastName: 'Member',
    userStatus: UserStatus.ACTIVE,     // login succeeds
    memberStatus: MemberStatus.INACTIVE, // booking/waitlist returns 403
    creditBalance: 5,
    note: 'Scenario I: user.status=active so login works; member.status=inactive so booking returns 403',
  },
  redirect: {
    key: 'redirect',
    email: 'qa.redirect@klab.test',
    firstName: 'QA Redirect',
    lastName: 'Test',
    userStatus: UserStatus.ACTIVE,
    memberStatus: MemberStatus.ACTIVE,
    creditBalance: 5,
    note: 'Scenario B: login-redirect flow — /login?redirect=/schedule',
  },
  // Internal filler: holds the confirmed booking that brings the full schedule to capacity.
  // Not listed as a primary test user but required for the full-schedule fixture.
  fullFiller: {
    key: 'fullFiller',
    email: 'qa.full.class.filler@klab.test',
    firstName: 'QA Full',
    lastName: 'Filler',
    userStatus: UserStatus.ACTIVE,
    memberStatus: MemberStatus.ACTIVE,
    creditBalance: 5,
    note: 'Internal: filler that occupies the single slot in the full schedule',
  },
};

// ── Environment guard ─────────────────────────────────────────────────────────

function assertDevEnvironment(): void {
  const env = (process.env.APP_ENV ?? process.env.NODE_ENV ?? '').toLowerCase();
  if (env === 'production' || env === 'staging') {
    throw new Error(
      `[phase-11e-smoke] refusing to run: APP_ENV/NODE_ENV is "${env}". ` +
        'This seed is local/dev-only.',
    );
  }
}

// ── Public entrypoint ─────────────────────────────────────────────────────────

export async function seedPhase11eSmoke(dataSource: DataSource): Promise<void> {
  assertDevEnvironment();

  console.log('[phase-11e-smoke] Hashing QA password...');
  const passwordHash = await bcrypt.hash(QA_PASSWORD, BCRYPT_ROUNDS);

  const summary = await dataSource.transaction(async (manager) => {
    // ── Prerequisite: member role ───────────────────────────────────────────
    const memberRole = await manager.findOne(Role, { where: { name: 'member' } });
    if (!memberRole) {
      throw new Error(
        '[phase-11e-smoke] "member" role not found. Run: npm run seed first.',
      );
    }

    // ── Shared QA master data ───────────────────────────────────────────────
    const room       = await upsertRoom(manager);
    const instructor = await upsertInstructor(manager);
    const classType  = await upsertClassType(manager);

    // ── All QA users + members ──────────────────────────────────────────────
    const members: Record<string, Member> = {};
    for (const spec of Object.values(QA_MEMBERS)) {
      const { member } = await upsertUserAndMember(
        manager,
        spec,
        memberRole.id,
        passwordHash,
      );
      members[spec.key] = member;
    }

    // ── QA schedules ────────────────────────────────────────────────────────
    const baseDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const availableSchedule = await upsertSchedule(manager, {
      classTypeId:  classType.id,
      instructorId: instructor.id,
      roomId:       room.id,
      capacity:     AVAILABLE_CAPACITY,
      baseDate,
      startHourUTC: AVAILABLE_START_HOUR_UTC,
    });

    const fullSchedule = await upsertSchedule(manager, {
      classTypeId:  classType.id,
      instructorId: instructor.id,
      roomId:       room.id,
      capacity:     FULL_CAPACITY,
      baseDate,
      startHourUTC: FULL_START_HOUR_UTC,
    });

    // ── Reset fixture bookings + seed-member ledger rows ────────────────────
    // Ledger rows must be deleted before bookings (FK integrity).
    const seedMemberIds = Object.values(members).map((m) => m.id);
    await manager.delete(CreditLedger, { member_id: In(seedMemberIds) });
    await manager.delete(Booking, { booking_code: In(ALL_FIXTURE_BOOKING_CODES) });

    // ── Fixture bookings ─────────────────────────────────────────────────────

    // D: confirmed booking for qa.duplicate.booking on the available schedule.
    //    Occupies 1 of 5 slots → schedule still shows available_slots=4.
    //    Retrying to book as this user triggers 409 "already booked".
    await manager.save(
      Booking,
      manager.create(Booking, {
        booking_code:      BOOKING_CODES.dupeBooking,
        member_id:         members.duplicateBooking.id,
        schedule_id:       availableSchedule.id,
        status:            BookingStatus.CONFIRMED,
        attendance_status: AttendanceStatus.NOT_CHECKED_IN,
        source:            BookingSource.ADMIN,
        credit_cost:       QA_CREDIT_COST,
      }),
    );

    // Internal: filler confirmed booking that fills the capacity-1 full schedule.
    await manager.save(
      Booking,
      manager.create(Booking, {
        booking_code:      BOOKING_CODES.fullFiller,
        member_id:         members.fullFiller.id,
        schedule_id:       fullSchedule.id,
        status:            BookingStatus.CONFIRMED,
        attendance_status: AttendanceStatus.NOT_CHECKED_IN,
        source:            BookingSource.ADMIN,
        credit_cost:       QA_CREDIT_COST,
      }),
    );

    // H: waitlist entry for qa.duplicate.waitlist on the full schedule.
    //    Retrying to join the same waitlist triggers 409 "already waitlisted".
    await manager.save(
      Booking,
      manager.create(Booking, {
        booking_code:      BOOKING_CODES.dupeWaitlist,
        member_id:         members.duplicateWaitlist.id,
        schedule_id:       fullSchedule.id,
        status:            BookingStatus.WAITLISTED,
        attendance_status: AttendanceStatus.NOT_CHECKED_IN,
        source:            BookingSource.MEMBER,
        credit_cost:       QA_CREDIT_COST,
        waitlist_position: 1,
      }),
    );

    return { availableSchedule, fullSchedule };
  });

  // ── Print summary (no passwords, no hashes, no tokens) ───────────────────
  const { availableSchedule, fullSchedule } = summary;
  const fmtTime = (d: Date): string => d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

  console.log('\n[phase-11e-smoke] Seed complete.\n');
  console.log('QA Schedules:');
  console.log(
    `  Available  id=${availableSchedule.id}  capacity=${AVAILABLE_CAPACITY}  start=${fmtTime(availableSchedule.start_time)}`,
  );
  console.log(
    `  Full       id=${fullSchedule.id}  capacity=${FULL_CAPACITY}  start=${fmtTime(fullSchedule.start_time)}`,
  );
  console.log('\nQA Users (all share the same password — see docs/qa/phase-11e-test-users.md):');
  for (const spec of Object.values(QA_MEMBERS)) {
    if (spec.key === 'fullFiller') continue; // internal only, skip in summary
    const statusTag = spec.memberStatus === MemberStatus.INACTIVE ? ' [MEMBER INACTIVE]' : '';
    console.log(`  ${spec.email.padEnd(42)} credits=${spec.creditBalance}${statusTag}`);
  }
  console.log('\nFixture bookings:');
  console.log(`  ${BOOKING_CODES.dupeBooking}  → qa.duplicate.booking on available schedule (CONFIRMED)`);
  console.log(`  ${BOOKING_CODES.fullFiller}   → filler on full schedule (CONFIRMED, fills capacity=1)`);
  console.log(`  ${BOOKING_CODES.dupeWaitlist}  → qa.duplicate.waitlist on full schedule (WAITLISTED pos=1)`);
  console.log('\nVerify: GET /public/schedules  (look for "QA Smoke Test Class" entries)');
}

// ── Upsert helpers ────────────────────────────────────────────────────────────

async function upsertRoom(manager: EntityManager): Promise<Room> {
  let room = await manager.findOne(Room, { where: { name: QA_ROOM_NAME } });
  if (!room) {
    room = manager.create(Room, {
      name:        QA_ROOM_NAME,
      description: 'Local/dev Phase 11E smoke-test room',
      capacity:    AVAILABLE_CAPACITY,
      status:      RoomStatus.ACTIVE,
    });
  } else {
    room.status = RoomStatus.ACTIVE;
  }
  return manager.save(Room, room);
}

async function upsertInstructor(manager: EntityManager): Promise<Instructor> {
  let instructor = await manager.findOne(Instructor, {
    where: { email: QA_INSTRUCTOR_EMAIL },
  });
  if (!instructor) {
    instructor = manager.create(Instructor, {
      first_name: 'QA Smoke',
      last_name:  'Instructor',
      email:      QA_INSTRUCTOR_EMAIL,
      status:     InstructorStatus.ACTIVE,
    });
  } else {
    instructor.status = InstructorStatus.ACTIVE;
  }
  return manager.save(Instructor, instructor);
}

async function upsertClassType(manager: EntityManager): Promise<ClassType> {
  let classType = await manager.findOne(ClassType, {
    where: { name: QA_CLASS_TYPE_NAME },
  });
  if (!classType) {
    classType = manager.create(ClassType, {
      name:             QA_CLASS_TYPE_NAME,
      category:         'QA Smoke Test',
      level:            'All Levels',
      duration_minutes: 60,
      description:      'Local/dev Phase 11E smoke-test class type',
      default_capacity: AVAILABLE_CAPACITY,
      default_price_idr: 0,
      credit_cost:      QA_CREDIT_COST,
      is_published:     true,
      status:           ClassTypeStatus.ACTIVE,
    });
  } else {
    classType.credit_cost  = QA_CREDIT_COST;
    classType.is_published = true;
    classType.status       = ClassTypeStatus.ACTIVE;
  }
  return manager.save(ClassType, classType);
}

async function upsertUserAndMember(
  manager: EntityManager,
  spec: QaMemberSpec,
  memberRoleId: string,
  passwordHash: string,
): Promise<{ user: User; member: Member }> {
  // ── User (auth identity) ────────────────────────────────────────────────
  let user = await manager.findOne(User, { where: { email: spec.email } });
  if (!user) {
    user = manager.create(User, {
      email:         spec.email,
      password_hash: passwordHash,
      full_name:     `${spec.firstName} ${spec.lastName}`,
      status:        spec.userStatus,
      role_id:       memberRoleId,
    });
  } else {
    user.password_hash = passwordHash; // reset to known QA password on every run
    user.full_name     = `${spec.firstName} ${spec.lastName}`;
    user.status        = spec.userStatus;
  }
  user = await manager.save(User, user);

  // ── Member (business identity + credit balance) ─────────────────────────
  let member = await manager.findOne(Member, { where: { email: spec.email } });
  if (!member) {
    member = manager.create(Member, {
      user_id:        user.id,
      email:          spec.email,
      first_name:     spec.firstName,
      last_name:      spec.lastName,
      status:         spec.memberStatus,
      credit_balance: spec.creditBalance,
    });
  } else {
    member.user_id        = user.id;
    member.first_name     = spec.firstName;
    member.last_name      = spec.lastName;
    member.status         = spec.memberStatus;
    member.credit_balance = spec.creditBalance; // reconcile to baseline on every run
  }
  return { user, member: await manager.save(Member, member) };
}

async function upsertSchedule(
  manager: EntityManager,
  opts: {
    classTypeId:  string;
    instructorId: string;
    roomId:       string;
    capacity:     number;
    baseDate:     Date;
    startHourUTC: number;
  },
): Promise<Schedule> {
  const start = new Date(opts.baseDate);
  start.setUTCHours(opts.startHourUTC, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000); // +1 hour

  // Unique key: class_type + room + capacity (mirrors the waitlist-smoke convention)
  let schedule = await manager.findOne(Schedule, {
    where: {
      class_type_id: opts.classTypeId,
      room_id:       opts.roomId,
      capacity:      opts.capacity,
    },
  });
  if (!schedule) {
    schedule = manager.create(Schedule, {
      class_type_id: opts.classTypeId,
      instructor_id: opts.instructorId,
      room_id:       opts.roomId,
      start_time:    start,
      end_time:      end,
      capacity:      opts.capacity,
      status:        ScheduleStatus.PUBLISHED,
      is_published:  true,
    });
  } else {
    schedule.instructor_id = opts.instructorId;
    schedule.start_time    = start; // push forward on every run
    schedule.end_time      = end;
    schedule.status        = ScheduleStatus.PUBLISHED;
    schedule.is_published  = true;
  }
  return manager.save(Schedule, schedule);
}
