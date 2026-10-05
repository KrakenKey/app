import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Domain } from '../../domains/entities/domain.entity';
import { ApiKeyAccessService } from './api-key-access.service';

/**
 * Global so the certs, domains and endpoints controllers can apply API key
 * restrictions without importing AuthModule (which would create cycles).
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Domain])],
  providers: [ApiKeyAccessService],
  exports: [ApiKeyAccessService],
})
export class ApiKeyAccessModule {}
