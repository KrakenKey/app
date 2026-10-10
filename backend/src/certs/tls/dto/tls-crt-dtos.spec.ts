import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { UpdateTlsCrtDto } from './update-tls-crt.dto';
import { RenewTlsCrtDto } from './renew-tls-crt.dto';
import { CreateTlsCrtDto } from './create-tls-crt.dto';

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

describe('CreateTlsCrtDto', () => {
  const meta = body(CreateTlsCrtDto);

  it('accepts a PEM CSR', async () => {
    await expect(pipe.transform({ csrPem: CSR }, meta)).resolves.toEqual({
      csrPem: CSR,
    });
  });

  it('accepts names with managedBy, including wildcards', async () => {
    const value = {
      names: ['example.com', '*.example.com', 'A-1.Sub.Example.co.uk'],
      managedBy: 'connector',
    };
    await expect(pipe.transform(value, meta)).resolves.toEqual(value);
  });

  it('rejects names that are not DNS names', async () => {
    for (const name of [
      '',
      'localhost',
      '192.0.2.1',
      'example.com.',
      '*.*.example.com',
      'www.*.example.com',
      '-bad.example.com',
      'bad-.example.com',
      'exa mple.com',
      'example.com/path',
      `${'a'.repeat(64)}.example.com`,
      `${'a.'.repeat(130)}com`,
      42,
    ]) {
      await expect(
        pipe.transform({ names: [name], managedBy: 'connector' }, meta),
      ).rejects.toThrow(BadRequestException);
    }
  });

  it('rejects an empty list, too many names, or a non-list', async () => {
    const many = Array.from({ length: 101 }, (_, i) => `h${i}.example.com`);
    for (const names of [[], many, 'example.com']) {
      await expect(
        pipe.transform({ names, managedBy: 'connector' }, meta),
      ).rejects.toThrow(BadRequestException);
    }
    await expect(
      pipe.transform(
        { names: many.slice(0, 100), managedBy: 'connector' },
        meta,
      ),
    ).resolves.toBeDefined();
  });

  it('needs exactly one of csrPem and names', async () => {
    await expect(pipe.transform({}, meta)).rejects.toThrow(BadRequestException);
    await expect(
      pipe.transform(
        { csrPem: CSR, names: ['example.com'], managedBy: 'connector' },
        meta,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('needs managedBy with names, and refuses it with a CSR', async () => {
    await expect(
      pipe.transform({ names: ['example.com'] }, meta),
    ).rejects.toThrow(BadRequestException);
    await expect(
      pipe.transform({ names: ['example.com'], managedBy: null }, meta),
    ).rejects.toThrow(BadRequestException);
    await expect(
      pipe.transform({ csrPem: CSR, managedBy: 'connector' }, meta),
    ).rejects.toThrow(BadRequestException);
    await expect(
      pipe.transform({ csrPem: CSR, managedBy: null }, meta),
    ).rejects.toThrow(BadRequestException);
  });

  it('explains what is wrong', async () => {
    const messages = async (value: object): Promise<string[]> => {
      try {
        await pipe.transform(value, meta);
        return [];
      } catch (err) {
        return (
          (err as BadRequestException).getResponse() as { message: string[] }
        ).message;
      }
    };
    expect(await messages({})).toContain('csrPem or names is required');
    expect(await messages({ csrPem: CSR, names: ['example.com'] })).toContain(
      'Send either csrPem or names, not both',
    );
    expect(await messages({ names: ['example.com'] })).toContain(
      "managedBy must be 'connector' when names is given",
    );
    expect(await messages({ csrPem: CSR, managedBy: 'connector' })).toContain(
      'managedBy is only accepted with names. Use PATCH /certs/tls/:id to change it on a certificate.',
    );
  });

  it("rejects any managedBy other than 'connector'", async () => {
    for (const managedBy of ['server', null, 1]) {
      await expect(
        pipe.transform({ names: ['example.com'], managedBy }, meta),
      ).rejects.toThrow(BadRequestException);
    }
  });
});
