import { ArgumentsHost, BadRequestException, ForbiddenException } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

function run(exception: unknown) {
  const json = jest.fn<void, [Record<string, unknown>]>();
  const status = jest.fn<{ json: typeof json }, [number]>(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ url: '/member/bookings' }),
    }),
  } as unknown as ArgumentsHost;

  new HttpExceptionFilter().catch(exception, host);
  return { status: status.mock.calls[0][0] as number, body: json.mock.calls[0][0] };
}

describe('HttpExceptionFilter', () => {
  it('passes through an explicit `code` from the exception payload', () => {
    const { status, body } = run(
      new ForbiddenException({ message: 'reserved', code: 'SOFT_LAUNCH_NOT_ELIGIBLE' }),
    );
    expect(status).toBe(403);
    expect(body).toMatchObject({
      statusCode: 403,
      path: '/member/bookings',
      message: 'reserved',
      code: 'SOFT_LAUNCH_NOT_ELIGIBLE',
    });
  });

  it('omits `code` entirely when the payload has none', () => {
    const { body } = run(new BadRequestException('bad input'));
    expect(body.message).toBe('bad input');
    expect(body).not.toHaveProperty('code');
  });

  it('omits `code` when it is falsy and exposes no other payload fields', () => {
    const { body } = run(
      new BadRequestException({ message: 'x', code: '', internal: 'secret', stack: 'trace' }),
    );
    expect(Object.keys(body).sort()).toEqual(['message', 'path', 'statusCode', 'timestamp']);
  });

  it('keeps the 500 fallback for non-HTTP errors without leaking the stack', () => {
    const { status, body } = run(new Error('boom'));
    expect(status).toBe(500);
    expect(body.message).toBe('Internal server error');
    expect(body).not.toHaveProperty('code');
    expect(body).not.toHaveProperty('stack');
  });
});
