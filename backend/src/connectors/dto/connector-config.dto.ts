import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateBy,
  ValidateNested,
  type ValidationOptions,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CONNECTOR_CONFIG_HASH_PATTERN,
  CONNECTOR_CONFIG_LIMITS,
  CONNECTOR_PLUGIN_NAME_PATTERN,
  CONNECTOR_PLUGIN_SOURCES,
  CONNECTOR_SETTING_KEY_PATTERN,
  CONNECTOR_TARGET_LABEL_PATTERN,
  type ConnectorConfigSettings,
  type ConnectorPluginSource,
} from '@krakenkey/shared';

/** Printable ASCII without spaces, as in the status report. */
const PRINTABLE_PATTERN = /^[\x21-\x7E]+$/;

const PLUGIN_NAME_MESSAGE = 'must be 1 to 64 letters, digits, ".", "_" or "-"';

/** Control characters become spaces, as in report errors. */
function sanitizeText(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();
}

/**
 * Go encodes an empty slice or map left as nil as null. Treat that as
 * empty, so a connector can't fail validation over it; anything else is
 * passed on unchanged for the validators to judge.
 */
function nullAsEmpty<T>(empty: () => T) {
  return ({ value }: { value: unknown }) =>
    value === null || value === undefined ? empty() : value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/**
 * Cleans a valid settings map: string values get control characters
 * replaced. Anything that isn't a plain object is left for the validator to
 * refuse.
 */
export function sanitizeSettings(value: unknown): unknown {
  if (value === null || value === undefined) return {};
  if (!isPlainObject(value)) return value;
  // fromEntries defines own properties, so a "__proto__" key stays a key
  // (and is refused) instead of setting the prototype
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      k,
      typeof v === 'string' ? sanitizeText(v) : v,
    ]),
  );
}

/** Why a settings map is refused, or null when it is valid. */
export function settingsProblem(value: unknown): string | null {
  if (!isPlainObject(value)) return 'must be an object';
  const entries = Object.entries(value);
  if (entries.length > CONNECTOR_CONFIG_LIMITS.settingsKeys) {
    return `must have at most ${CONNECTOR_CONFIG_LIMITS.settingsKeys} keys`;
  }
  for (const [k, v] of entries) {
    if (!CONNECTOR_SETTING_KEY_PATTERN.test(k)) {
      return 'keys must be 1 to 32 lowercase letters, digits or "_", starting with a letter';
    }
    if (typeof v === 'string') {
      if (v.length > CONNECTOR_CONFIG_LIMITS.settingValueLength) {
        return `"${k}" must be at most ${CONNECTOR_CONFIG_LIMITS.settingValueLength} characters`;
      }
    } else if (typeof v === 'number') {
      if (!Number.isFinite(v)) return `"${k}" must be a finite number`;
    } else if (typeof v !== 'boolean') {
      return `"${k}" must be a string, boolean or number`;
    }
  }
  return null;
}

/** A flat map of known-safe settings (see settingsProblem). */
function IsConnectorSettings(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isConnectorSettings',
      validator: {
        // Left out: same as empty (Go omits an empty map with omitempty)
        validate: (value: unknown) =>
          value === undefined || settingsProblem(value) === null,
        defaultMessage: (args) =>
          `${args?.property ?? 'settings'} ${settingsProblem(args?.value)}`,
      },
    },
    options,
  );
}

const settingsApi = {
  type: 'object' as const,
  additionalProperties: {
    oneOf: [{ type: 'string' }, { type: 'boolean' }, { type: 'number' }],
  },
  maxProperties: CONNECTOR_CONFIG_LIMITS.settingsKeys,
  example: { vault: 'kv-prod', certificate_name: 'www' },
  description:
    'Flat map of known-safe settings: keys match ^[a-z][a-z0-9_]{0,31}$, values are strings (at most 256 characters), booleans or finite numbers',
};

export class ConnectorConfigPluginDto {
  @ApiProperty({ example: 'azure-keyvault' })
  @IsString()
  @Matches(CONNECTOR_PLUGIN_NAME_PATTERN, {
    message: `name ${PLUGIN_NAME_MESSAGE}`,
  })
  name: string;

  @ApiPropertyOptional({
    example: '0.3.0',
    nullable: true,
    maxLength: CONNECTOR_CONFIG_LIMITS.versionLength,
  })
  @IsOptional()
  @IsString()
  @Matches(PRINTABLE_PATTERN, { message: 'version must be printable ASCII' })
  @MaxLength(CONNECTOR_CONFIG_LIMITS.versionLength)
  version?: string | null;

  @ApiProperty({ enum: CONNECTOR_PLUGIN_SOURCES })
  @IsIn(CONNECTOR_PLUGIN_SOURCES)
  source: ConnectorPluginSource;
}

export class ConnectorConfigKeyStoreDto {
  @ApiProperty({ example: 'azure-keyvault' })
  @IsString()
  @Matches(CONNECTOR_PLUGIN_NAME_PATTERN, {
    message: `plugin ${PLUGIN_NAME_MESSAGE}`,
  })
  plugin: string;

  @ApiPropertyOptional({
    example: 'ecdsa-p256',
    nullable: true,
    maxLength: CONNECTOR_CONFIG_LIMITS.keyTypeLength,
  })
  @IsOptional()
  @IsString()
  @Matches(PRINTABLE_PATTERN, { message: 'keyType must be printable ASCII' })
  @MaxLength(CONNECTOR_CONFIG_LIMITS.keyTypeLength)
  keyType?: string | null;

  @ApiPropertyOptional(settingsApi)
  @Transform(({ obj }: { obj: Record<string, unknown> }) =>
    sanitizeSettings(obj.settings),
  )
  @IsConnectorSettings()
  settings?: ConnectorConfigSettings;
}

export class ConnectorConfigVerifyDto {
  @ApiPropertyOptional({
    example: 'www.example.com',
    nullable: true,
    maxLength: CONNECTOR_CONFIG_LIMITS.hostLength,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? sanitizeText(value) : value,
  )
  @IsString()
  @MaxLength(CONNECTOR_CONFIG_LIMITS.hostLength)
  host?: string | null;

  @ApiPropertyOptional({ example: 443, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number | null;

  @ApiProperty({ example: false })
  @IsBoolean()
  skipChainValidation: boolean;
}

export class ConnectorConfigTargetDto {
  @ApiProperty({ example: 'nginx-main', pattern: '^[A-Za-z0-9._-]{1,64}$' })
  @IsString()
  @Matches(CONNECTOR_TARGET_LABEL_PATTERN, {
    message: `label ${PLUGIN_NAME_MESSAGE}`,
  })
  label: string;

  @ApiProperty({ example: 'file' })
  @IsString()
  @Matches(CONNECTOR_PLUGIN_NAME_PATTERN, {
    message: `plugin ${PLUGIN_NAME_MESSAGE}`,
  })
  plugin: string;

  @ApiProperty({
    description: 'Added by the connector rather than listed in the config',
  })
  @IsBoolean()
  implicit: boolean;

  @ApiProperty({
    description: 'Runs a command after deploying, or is the exec target',
  })
  @IsBoolean()
  runsCommand: boolean;

  @ApiPropertyOptional({ type: ConnectorConfigVerifyDto, nullable: true })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ConnectorConfigVerifyDto)
  verify?: ConnectorConfigVerifyDto | null;

  @ApiPropertyOptional(settingsApi)
  @Transform(({ obj }: { obj: Record<string, unknown> }) =>
    sanitizeSettings(obj.settings),
  )
  @IsConnectorSettings()
  settings?: ConnectorConfigSettings;
}

export class ConnectorConfigCertificateDto {
  @ApiProperty({ example: 42 })
  @IsInt()
  @Min(1)
  certificateId: number;

  @ApiProperty({
    type: [String],
    example: ['www.example.com'],
    maxItems: CONNECTOR_CONFIG_LIMITS.namesPerCertificate,
  })
  @Transform(nullAsEmpty(() => []))
  @IsArray()
  @ArrayMaxSize(CONNECTOR_CONFIG_LIMITS.namesPerCertificate)
  @IsString({ each: true })
  @Matches(PRINTABLE_PATTERN, {
    each: true,
    message: 'names must be printable ASCII',
  })
  @MaxLength(CONNECTOR_CONFIG_LIMITS.nameLength, { each: true })
  names: string[];

  @ApiProperty({ type: ConnectorConfigKeyStoreDto })
  @IsObject()
  @ValidateNested()
  @Type(() => ConnectorConfigKeyStoreDto)
  keyStore: ConnectorConfigKeyStoreDto;

  @ApiProperty({
    type: [ConnectorConfigTargetDto],
    maxItems: CONNECTOR_CONFIG_LIMITS.targetsPerCertificate,
  })
  @Transform(nullAsEmpty(() => []))
  @IsArray()
  @ArrayMaxSize(CONNECTOR_CONFIG_LIMITS.targetsPerCertificate)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => ConnectorConfigTargetDto)
  targets: ConnectorConfigTargetDto[];
}

export class ConnectorConfigDto {
  @ApiProperty({
    description:
      'sha256 (lowercase hex) of the canonical summary without this field',
    pattern: '^[0-9a-f]{64}$',
  })
  @IsString()
  @Matches(CONNECTOR_CONFIG_HASH_PATTERN, {
    message: 'hash must be 64 lowercase hex characters',
  })
  hash: string;

  @ApiProperty({ example: '0.3.0', maxLength: 64 })
  @IsString()
  @Matches(PRINTABLE_PATTERN, { message: 'version must be printable ASCII' })
  @MaxLength(CONNECTOR_CONFIG_LIMITS.versionLength)
  version: string;

  @ApiPropertyOptional({
    example: 3600,
    nullable: true,
    minimum: 1,
    maximum: CONNECTOR_CONFIG_LIMITS.maxCheckIntervalSeconds,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(CONNECTOR_CONFIG_LIMITS.maxCheckIntervalSeconds)
  checkIntervalSeconds?: number | null;

  @ApiProperty({
    type: [ConnectorConfigPluginDto],
    maxItems: CONNECTOR_CONFIG_LIMITS.plugins,
  })
  @Transform(nullAsEmpty(() => []))
  @IsArray()
  @ArrayMaxSize(CONNECTOR_CONFIG_LIMITS.plugins)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => ConnectorConfigPluginDto)
  plugins: ConnectorConfigPluginDto[];

  @ApiProperty({
    type: [ConnectorConfigCertificateDto],
    maxItems: CONNECTOR_CONFIG_LIMITS.certificates,
  })
  @Transform(nullAsEmpty(() => []))
  @IsArray()
  @ArrayMaxSize(CONNECTOR_CONFIG_LIMITS.certificates)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => ConnectorConfigCertificateDto)
  certificates: ConnectorConfigCertificateDto[];

  @ApiPropertyOptional({
    description:
      'True when the connector cut anything (certificates, targets, plugins, names or long setting values) to fit the limits',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  truncated?: boolean;
}
