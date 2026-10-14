import { Global, Module } from '@nestjs/common';
import { ScheduledJobLock } from './scheduled-job-lock.service';

/** Makes ScheduledJobLock available to every module's @Cron jobs. */
@Global()
@Module({
  providers: [ScheduledJobLock],
  exports: [ScheduledJobLock],
})
export class ScheduledJobLockModule {}
