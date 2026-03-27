export type ProbeMode = 'standalone' | 'connected' | 'hosted';

export interface Endpoint {
  id: string;
  userId: string;
  host: string;
  port: number;
  sni?: string;
  label?: string;
  isActive: boolean;
  lastScanRequestedAt?: string;
  hostedRegions?: EndpointHostedRegion[];
  probeAssignments?: EndpointProbeAssignment[];
  createdAt: string;
  updatedAt: string;
}

export interface EndpointHostedRegion {
  id: string;
  endpointId: string;
  region: string;
  createdAt: string;
}

export interface EndpointProbeAssignment {
  id: string;
  endpointId: string;
  probeId: string;
  probe?: {
    id: string;
    name: string;
    mode: string;
    region?: string;
    status: string;
    lastSeenAt?: string;
  };
  createdAt: string;
}

export interface CreateEndpointRequest {
  host: string;
  port?: number;
  sni?: string;
  label?: string;
  probeIds?: string[];
  hostedRegions?: string[];
}

export interface UpdateEndpointRequest {
  sni?: string;
  label?: string;
  isActive?: boolean;
}

export interface AddHostedRegionRequest {
  region: string;
}

export interface ProbeScanResult {
  id: string;
  probeId: string;
  endpointId?: string;
  host: string;
  port: number;
  sni?: string;
  userId?: string;
  probeMode?: ProbeMode;
  probeRegion?: string;
  connectionSuccess: boolean;
  connectionError?: string;
  latencyMs?: number;
  tlsVersion?: string;
  cipherSuite?: string;
  ocspStapled?: boolean;
  certSubject?: string;
  certSans?: string[];
  certIssuer?: string;
  certSerialNumber?: string;
  certNotBefore?: string;
  certNotAfter?: string;
  certDaysUntilExpiry?: number;
  certKeyType?: string;
  certKeySize?: number;
  certSignatureAlgorithm?: string;
  certFingerprint?: string;
  certChainDepth?: number;
  certChainComplete?: boolean;
  certTrusted?: boolean;
  scannedAt: string;
  createdAt: string;
}
