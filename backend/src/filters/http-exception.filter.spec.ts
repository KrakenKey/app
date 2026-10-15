import { HttpException, HttpStatus, BadRequestException } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let mockResponse: any;
  let mockRequest: any;
  let mockHost: any;

  beforeEach(() => {
    filter = new HttpExceptionFilter();

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockRequest = {
      method: 'GET',
      url: '/test',
    };
    mockHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    };
  });

  it('handles HttpException with string response', () => {
    const exception = new HttpException('Not found', HttpStatus.NOT_FOUND);

    filter.catch(exception, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(404);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        message: 'Not found',
        error: 'Not Found',
        path: '/test',
      }),
    );
  });

  it('labels a string-message 429 as Too Many Requests', () => {
    const exception = new HttpException(
      'Too many failed API key attempts. Try again later.',
      HttpStatus.TOO_MANY_REQUESTS,
    );

    filter.catch(exception, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(429);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 429,
        error: 'Too Many Requests',
      }),
    );
  });

  it('handles HttpException with object response', () => {
    const exception = new BadRequestException('Validation failed');

    filter.catch(exception, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: 'Validation failed',
      }),
    );
  });

  it('passes plan limit details on, so clients can name the next plan', () => {
    filter.catch(
      new HttpException(
        {
          message: 'Connector limit reached',
          code: 'plan_limit_exceeded',
          limit: 1,
          current: 1,
          plan: 'free',
          upgradeTo: 'pro',
          internal: 'not for clients',
        },
        402,
      ),
      mockHost,
    );

    const body = mockResponse.json.mock.calls[0][0];
    expect(body).toMatchObject({
      statusCode: 402,
      message: 'Connector limit reached',
      code: 'plan_limit_exceeded',
      limit: 1,
      current: 1,
      plan: 'free',
      upgradeTo: 'pro',
    });
    expect(body).not.toHaveProperty('internal');
  });

  it('leaves out an unlimited limit and the fields of other errors', () => {
    filter.catch(
      new HttpException(
        { message: 'x', code: 'plan_limit_exceeded', limit: Infinity },
        402,
      ),
      mockHost,
    );
    expect(mockResponse.json.mock.calls[0][0]).not.toHaveProperty('limit');

    filter.catch(
      new HttpException({ message: 'y', code: 'other', limit: 3 }, 400),
      mockHost,
    );
    const body = mockResponse.json.mock.calls[1][0];
    expect(body).not.toHaveProperty('code');
    expect(body).not.toHaveProperty('limit');
  });

  it('handles non-HttpException errors with 500 status', () => {
    const exception = new Error('Something broke');

    filter.catch(exception, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        message: 'Something broke',
        error: 'Error',
      }),
    );
  });

  it('handles unknown exceptions (non-Error)', () => {
    filter.catch('string error', mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        message: 'Internal server error',
      }),
    );
  });

  it('includes timestamp and path in response', () => {
    filter.catch(new BadRequestException('test'), mockHost);

    const body = mockResponse.json.mock.calls[0][0];
    expect(body.timestamp).toBeDefined();
    expect(body.path).toBe('/test');
  });
});
