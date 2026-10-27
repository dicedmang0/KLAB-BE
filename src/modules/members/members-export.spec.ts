import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Response } from 'express';
import { ExportMembersDto } from './dto/export-members.dto';
import { Member } from './entities/member.entity';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';

const options: ExportMembersDto = {
  package_name: 'Migration, "Private"',
  date_purchased: '2026-10-27',
  classes_left: 0,
  expiry_date: '2026-12-31',
};
const header =
  'Email,Full name,Package name,Date purchased,Classes left,Expiry date,Price (optional),Renewal cycles left (optional)';

describe('Vibefam member migration CSV', () => {
  const query = jest.fn();
  const service = new MembersService({ query } as unknown as Repository<Member>);

  beforeEach(() => query.mockReset());

  it('matches the eight-column template, escapes CSV values, and preserves Unicode and line breaks', async () => {
    query.mockResolvedValue([
      { email: ' alice@example.com ', full_name: ' Alice, "李"\nTan ' },
      { email: 'bob@example.com', full_name: 'Bob' },
    ]);

    expect(await service.exportForVibefam(options)).toBe(
      header +
        '\r\n' +
        '"alice@example.com","Alice, ""李""\nTan","Migration, ""Private""","27/10/2026","0","31/12/2026",,\r\n' +
        '"bob@example.com","Bob","Migration, ""Private""","27/10/2026","0","31/12/2026",,\r\n',
    );
  });

  it.each([
    { email: null, full_name: 'Alice' },
    { email: 'invalid', full_name: 'Alice' },
    { email: 'alice@example.com', full_name: '   ' },
    { email: 'alice@example.com', full_name: null },
  ])('blocks an incomplete identity rather than silently omitting it: %j', async (member) => {
    query.mockResolvedValue([member]);
    await expect(service.exportForVibefam(options)).rejects.toThrow('1 member(s)');
  });

  it('blocks duplicate emails case-insensitively after trimming', async () => {
    query.mockResolvedValue([
      { email: 'Alice@example.com', full_name: 'Alice' },
      { email: ' alice@example.com ', full_name: 'Another Alice' },
    ]);
    await expect(service.exportForVibefam(options)).rejects.toThrow('1 duplicate email(s)');
  });

  it('blocks an empty export', async () => {
    query.mockResolvedValue([]);
    await expect(service.exportForVibefam(options)).rejects.toThrow('No members to export');
  });

  it('rejects expiry before purchase without querying identities', async () => {
    await expect(
      service.exportForVibefam({ ...options, expiry_date: '2026-10-26' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns a CSV attachment and requires members:read', async () => {
    query.mockResolvedValue([{ email: 'alice@example.com', full_name: 'Alice' }]);
    const controller = new MembersController(service, null);
    const res = { setHeader: jest.fn(), send: jest.fn() };
    await controller.exportVibefam(options, res as unknown as Response);

    expect(Reflect.getMetadata(PERMISSIONS_KEY, controller.exportVibefam)).toEqual([
      'members:read',
    ]);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="klab-members-vibefam-2026-10-27.csv"',
    );
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining(header + '\r\n'));
  });
});

describe('migration request validation', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const validate = (value: unknown) =>
    pipe.transform(value, { type: 'body', metatype: ExportMembersDto });

  it('trims the exact package name and accepts zero classes and leap days', async () => {
    await expect(
      validate({
        ...options,
        package_name: '  Private Migration  ',
        date_purchased: '2028-02-29',
        expiry_date: '2028-02-29',
      }),
    ).resolves.toMatchObject({ package_name: 'Private Migration', classes_left: 0 });
  });

  it.each([
    { package_name: '  ' },
    { package_name: 'x'.repeat(201) },
    { date_purchased: '2026-02-30' },
    { date_purchased: '27/10/2026' },
    { date_purchased: '2026-10-27T00:00:00Z' },
    { expiry_date: '' },
    { expiry_date: '2026-02-29' },
    { classes_left: -1 },
    { classes_left: 1.5 },
    { classes_left: '1' },
    { classes_left: Number.MAX_SAFE_INTEGER + 1 },
    { password: 'must-not-export' },
  ])('rejects invalid migration values: %j', async (override) => {
    await expect(validate({ ...options, ...override })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires every migration field', async () => {
    await expect(validate({})).rejects.toBeInstanceOf(BadRequestException);
  });
});
