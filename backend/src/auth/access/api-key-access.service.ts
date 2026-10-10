import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Domain } from '../../domains/entities/domain.entity';
import { type ApiKeyContext, nameCovered } from '../api-key-restrictions';
import {
  certNames,
  type CertNamesInput,
} from '../../certs/tls/util/cert-names';

/** The part of req.user this service reads. */
export interface KeyUser {
  apiKey?: ApiKeyContext;
}

/**
 * Applies an API key's domain and certificate restrictions. Controllers call
 * it after the usual ownership checks, so it only ever narrows access.
 * Anything outside the key's restrictions is reported as not found, the
 * same as a resource belonging to another account.
 *
 * Dashboard sessions and unrestricted keys pass straight through.
 */
@Injectable()
export class ApiKeyAccessService {
  /** Allowed hostnames, resolved once per request (keyed on req.user). */
  private readonly hostnameCache = new WeakMap<object, Promise<string[]>>();

  constructor(
    @InjectRepository(Domain)
    private readonly domainRepo: Repository<Domain>,
  ) {}

  /** True when the key limits domains or certificates. */
  isRestricted(user: KeyUser): boolean {
    const key = user.apiKey;
    return Boolean(key && (key.allowedDomainIds || key.allowedCertIds));
  }

  /**
   * Hostnames of the key's allowed domains, or null when the key has no
   * domain restriction. A deleted domain simply drops out.
   */
  private allowedHostnames(user: KeyUser): Promise<string[]> | null {
    const ids = user.apiKey?.allowedDomainIds;
    if (!ids) return null;
    let cached = this.hostnameCache.get(user);
    if (!cached) {
      cached = this.domainRepo
        .find({ where: { id: In(ids) }, select: ['id', 'hostname'] })
        .then((domains) => domains.map((d) => d.hostname.toLowerCase()));
      this.hostnameCache.set(user, cached);
    }
    return cached;
  }

  // --- Certificates ---------------------------------------------------------

  async canUseCert(user: KeyUser, cert: CertNamesInput): Promise<boolean> {
    const key = user.apiKey;
    if (!key) return true;
    if (key.allowedCertIds && !key.allowedCertIds.includes(cert.id)) {
      return false;
    }
    const hostnames = await this.allowedHostnames(user);
    if (!hostnames) return true;
    // The CSR's names, or the requested names of an awaiting_csr certificate
    const names = certNames(cert);
    return names.length > 0 && names.every((n) => nameCovered(n, hostnames));
  }

  async assertCert(user: KeyUser, cert: CertNamesInput): Promise<void> {
    if (!(await this.canUseCert(user, cert))) {
      throw new NotFoundException(
        `Certificate #${cert.id} not found or access denied`,
      );
    }
  }

  async filterCerts<T extends CertNamesInput>(
    user: KeyUser,
    certs: T[],
  ): Promise<T[]> {
    if (!this.isRestricted(user)) return certs;
    const keep = await Promise.all(certs.map((c) => this.canUseCert(user, c)));
    return certs.filter((_, i) => keep[i]);
  }

  /**
   * For a new certificate request: refuses keys limited to specific
   * certificates, and returns the hostnames the CSR must stay within for
   * keys limited to specific domains (undefined = no extra limit).
   */
  async issuanceHostnames(user: KeyUser): Promise<string[] | undefined> {
    if (user.apiKey?.allowedCertIds) {
      throw new ForbiddenException(
        'This API key is limited to specific certificates and cannot request new ones.',
      );
    }
    return (await this.allowedHostnames(user)) ?? undefined;
  }

  // --- Domains --------------------------------------------------------------

  canUseDomain(user: KeyUser, domain: { id: string }): boolean {
    const ids = user.apiKey?.allowedDomainIds;
    return !ids || ids.includes(domain.id);
  }

  assertDomain(user: KeyUser, domainId: string): void {
    if (!this.canUseDomain(user, { id: domainId })) {
      throw new NotFoundException(`Domain #${domainId} not found`);
    }
  }

  filterDomains<T extends { id: string }>(user: KeyUser, domains: T[]): T[] {
    if (!user.apiKey?.allowedDomainIds) return domains;
    return domains.filter((d) => this.canUseDomain(user, d));
  }

  assertCanAddDomain(user: KeyUser): void {
    if (user.apiKey?.allowedDomainIds) {
      throw new ForbiddenException(
        'This API key is limited to specific domains and cannot add new ones.',
      );
    }
  }

  // --- Endpoints ------------------------------------------------------------

  async canUseHost(user: KeyUser, host: string): Promise<boolean> {
    const hostnames = await this.allowedHostnames(user);
    return !hostnames || nameCovered(host, hostnames);
  }

  async assertEndpoint(
    user: KeyUser,
    endpoint: { id: string; host: string },
  ): Promise<void> {
    if (!(await this.canUseHost(user, endpoint.host))) {
      throw new NotFoundException(`Endpoint #${endpoint.id} not found`);
    }
  }

  async assertCanMonitorHost(user: KeyUser, host: string): Promise<void> {
    if (!(await this.canUseHost(user, host))) {
      throw new ForbiddenException(
        `This API key is limited to specific domains and cannot monitor ${host}.`,
      );
    }
  }

  async filterEndpoints<T extends { host: string }>(
    user: KeyUser,
    endpoints: T[],
  ): Promise<T[]> {
    const hostnames = await this.allowedHostnames(user);
    if (!hostnames) return endpoints;
    return endpoints.filter((e) => nameCovered(e.host, hostnames));
  }
}
