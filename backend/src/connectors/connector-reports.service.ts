import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import {
  CONNECTOR_FAILED_STATES,
  CONNECTOR_STALE_AFTER_HOURS,
  type ConnectorDeployment as ConnectorDeploymentDto,
  type ConnectorDeploymentState,
  type ConnectorReportResponse,
} from '@krakenkey/shared';
import { Connector } from './entities/connector.entity';
import { ConnectorDeployment } from './entities/connector-deployment.entity';
import { TlsCrt } from '../certs/tls/entities/tls-crt.entity';
import { User } from '../users/entities/user.entity';
import { BillingService } from '../billing/billing.service';
import {
  ApiKeyAccessService,
  type KeyUser,
} from '../auth/access/api-key-access.service';
import { AlertsService } from '../notifications/channels/alerts.service';
import {
  EmailService,
  type DeployFailure,
} from '../notifications/email.service';
import type { ConnectorReportDto } from './dto/connector-report.dto';

/** deploy.failed alerts sent to channels for one report; the rest are logged. */
export const MAX_DEPLOY_ALERTS_PER_REPORT = 20;
/** Failures listed in the deploy.failed email for one report. */
const MAX_FAILURES_PER_EMAIL = 10;
/** Rows per INSERT when storing a report. */
const UPSERT_CHUNK = 500;

const FAILED = new Set<string>(CONNECTOR_FAILED_STATES);

interface Transition extends DeployFailure {
  state: ConnectorDeploymentState;
}

/** The common name of a certificate, for alert subjects. */
function certName(
  cert: Pick<TlsCrt, 'parsedCsr'> | undefined,
): string | undefined {
  const cn = cert?.parsedCsr?.subject?.find(
    (s) => s.name === 'commonName' || s.shortName === 'CN',
  )?.value;
  return typeof cn === 'string' && cn ? cn : undefined;
}

/**
 * Deployment status from connectors: stores what each connector reports,
 * alerts when a target starts failing, and alerts once when a connector
 * goes quiet.
 */
@Injectable()
export class ConnectorReportsService {
  private readonly logger = new Logger(ConnectorReportsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Connector)
    private readonly connectorRepo: Repository<Connector>,
    @InjectRepository(ConnectorDeployment)
    private readonly deploymentRepo: Repository<ConnectorDeployment>,
    @InjectRepository(TlsCrt)
    private readonly certRepo: Repository<TlsCrt>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly billingService: BillingService,
    private readonly keyAccess: ApiKeyAccessService,
    private readonly alerts: AlertsService,
    private readonly emailService: EmailService,
  ) {}

  // --- Reads -----------------------------------------------------------------

  /** Deployments of one certificate across the user's active connectors. */
  async forCertificate(
    userId: string,
    certificateId: number,
  ): Promise<ConnectorDeploymentDto[]> {
    const connectors = await this.connectorRepo.find({
      where: { userId, revokedAt: IsNull() },
      select: ['id', 'name'],
    });
    if (!connectors.length) return [];
    const names = new Map(connectors.map((c) => [c.id, c.name]));
    const rows = await this.deploymentRepo.find({
      where: { certificateId, connectorId: In([...names.keys()]) },
      order: { connectorId: 'ASC', label: 'ASC' },
    });
    return rows.map((d) => toDeploymentDto(d, names.get(d.connectorId)!));
  }

  /** Every deployment one connector reported. */
  async forConnector(connector: {
    id: string;
    name: string;
  }): Promise<ConnectorDeploymentDto[]> {
    const rows = await this.deploymentRepo.find({
      where: { connectorId: connector.id },
      order: { certificateId: 'ASC', label: 'ASC' },
    });
    return rows.map((d) => toDeploymentDto(d, connector.name));
  }

  // --- Report ----------------------------------------------------------------

  /**
   * Stores a status report sent with a connector's key. The report replaces
   * what the connector said before about each certificate in it; other
   * certificates are left alone. Certificates the connector may not use are
   * skipped and returned in rejectedCertificateIds.
   */
  async report(
    user: KeyUser & { userId: string },
    dto: ConnectorReportDto,
  ): Promise<ConnectorReportResponse> {
    const connectorId = user.apiKey?.connectorId;
    if (!connectorId) {
      throw new ForbiddenException(
        'Only a key issued to a connector can send connector reports.',
      );
    }

    const certIds = dto.certificates.map((c) => c.certificateId);
    const dupCerts = certIds.filter((id, i) => certIds.indexOf(id) !== i);
    if (dupCerts.length) {
      throw new BadRequestException(
        `Certificate(s) listed more than once: ${[...new Set(dupCerts)].join(', ')}`,
      );
    }
    for (const c of dto.certificates) {
      const labels = c.targets.map((t) => t.label);
      const dup = labels.find((l, i) => labels.indexOf(l) !== i);
      if (dup) {
        throw new BadRequestException(
          `Target "${dup}" is listed more than once for certificate ${c.certificateId}`,
        );
      }
    }

    // Every certificate must belong to the connector's owner (or their
    // organization) and pass the key's restrictions. Anything else is
    // skipped, and the rest of the report is stored.
    const certs = certIds.length
      ? await this.certRepo.find({
          where: {
            id: In(certIds),
            userId: In(
              await this.billingService.getResourceCountUserIds(user.userId),
            ),
          },
        })
      : [];
    const byId = new Map(certs.map((c) => [c.id, c]));
    const allowed = await Promise.all(
      certIds.map(async (id) => {
        const cert = byId.get(id);
        return cert ? this.keyAccess.canUseCert(user, cert) : false;
      }),
    );
    const rejectedCertificateIds = certIds.filter((_, i) => !allowed[i]);
    if (rejectedCertificateIds.length) {
      this.logger.warn(
        `Connector ${connectorId} reported certificate(s) outside its restrictions, skipped: ${rejectedCertificateIds.join(', ')}`,
      );
    }
    const accepted = dto.certificates.filter((_, i) => allowed[i]);
    const acceptedIds = accepted.map((c) => c.certificateId);

    const reportedAt = new Date();
    const { connector, transitions } = await this.dataSource.transaction(
      async (m) => {
        // Lock the connector so two reports from it are applied one after
        // the other and a transition is only alerted once.
        const locked = await m.getRepository(Connector).findOne({
          where: { id: connectorId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!locked || locked.revokedAt) {
          throw new ForbiddenException('This connector has been revoked.');
        }

        const deployments = m.getRepository(ConnectorDeployment);
        const existing = acceptedIds.length
          ? await deployments.find({
              where: { connectorId, certificateId: In(acceptedIds) },
            })
          : [];
        const previous = new Map(
          existing.map((d) => [`${d.certificateId}\n${d.label}`, d]),
        );

        const rows: Omit<ConnectorDeployment, 'connector'>[] = [];
        const found: Transition[] = [];
        for (const c of accepted) {
          for (const t of c.targets) {
            const key = `${c.certificateId}\n${t.label}`;
            const before = previous.get(key);
            previous.delete(key);
            const serial = t.serial ? t.serial.toLowerCase() : null;
            const error = t.error ?? null;
            if (FAILED.has(t.state) && !(before && FAILED.has(before.state))) {
              found.push({
                certificateId: c.certificateId,
                commonName: certName(byId.get(c.certificateId)),
                label: t.label,
                state: t.state,
                error,
                serial,
              });
            }
            rows.push({
              connectorId,
              certificateId: c.certificateId,
              label: t.label,
              state: t.state,
              serial,
              error,
              updatedAt: new Date(t.updatedAt),
              reportedAt,
            });
          }
        }

        // Whatever is left was deployed before but isn't any more
        const gone = [...previous.values()];
        if (gone.length) {
          await deployments.delete(
            gone.map((d) => ({
              connectorId,
              certificateId: d.certificateId,
              label: d.label,
            })),
          );
        }
        for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
          await deployments.upsert(rows.slice(i, i + UPSERT_CHUNK), [
            'connectorId',
            'certificateId',
            'label',
          ]);
        }

        await m.getRepository(Connector).update(connectorId, {
          lastSeenAt: reportedAt,
          staleAlertedAt: null,
          version: dto.version,
          os: dto.os,
          arch: dto.arch,
        });
        return { connector: locked, transitions: found };
      },
    );

    if (transitions.length) {
      await this.alertDeployFailures(connector, transitions);
    }
    return { accepted: accepted.length, rejectedCertificateIds };
  }

  private async alertDeployFailures(
    connector: Connector,
    transitions: Transition[],
  ): Promise<void> {
    this.logger.warn(
      `Connector ${connector.id} reported ${transitions.length} failed deployment(s)`,
    );
    for (const t of transitions.slice(0, MAX_DEPLOY_ALERTS_PER_REPORT)) {
      await this.alerts.emit(connector.userId, 'deploy.failed', {
        subject: `${t.commonName ?? `cert #${t.certificateId}`} on ${connector.name}/${t.label}`,
        resource: { type: 'certificate', id: t.certificateId },
        details: {
          connectorId: connector.id,
          connectorName: connector.name,
          clientLabel: connector.clientLabel,
          certificateId: t.certificateId,
          label: t.label,
          state: t.state,
          error: t.error ?? null,
          serial: t.serial ?? null,
        },
      });
    }
    if (transitions.length > MAX_DEPLOY_ALERTS_PER_REPORT) {
      this.logger.warn(
        `Connector ${connector.id}: ${transitions.length - MAX_DEPLOY_ALERTS_PER_REPORT} deploy.failed alert(s) over the per-report cap not sent to channels`,
      );
    }

    try {
      const owner = await this.userRepo.findOne({
        where: { id: connector.userId },
        select: ['id', 'username', 'email'],
      });
      if (!owner) return;
      await this.emailService.sendDeployFailed({
        userId: owner.id,
        username: owner.username,
        email: owner.email,
        connectorName: connector.name,
        clientLabel: connector.clientLabel,
        failures: transitions.slice(0, MAX_FAILURES_PER_EMAIL),
        total: transitions.length,
      });
    } catch (err) {
      this.logger.error(
        `Failed to email deploy failures for connector ${connector.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // --- Staleness -------------------------------------------------------------

  /**
   * Hourly: alerts once for each enrolled, active connector that hasn't
   * been seen for CONNECTOR_STALE_AFTER_HOURS. The claim is one UPDATE, so
   * several API replicas running the job alert once between them. Any
   * contact from the connector clears staleAlertedAt, which re-arms it.
   */
  @Cron('45 * * * *')
  async alertStaleConnectors(): Promise<number> {
    const cutoff = new Date(
      Date.now() - CONNECTOR_STALE_AFTER_HOURS * 3600_000,
    );
    const result = await this.connectorRepo
      .createQueryBuilder()
      .update(Connector)
      .set({ staleAlertedAt: new Date() })
      .where('"enrolledAt" IS NOT NULL')
      .andWhere('"revokedAt" IS NULL')
      .andWhere('"staleAlertedAt" IS NULL')
      .andWhere('"lastSeenAt" < :cutoff', { cutoff })
      .returning([
        'id',
        'userId',
        'name',
        'clientLabel',
        'lastSeenAt',
        'version',
      ])
      .execute();
    const stale = (result.raw ?? []) as Pick<
      Connector,
      'id' | 'userId' | 'name' | 'clientLabel' | 'lastSeenAt' | 'version'
    >[];
    if (!stale.length) return 0;
    this.logger.warn(`${stale.length} connector(s) went stale`);

    const byUser = new Map<string, typeof stale>();
    for (const c of stale) {
      const lastSeenAt = c.lastSeenAt ? new Date(c.lastSeenAt) : null;
      await this.alerts.emit(c.userId, 'connector.stale', {
        subject: c.name,
        resource: { type: 'connector', id: c.id },
        details: {
          connectorId: c.id,
          connectorName: c.name,
          clientLabel: c.clientLabel,
          lastSeenAt: lastSeenAt ? lastSeenAt.toISOString() : null,
          version: c.version,
        },
      });
      byUser.set(c.userId, [...(byUser.get(c.userId) ?? []), c]);
    }

    for (const [userId, connectors] of byUser) {
      try {
        const owner = await this.userRepo.findOne({
          where: { id: userId },
          select: ['id', 'username', 'email'],
        });
        if (!owner) continue;
        await this.emailService.sendConnectorStale({
          userId: owner.id,
          username: owner.username,
          email: owner.email,
          connectors: connectors.map((c) => ({
            name: c.name,
            clientLabel: c.clientLabel,
            lastSeenAt: c.lastSeenAt ? new Date(c.lastSeenAt) : null,
            version: c.version,
          })),
        });
      } catch (err) {
        this.logger.error(
          `Failed to email stale connectors to user ${userId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return stale.length;
  }
}

export function toDeploymentDto(
  d: ConnectorDeployment,
  connectorName: string,
): ConnectorDeploymentDto {
  return {
    connectorId: d.connectorId,
    connectorName,
    certificateId: d.certificateId,
    label: d.label,
    state: d.state,
    serial: d.serial,
    error: d.error,
    updatedAt: d.updatedAt.toISOString(),
    reportedAt: d.reportedAt.toISOString(),
  };
}
