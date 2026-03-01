import { Module } from '@nestjs/common';
import { CertsService } from './certs.service';
import { CertsController } from './certs.controller';
import { TlsModule } from './tls/tls.module';

@Module({
  controllers: [CertsController],
  providers: [CertsService],
  imports: [TlsModule],
})
export class CertsModule {}
