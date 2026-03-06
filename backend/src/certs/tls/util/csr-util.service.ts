import { Injectable, BadRequestException } from '@nestjs/common';
import * as x509 from '@peculiar/x509';
import type { ParsedCsr, ParsedCsrPublicKey } from '@krakenkey/shared';

@Injectable()
export class CsrUtilService {
  /**
   * Validates and parses a Certificate Signing Request (CSR).
   *
   * Validation checks (per Let's Encrypt requirements):
   * 1. Signature verification - proves requester controls the private key
   * 2. DNS name extraction - Common Name + Subject Alternative Names
   * 3. Key strength - RSA keys must be >= 2048 bits, ECDSA keys must use P-256 or P-384
   * 4. PEM format normalization - handles various line-ending formats
   *
   * Supports both RSA and ECDSA keys.
   * Returns normalized CSR, parsed metadata, domains, and key length.
   */
  async validateAndParse(pem: string) {
    const normalizedPem = this.normalizePem(pem);
    try {
      const csr = new x509.Pkcs10CertificateRequest(normalizedPem);

      // Proof of Possession: verify signature using embedded public key.
      // This proves the requester has the corresponding private key.
      const valid = await csr.verify();
      if (!valid) {
        throw new BadRequestException('CSR signature verification failed');
      }

      const dnsNames = this.getDnsNames(csr);

      const algorithm = csr.publicKey.algorithm;

      // Detect key type and validate strength
      let keyType: string;
      let bitLength: number;

      if ('modulusLength' in algorithm) {
        // RSA key detected
        keyType = 'RSA';
        bitLength = (algorithm as RsaHashedKeyAlgorithm).modulusLength;

        // Let's Encrypt requires RSA keys >= 2048 bits
        if (bitLength < 2048) {
          throw new BadRequestException('RSA key must be at least 2048 bits');
        }
      } else if ('namedCurve' in algorithm) {
        // ECDSA key detected
        keyType = 'ECDSA';
        const curve = (algorithm as EcKeyAlgorithm).namedCurve;

        if (curve === 'P-256') {
          bitLength = 256;
        } else if (curve === 'P-384') {
          bitLength = 384;
        } else {
          throw new BadRequestException(
            `Unsupported ECDSA curve. Supported curves: P-256, P-384. Received: ${curve}`,
          );
        }
      } else {
        throw new BadRequestException(
          'Unsupported key type. Only RSA and ECDSA keys are supported.',
        );
      }

      const parsed: ParsedCsr = this.csrToJsonSerializable(
        csr,
        bitLength,
        keyType,
      );

      return {
        raw: normalizedPem,
        parsed,
        domains: dnsNames,
        publicKeyLength: bitLength,
      };
    } catch (e: unknown) {
      if (e instanceof BadRequestException) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      throw new BadRequestException(`Invalid CSR: ${msg}`);
    }
  }

  /**
   * Checks if all DNS names in the CSR are authorized for this user.
   *
   * Users can only request certificates for domains they own and have verified.
   * A verified parent domain authorizes all its subdomains. For example,
   * verifying "labxp.io" authorizes "sub.labxp.io", "*.labxp.io",
   * "a.b.labxp.io", etc.
   */
  isAuthorized(dnsNames: string[], allowedDomains: string[]) {
    const normalizedAllowed = allowedDomains.map((d) => d.toLowerCase());
    const unauthorized = dnsNames.filter(
      (domain) =>
        !this.isDomainAllowed(domain.toLowerCase(), normalizedAllowed),
    );
    if (unauthorized.length > 0) {
      throw new BadRequestException(
        `CSR contains unauthorized domains: ${unauthorized.join(', ')}`,
      );
    }
  }

  /**
   * Checks whether a single domain is covered by the list of allowed domains.
   *
   * A domain is allowed if it exactly matches a verified domain, or if any
   * verified domain is a parent of the requested domain. Wildcard prefixes
   * (e.g. "*.example.com") are resolved to their base domain before checking.
   */
  private isDomainAllowed(domain: string, allowedDomains: string[]): boolean {
    // Strip wildcard prefix for matching (*.example.com -> example.com)
    const baseDomain = domain.startsWith('*.') ? domain.slice(2) : domain;

    return allowedDomains.some(
      (allowed) => baseDomain === allowed || baseDomain.endsWith(`.${allowed}`),
    );
  }

  /**
   * Normalizes PEM format to handle various input formats.
   *
   * Accepts: single-line, Windows CRLF, extra whitespace, etc.
   * Returns: Standard PEM with 64-character lines.
   */
  normalizePem(input: string): string {
    const trimmed = input.trim();
    const header = '-----BEGIN CERTIFICATE REQUEST-----';
    const footer = '-----END CERTIFICATE REQUEST-----';

    const match = trimmed.match(
      /-----BEGIN CERTIFICATE REQUEST-----([\s\S]+?)-----END CERTIFICATE REQUEST-----/,
    );
    if (!match) {
      throw new BadRequestException('CSR must include PEM header and footer');
    }

    // Strip all whitespace from base64 body and re-wrap at 64 chars per line
    const base64 = match[1].replace(/\s/g, '');
    const chunks = base64.match(/.{1,64}/g) || [];
    return `${header}\n${chunks.join('\n')}\n${footer}`;
  }

  formatPem(pem: string): string {
    return this.normalizePem(pem);
  }

  private csrToJsonSerializable(
    csr: x509.Pkcs10CertificateRequest,
    bitLength: number,
    keyType: string,
  ) {
    const algorithm = csr.publicKey.algorithm;

    // Extract subject attributes from the Name
    const subject = this.extractSubjectAttributes(csr.subjectName);

    // Extract attributes (CSR-level attributes beyond extensions)
    const attributes = csr.attributes.map((a) => ({
      name: a.type,
      value: a.values,
    }));

    const pub: ParsedCsrPublicKey = { keyType, bitLength };

    if ('modulusLength' in algorithm) {
      // RSA key — store modulus length and public exponent
      const rsaAlg = algorithm as RsaHashedKeyAlgorithm;
      pub.modulusLength = rsaAlg.modulusLength;
      if (rsaAlg.publicExponent) {
        pub.e = String(
          new DataView((rsaAlg.publicExponent as Uint8Array).buffer).getUint32(
            0,
            false,
          ),
        );
      }
    } else if ('namedCurve' in algorithm) {
      // ECDSA key — store curve name
      const ecAlg = algorithm as EcKeyAlgorithm;
      pub.curve = ecAlg.namedCurve;
    }

    // Extract extensions (SAN)
    const extensions = this.extractExtensions(csr);

    return {
      subject,
      attributes,
      publicKey: pub,
      extensions,
    };
  }

  private extractSubjectAttributes(
    name: x509.Name,
  ): { name: string | undefined; shortName?: string; value: unknown }[] {
    const fieldMap: Record<string, string> = {
      CN: 'commonName',
      O: 'organizationName',
      OU: 'organizationalUnitName',
      L: 'localityName',
      ST: 'stateOrProvinceName',
      C: 'countryName',
    };

    const attrs: {
      name: string | undefined;
      shortName?: string;
      value: unknown;
    }[] = [];

    for (const [shortName, longName] of Object.entries(fieldMap)) {
      const values = name.getField(shortName);
      if (values.length > 0) {
        attrs.push({
          name: longName,
          shortName,
          value: values[0],
        });
      }
    }

    return attrs;
  }

  private extractExtensions(csr: x509.Pkcs10CertificateRequest): {
    name: string | undefined;
    altNames: { type: number; value: string }[];
  }[] {
    // OID 2.5.29.17 = subjectAltName
    const rawSanExt = csr.getExtension('2.5.29.17');
    if (!rawSanExt) return [];

    const sanExt = new x509.SubjectAlternativeNameExtension(rawSanExt.rawData);
    const altNames = sanExt.names.items.map((item: x509.GeneralName) => {
      // Map @peculiar/x509 GeneralName types to numeric types for compatibility
      // DNS=2, email/rfc822Name=1, IP=7
      let type = 0;
      if (item.type === 'dns') type = 2;
      else if (item.type === 'email') type = 1;
      else if (item.type === 'ip') type = 7;

      return { type, value: item.value };
    });

    return [{ name: 'subjectAltName', altNames }];
  }

  /**
   * Extracts all DNS names from CSR (Common Name + Subject Alternative Names).
   *
   * Returns deduplicated array of domain names.
   */
  private getDnsNames(csr: x509.Pkcs10CertificateRequest): string[] {
    const names = new Set<string>();

    // Extract Common Name (CN) from subject
    const cnValues = csr.subjectName.getField('CN');
    if (cnValues.length > 0) {
      names.add(cnValues[0]);
    }

    // Extract Subject Alternative Names (SANs) from extensions
    // OID 2.5.29.17 = subjectAltName
    const rawSanExt = csr.getExtension('2.5.29.17');
    if (rawSanExt) {
      const sanExt = new x509.SubjectAlternativeNameExtension(
        rawSanExt.rawData,
      );
      for (const item of sanExt.names.items) {
        // Only extract DNS names (type 'dns'). Type 'ip' = IP, type 'email' = email.
        if (item.type === 'dns' && item.value) {
          names.add(item.value);
        }
      }
    }

    return Array.from(names);
  }
}
