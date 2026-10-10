import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { UpdateTlsCrtDto } from './update-tls-crt.dto';
import { RenewTlsCrtDto } from './renew-tls-crt.dto';

// Same options as the global pipe in main.ts
const pipe = new ValidationPipe({ whitelist: true, transform: true });
const body = (metatype: new () => object) => ({
  type: 'body' as const,
  metatype,
});

const CSR =
  '-----BEGIN CERTIFICATE REQUEST-----\nMIIB\n-----END CERTIFICATE REQUEST-----';

describe('UpdateTlsCrtDto', () => {
  const meta = body(UpdateTlsCrtDto);

  it("accepts managedBy: 'connector'", async () => {
    await expect(
      pipe.transform({ managedBy: 'connector' }, meta),
    ).resolves.toEqual({ managedBy: 'connector' });
  });

  it('accepts managedBy: null', async () => {
    await expect(pipe.transform({ managedBy: null }, meta)).resolves.toEqual({
      managedBy: null,
    });
  });

  it('rejects any other managedBy value', async () => {
    for (const managedBy of ['server', 'Connector', '', 1, true]) {
      await expect(pipe.transform({ managedBy }, meta)).rejects.toThrow(
        BadRequestException,
      );
    }
  });

  it('accepts managedBy alongside autoRenew', async () => {
    await expect(
      pipe.transform({ autoRenew: false, managedBy: 'connector' }, meta),
    ).resolves.toEqual({ autoRenew: false, managedBy: 'connector' });
  });

  it('strips csrPem and other undeclared fields', async () => {
    await expect(
      pipe.transform(
        { csrPem: CSR, autoRenew: true, status: 'issued', crtPem: 'x' },
        meta,
      ),
    ).resolves.toEqual({ autoRenew: true });
    await expect(pipe.transform({ csrPem: CSR }, meta)).resolves.toEqual({});
  });

  it('lists only autoRenew and managedBy in the OpenAPI schema', () => {
    const props = Reflect.getMetadata(
      'swagger/apiModelPropertiesArray',
      UpdateTlsCrtDto.prototype,
    ) as string[];
    expect(props.map((p) => p.replace(/^:/, '')).sort()).toEqual([
      'autoRenew',
      'managedBy',
    ]);
  });

  it('does not validate csrPem, since it is not a field', async () => {
    // A malformed csrPem is stripped too, not reported as a CSR error
    await expect(
      pipe.transform({ csrPem: 'not a csr', autoRenew: false }, meta),
    ).resolves.toEqual({ autoRenew: false });
  });
});

describe('RenewTlsCrtDto', () => {
  const meta = body(RenewTlsCrtDto);

  it('accepts an empty or missing body', async () => {
    await expect(pipe.transform({}, meta)).resolves.toEqual({});
    await expect(pipe.transform(undefined, meta)).resolves.toEqual({});
  });

  it('accepts a PEM CSR', async () => {
    await expect(pipe.transform({ csrPem: CSR }, meta)).resolves.toEqual({
      csrPem: CSR,
    });
  });

  it('rejects a CSR that is not PEM, empty, or too long', async () => {
    for (const csrPem of [
      'not a csr',
      '',
      `${CSR.slice(0, 40)}${'A'.repeat(10_000)}${CSR.slice(40)}`,
    ]) {
      await expect(pipe.transform({ csrPem }, meta)).rejects.toThrow(
        BadRequestException,
      );
    }
  });
});
