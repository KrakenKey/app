import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TlsService } from './tls.service';
import { TlsController } from './tls.controller';
import { CsrUtilService } from './util/csr-util.service';
import { CertUtilService } from './util/cert-util.service';
import { TlsCrt } from './entities/tls-crt.entity';
import { BullModule } from '@nestjs/bullmq';
import { CertIssuerConsumer } from './processors/tls-crt-issuer.processor';
import { AcmeIssuerStrategy } from './strategies/acme-issuer.strategy';
import { CloudflareDnsStrategy } from './strategies/cloudflare-dns.strategy';
import { Route53DnsStrategy } from './strategies/route53-dns.strategy';
import { ConfigService } from '@nestjs/config';
import { DnsProvider } from './interfaces/dns-provider.interface';
import { DomainsModule } from '../../domains/domains.module';
import { CertMonitorService } from './services/cert-monitor.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TlsCrt]),
    BullModule.registerQueue({
      name: 'tlsCertIssuance',
    }),
    DomainsModule,
  ],
  controllers: [TlsController],
  providers: [
    TlsService,
    CertMonitorService,
    CsrUtilService,
    CertUtilService,
    CertIssuerConsumer,
    AcmeIssuerStrategy,
    CloudflareDnsStrategy,
    Route53DnsStrategy,
    {
      provide: 'DNS_PROVIDER',
      useFactory: (
        config: ConfigService,
        cf: CloudflareDnsStrategy,
        r53: Route53DnsStrategy,
      ): DnsProvider => {
        const provider = config.get<string>('KK_DNS_PROVIDER') || 'cloudflare';
        return provider === 'route53' ? r53 : cf;
      },
      inject: [ConfigService, CloudflareDnsStrategy, Route53DnsStrategy],
    },
  ],
  exports: [AcmeIssuerStrategy],
})
export class TlsModule {}
