import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DomainsService } from './domains.service';
import { DomainsController } from './domains.controller';
import { Domain } from './entities/domain.entity';
import { DomainMonitorService } from './services/domain-monitor.service';
import { BillingModule } from '../billing/billing.module';

/**
 * DomainsModule
 *
 * This module groups all domain-related functionality (Controller, Service, Entity).
 * It imports TypeOrmModule to provide the Domain repository to the service.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Domain]), BillingModule],
  controllers: [DomainsController],
  providers: [DomainsService, DomainMonitorService],
  exports: [DomainsService], // Exported so other modules can use DomainsService if needed
})
export class DomainsModule {}
