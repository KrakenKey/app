import { BadRequestException } from '@nestjs/common';
import { promises as dns } from 'dns';
import { of } from 'rxjs';
import { PublicScanService } from './public-scan.service';

describe('PublicScanService', () => {
  const post = jest.fn();
  const service = new PublicScanService({ post } as never);

  afterEach(() => {
    jest.restoreAllMocks();
    post.mockReset();
  });

  it('refuses raw IP addresses', async () => {
    await expect(service.scan({ hostname: '1.1.1.1' })).rejects.toThrow(
      'Raw IP addresses are not allowed',
    );
  });

  it('refuses hosts that resolve to private addresses', async () => {
    jest.spyOn(dns, 'resolve4').mockResolvedValue(['10.0.0.1']);
    jest.spyOn(dns, 'resolve6').mockResolvedValue([]);
    await expect(
      service.scan({ hostname: 'internal.example' }),
    ).rejects.toThrow(
      new BadRequestException('Cannot scan private/internal addresses'),
    );
  });

  it('refuses hosts that do not resolve', async () => {
    jest.spyOn(dns, 'resolve4').mockRejectedValue(new Error('ENOTFOUND'));
    jest.spyOn(dns, 'resolve6').mockRejectedValue(new Error('ENOTFOUND'));
    await expect(service.scan({ hostname: 'nope.invalid' })).rejects.toThrow(
      new BadRequestException('Could not resolve hostname'),
    );
  });

  it('scans the first public address with the hostname as SNI', async () => {
    jest.spyOn(dns, 'resolve4').mockResolvedValue(['93.184.216.34']);
    jest.spyOn(dns, 'resolve6').mockResolvedValue([]);
    post.mockReturnValue(of({ data: { endpoint: {} } }));

    const res = await service.scan({ hostname: 'example.com' });

    expect(post).toHaveBeenCalledWith('/scan', {
      host: '93.184.216.34',
      port: 443,
      sni: 'example.com',
    });
    expect(res.endpoint).toEqual({
      host: 'example.com',
      port: 443,
      sni: 'example.com',
    });
  });
});
