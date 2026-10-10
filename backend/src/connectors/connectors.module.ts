import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { Connector } from './entities/connector.entity';
import { ConnectorDeployment } from './entities/connector-deployment.entity';
import { TlsCrt } from '../certs/tls/entities/tls-crt.entity';
import { User } from '../users/entities/user.entity';
import { ConnectorReportsService } from './connector-reports.service';
import { ConnectorsController } from './connectors.controller';
import { ConnectorsService } from './connectors.service';
import { ConnectorNonceStore } from './connector-nonce.store';

@Module({
  imports: [
    TypeOrmModule.forFeature([Connector, ConnectorDeployment, TlsCrt, User]),
    AuthModule,
    BillingModule,
  ],
  controllers: [ConnectorsController],
  providers: [ConnectorsService, ConnectorReportsService, ConnectorNonceStore],
})
export class ConnectorsModule {}
