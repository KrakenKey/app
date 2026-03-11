import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { readFileSync } from 'fs';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CertsModule } from './certs/certs.module';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { DomainsModule } from './domains/domains.module';
import { KKThrottlerModule } from './throttler/throttler.module';
import { HealthModule } from './health/health.module';
import { FeedbackModule } from './feedback/feedback.module';
import { MetricsModule } from './metrics/metrics.module';
import { NotificationsModule } from './notifications/notifications.module';
import { BillingModule } from './billing/billing.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { RoleGuard } from './auth/guards/role.guard';

@Module({
  imports: [
    CertsModule,
    HealthModule,
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('KK_DB_HOST'),
        port: parseInt(configService.get('KK_DB_PORT', '5432')),
        username: configService.get('KK_DB_USERNAME'),
        password: configService.get('KK_DB_PASSWORD'),
        database: configService.get('KK_DB_DATABASE'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        migrations: [__dirname + '/migrations/*{.ts,.js}'],
        migrationsRun: true,
        ssl:
          configService.get('KK_DB_SSL') === 'true'
            ? {
                rejectUnauthorized: true,
                ca: readFileSync(
                  configService.get('KK_DB_SSL_CA', '/certs/postgres/ca.crt'),
                  'utf8',
                ),
              }
            : false,
        synchronize: false,
      }),
      inject: [ConfigService],
    }),
    BullModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('KK_BULLMQ_HOST', 'localhost'),
          port: parseInt(configService.get('KK_BULLMQ_PORT', '6379')),
          password: configService.get<string>('KK_BULLMQ_PASSWORD', ''),
        },
      }),
      imports: [ConfigModule],
      inject: [ConfigService],
    }),
    KKThrottlerModule,
    AuthModule,
    UsersModule,
    DomainsModule,
    BillingModule,
    FeedbackModule,
    MetricsModule,
    NotificationsModule,
    OrganizationsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // RoleGuard runs globally after JwtOrApiKeyGuard populates req.user.
    // It only enforces restrictions when @Roles() is present on a handler.
    {
      provide: APP_GUARD,
      useClass: RoleGuard,
    },
  ],
})
export class AppModule {}
