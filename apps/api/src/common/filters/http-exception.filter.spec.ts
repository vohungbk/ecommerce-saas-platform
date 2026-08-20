import { ArgumentsHost, BadRequestException, HttpStatus } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

function createHost(url: string) {
  const json = jest.fn<void, [unknown]>();
  const status = jest.fn().mockReturnValue({ json });
  const response = { status };
  const request = { url };

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
}

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
  });

  it('formats an HttpException (e.g. validation error) into the standard shape', () => {
    const { host, status, json } = createHost('/courses');
    const exception = new BadRequestException([
      'title must be longer than or equal to 3 characters',
    ]);

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.BAD_REQUEST,
      error: 'Bad Request',
      message: ['title must be longer than or equal to 3 characters'],
      path: '/courses',
      timestamp: expect.any(String) as string,
    });
  });

  it('maps an unexpected non-HttpException error to a 500 without leaking internals', () => {
    const { host, status, json } = createHost('/courses');
    const exception = new Error('some internal detail, e.g. a stack trace');

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'Internal server error',
      path: '/courses',
      timestamp: expect.any(String) as string,
    });

    const body = json.mock.calls[0][0] as { message: string };
    expect(body.message).not.toContain('stack trace');
  });

  it('produces a valid ISO timestamp string', () => {
    const { host, json } = createHost('/courses');

    filter.catch(new BadRequestException('bad'), host);

    const body = json.mock.calls[0][0] as { timestamp: string };
    expect(() => new Date(body.timestamp).toISOString()).not.toThrow();
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });
});
