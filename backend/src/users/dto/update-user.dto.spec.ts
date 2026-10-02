import { ValidationPipe } from '@nestjs/common';
import { UpdateUserDto } from './update-user.dto';

describe('UpdateUserDto', () => {
  // Same options as the global pipe in main.ts
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const meta = { type: 'body' as const, metatype: UpdateUserDto };

  it('strips groups so users cannot grant themselves admin', async () => {
    const result = await pipe.transform(
      { username: 'jdoe', groups: ['authentik Admins'] },
      meta,
    );

    expect(result).toEqual({ username: 'jdoe' });
    expect(result).not.toHaveProperty('groups');
  });

  it('still accepts username and email', async () => {
    const result = await pipe.transform(
      { username: 'jdoe', email: 'jdoe@example.com' },
      meta,
    );

    expect(result).toEqual({ username: 'jdoe', email: 'jdoe@example.com' });
  });
});
