import { ActivationReminderService } from './activation-reminder.service';
import {
  InMemoryLockStore,
  inMemoryJobLock,
} from '../common/scheduling/scheduled-job-lock.testing';

describe('ActivationReminderService', () => {
  let userRepo: { find: jest.Mock; save: jest.Mock };
  let email: { sendActivationReminder: jest.Mock };
  let lockStore: InMemoryLockStore;

  const newService = () =>
    new ActivationReminderService(
      userRepo as any,
      email as any,
      inMemoryJobLock(lockStore).lock,
    );

  const inactiveUser = () => ({
    id: 'u1',
    username: 'newuser',
    email: 'new@example.com',
    onboardingEmailSentAt: null as Date | null,
  });

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-13T10:00:00.040Z') });
    userRepo = {
      find: jest.fn().mockResolvedValue([inactiveUser()]),
      save: jest.fn().mockResolvedValue(undefined),
    };
    email = { sendActivationReminder: jest.fn().mockResolvedValue(undefined) };
    lockStore = new InMemoryLockStore();
  });

  afterEach(() => jest.useRealTimers());

  it('emails each inactive user and records it', async () => {
    await newService().sendActivationReminders();

    expect(email.sendActivationReminder).toHaveBeenCalledWith({
      userId: 'u1',
      username: 'newuser',
      email: 'new@example.com',
    });
    expect(userRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u1', onboardingEmailSentAt: new Date() }),
    );
  });

  it('emails once when two API processes run it at the same time', async () => {
    await Promise.all([
      newService().sendActivationReminders(),
      newService().sendActivationReminders(),
    ]);

    expect(userRepo.find).toHaveBeenCalledTimes(1);
    expect(email.sendActivationReminder).toHaveBeenCalledTimes(1);
  });

  it('runs again the next day', async () => {
    await newService().sendActivationReminders();
    jest.setSystemTime(new Date('2026-10-14T10:00:00.040Z'));
    await newService().sendActivationReminders();

    expect(userRepo.find).toHaveBeenCalledTimes(2);
  });
});
