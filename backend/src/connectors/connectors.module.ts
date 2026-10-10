import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { Connector } from './entities/connector.entity';
import { ConnectorsController } from './connectors.controller';
import { ConnectorsService } from './connectors.service';
import { ConnectorNonceStore } from './connector-nonce.store';

@Module({
  imports: [TypeOrmModule.forFeature([Connector]), AuthModule, BillingModule],
  controllers: [ConnectorsController],
  providers: [ConnectorsService, ConnectorNonceStore],
})
export class ConnectorsModule {}
