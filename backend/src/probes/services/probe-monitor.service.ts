import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Probe } from '../entities/probe.entity';

@Injectable()
export class ProbeMonitorService {
  private readonly logger = new Logger(ProbeMonitorService.name);

  constructor(
    @InjectRepository(Probe)
    private readonly probeRepo: Repository<Probe>,
  ) {}

  /**
   * Runs daily at 3 AM. Marks probes as 'stale' if they have not sent a
   * heartbeat (register or report) in the last 24 hours.
   * Stale probes are flagged in the dashboard but not auto-deregistered.
   */
  @Cron('0 3 * * *')
  async checkStaleProbes(): Promise<void> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const result = await this.probeRepo.update(
      { status: 'active', lastSeenAt: LessThan(cutoff) },
      { status: 'stale' },
    );

    const affected = result.affected ?? 0;
    if (affected > 0) {
      this.logger.warn(`Marked ${affected} probe(s) as stale`);
    } else {
      this.logger.log('Probe staleness check: all active probes are healthy');
    }
  }
}
