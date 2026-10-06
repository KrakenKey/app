import { AlertsService, ALERT_JOB_OPTIONS } from './alerts.service';

describe('AlertsService', () => {
  let repo: { find: jest.Mock };
  let queue: { add: jest.Mock };
  let service: AlertsService;

  const payload = {
    subject: 'example.com',
    resource: { type: 'certificate' as const, id: 7 },
  };

  beforeEach(() => {
    repo = { find: jest.fn() };
    queue = { add: jest.fn().mockResolvedValue({}) };
    service = new AlertsService(repo as never, queue as never);
  });

  it('queues one job per enabled channel subscribed to the event', async () => {
    repo.find.mockResolvedValue([
      { id: 'c1', events: ['cert.failed', 'cert.expiring'] },
      { id: 'c2', events: ['cert.issued'] },
      { id: 'c3', events: ['cert.failed'] },
    ]);

    const queued = await service.emit('user-1', 'cert.failed', payload);

    expect(queued).toBe(2);
    expect(repo.find).toHaveBeenCalledWith({
      where: { userId: 'user-1', enabled: true },
      select: ['id', 'events'],
    });
    expect(queue.add).toHaveBeenCalledTimes(2);
    const [name, data, opts] = queue.add.mock.calls[0];
    expect(name).toBe('deliver');
    expect(data).toEqual({
      channelId: 'c1',
      message: {
        id: expect.any(String),
        event: 'cert.failed',
        createdAt: expect.any(String),
        payload,
      },
    });
    expect(opts).toEqual({ ...ALERT_JOB_OPTIONS, jobId: data.message.id });
    expect(opts.attempts).toBe(5);
    expect(opts.backoff).toEqual({ type: 'exponential', delay: 30_000 });
    expect(opts.removeOnComplete).toBe(true);
    expect(queue.add.mock.calls[1][1].channelId).toBe('c3');
    // Each delivery gets its own id.
    expect(queue.add.mock.calls[1][1].message.id).not.toBe(data.message.id);
  });

  it('queues nothing when no channel subscribes', async () => {
    repo.find.mockResolvedValue([{ id: 'c1', events: ['cert.issued'] }]);
    await expect(
      service.emit('user-1', 'endpoint.scan_failed', payload),
    ).resolves.toBe(0);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('skips a missing user id without querying', async () => {
    await expect(service.emit(undefined, 'cert.failed', payload)).resolves.toBe(
      0,
    );
    expect(repo.find).not.toHaveBeenCalled();
  });

  it('never throws when the lookup fails', async () => {
    repo.find.mockRejectedValue(new Error('db down'));
    await expect(service.emit('user-1', 'cert.failed', payload)).resolves.toBe(
      0,
    );
  });

  it('keeps queuing other channels when one enqueue fails', async () => {
    repo.find.mockResolvedValue([
      { id: 'c1', events: ['cert.failed'] },
      { id: 'c2', events: ['cert.failed'] },
    ]);
    queue.add
      .mockRejectedValueOnce(new Error('redis down'))
      .mockResolvedValueOnce({});
    await expect(service.emit('user-1', 'cert.failed', payload)).resolves.toBe(
      1,
    );
    expect(queue.add).toHaveBeenCalledTimes(2);
  });
});
