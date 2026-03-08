/**
 * Input validation utilities for CSR generator form
 * All validation functions return error message string or null if valid
 */

/**
 * Validates Common Name (CN) field
 * Must be a valid FQDN or wildcard domain
 */
export function validateCommonName(cn: string): string | null {
  if (!cn || cn.trim() === '') {
    return 'Common Name is required';
  }

  const trimmed = cn.trim();

  // Allow wildcard domains (*.example.com)
  const wildcardPattern =
    /^\*\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
  // Regular FQDN
  const fqdnPattern =
    /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

  if (!wildcardPattern.test(trimmed) && !fqdnPattern.test(trimmed)) {
    return 'Common Name must be a valid domain name (e.g., example.com or *.example.com)';
  }

  if (trimmed.length > 253) {
    return 'Common Name must be 253 characters or less';
  }

  return null;
}

/**
 * Validates Organization (O) field
 */
export function validateOrganization(org: string): string | null {
  if (!org) return null; // Optional field

  const trimmed = org.trim();
  if (trimmed.length > 64) {
    return 'Organization must be 64 characters or less';
  }

  // Reject control characters
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(trimmed)) {
    return 'Organization contains invalid characters';
  }

  return null;
}

/**
 * Validates Country (C) field
 * Must be a 2-letter ISO 3166-1 alpha-2 code
 */
export function validateCountryCode(country: string): string | null {
  if (!country) return null; // Optional field

  const trimmed = country.trim();
  if (trimmed.length !== 2) {
    return 'Country code must be exactly 2 letters (e.g., US, GB, FR)';
  }

  if (!/^[A-Z]{2}$/.test(trimmed)) {
    return 'Country code must be 2 uppercase letters (e.g., US, GB, FR)';
  }

  return null;
}

/**
 * Validates DNS name in SAN field
 */
export function validateDnsName(dns: string): string | null {
  if (!dns || dns.trim() === '') {
    return 'DNS name cannot be empty';
  }

  const trimmed = dns.trim();

  // Same as CN validation but stored separately for clarity
  const wildcardPattern =
    /^\*\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
  const fqdnPattern =
    /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

  if (!wildcardPattern.test(trimmed) && !fqdnPattern.test(trimmed)) {
    return 'DNS name must be a valid domain (e.g., www.example.com or *.example.com)';
  }

  if (trimmed.length > 253) {
    return 'DNS name must be 253 characters or less';
  }

  return null;
}

/**
 * Validates IP address (IPv4 or IPv6) in SAN field
 */
export function validateIpAddress(ip: string): string | null {
  if (!ip || ip.trim() === '') {
    return 'IP address cannot be empty';
  }

  const trimmed = ip.trim();

  // IPv4 pattern
  const ipv4Pattern =
    /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

  // IPv6 pattern (simplified - full IPv6 validation is complex)
  const ipv6Pattern =
    /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|::)$/;

  if (!ipv4Pattern.test(trimmed) && !ipv6Pattern.test(trimmed)) {
    return 'Must be a valid IPv4 (e.g., 192.168.1.1) or IPv6 address';
  }

  return null;
}

/**
 * Validates email address in SAN field
 */
export function validateEmail(email: string): string | null {
  if (!email || email.trim() === '') {
    return 'Email address cannot be empty';
  }

  const trimmed = email.trim();

  // Basic email validation (RFC 5322 simplified)
  const emailPattern =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

  if (!emailPattern.test(trimmed)) {
    return 'Must be a valid email address (e.g., user@example.com)';
  }

  if (trimmed.length > 254) {
    return 'Email address must be 254 characters or less';
  }

  return null;
}

/**
 * Validates all subject fields together
 * Returns null if all valid, or an object with field errors
 */
export function validateSubjectFields(subject: {
  commonName: string;
  organization?: string;
  organizationalUnit?: string;
  locality?: string;
  state?: string;
  country?: string;
}): Record<string, string> | null {
  const errors: Record<string, string> = {};

  const cnError = validateCommonName(subject.commonName);
  if (cnError) errors.commonName = cnError;

  if (subject.organization) {
    const orgError = validateOrganization(subject.organization);
    if (orgError) errors.organization = orgError;
  }

  if (subject.organizationalUnit) {
    if (subject.organizationalUnit.length > 64) {
      errors.organizationalUnit =
        'Organizational Unit must be 64 characters or less';
      // eslint-disable-next-line no-control-regex
    } else if (/[\x00-\x1F\x7F]/.test(subject.organizationalUnit)) {
      errors.organizationalUnit =
        'Organizational Unit contains invalid characters';
    }
  }

  if (subject.locality) {
    if (subject.locality.length > 128) {
      errors.locality = 'Locality must be 128 characters or less';
      // eslint-disable-next-line no-control-regex
    } else if (/[\x00-\x1F\x7F]/.test(subject.locality)) {
      errors.locality = 'Locality contains invalid characters';
    }
  }

  if (subject.state) {
    if (subject.state.length > 128) {
      errors.state = 'State/Province must be 128 characters or less';
      // eslint-disable-next-line no-control-regex
    } else if (/[\x00-\x1F\x7F]/.test(subject.state)) {
      errors.state = 'State/Province contains invalid characters';
    }
  }

  if (subject.country) {
    const countryError = validateCountryCode(subject.country);
    if (countryError) errors.country = countryError;
  }

  return Object.keys(errors).length > 0 ? errors : null;
}

/**
 * Checks if a domain is covered by the list of verified domains.
 *
 * A verified parent domain covers all its subdomains. For example,
 * verifying "labxp.io" covers "sub.labxp.io", "*.labxp.io",
 * "a.b.labxp.io", etc.
 */
export function isDomainVerified(
  domain: string,
  verifiedDomains: string[],
): boolean {
  const normalized = domain.trim().toLowerCase();
  // Strip wildcard prefix for matching (*.example.com -> example.com)
  const baseDomain = normalized.startsWith('*.')
    ? normalized.slice(2)
    : normalized;

  return verifiedDomains.some((d) => {
    const allowed = d.toLowerCase();
    return baseDomain === allowed || baseDomain.endsWith(`.${allowed}`);
  });
}

/**
 * Validates that all domains in CSR are verified by the user
 */
export function validateDomainAuthorization(
  domains: string[],
  verifiedDomains: string[],
): string | null {
  const unauthorized = domains.filter(
    (d) => !isDomainVerified(d, verifiedDomains),
  );

  if (unauthorized.length > 0) {
    return `These domains are not verified: ${unauthorized.join(', ')}. Please verify them first.`;
  }

  return null;
}
