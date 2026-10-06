import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { EmailService } from './email.service';
import { ActivationReminderService } from './activation-reminder.service';
import { User } from '../users/entities/user.entity';
import { NotificationChannel } from './channels/entities/notification-channel.entity';
import { AlertsService, NOTIFICATIONS_QUEUE } from './channels/alerts.service';
import { AlertDeliveryProcessor } from './channels/alert-delivery.processor';
import { ChannelDeliveryService } from './channels/channel-delivery.service';
import { NotificationChannelsService } from './channels/notification-channels.service';
import { NotificationChannelsController } from './channels/notification-channels.controller';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([User, NotificationChannel]),
    BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }),
  ],
  controllers: [NotificationChannelsController],
  providers: [
    EmailService,
    ActivationReminderService,
    AlertsService,
    AlertDeliveryProcessor,
    ChannelDeliveryService,
    NotificationChannelsService,
  ],
  exports: [EmailService, AlertsService],
})
export class NotificationsModule {}
