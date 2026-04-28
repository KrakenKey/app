import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { EmailService } from './email.service';

@Injectable()
export class ActivationReminderService {
  private readonly logger = new Logger(ActivationReminderService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly emailService: EmailService,
  ) {}

  @Cron('0 10 * * *')
  async sendActivationReminders(): Promise<void> {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - 24);

    const inactiveUsers = await this.userRepo.find({
      where: {
        firstDomainAddedAt: IsNull(),
        onboardingEmailSentAt: IsNull(),
        createdAt: LessThan(cutoff),
      },
    });

    if (inactiveUsers.length === 0) return;

    this.logger.log(
      `Sending activation reminders to ${inactiveUsers.length} user(s)`,
    );

    for (const user of inactiveUsers) {
      await this.emailService.sendActivationReminder({
        userId: user.id,
        username: user.username,
        email: user.email,
      });
      user.onboardingEmailSentAt = new Date();
      await this.userRepo.save(user);
    }
  }
}
