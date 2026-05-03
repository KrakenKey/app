import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PublicScanController } from './public-scan.controller';
import { PublicScanService } from './public-scan.service';

@Module({
  imports: [
    HttpModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        baseURL: config.get<string>(
          'KK_PROBE_INTERNAL_URL',
          'http://krakenkey-probe:8080',
        ),
        timeout: 20_000,
        headers: {
          Authorization: `Bearer ${config.get<string>('KK_PROBE_SCAN_SECRET', '')}`,
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [PublicScanController],
  providers: [PublicScanService],
})
export class PublicScanModule {}
