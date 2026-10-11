import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ConnectorConfigDto, settingsProblem } from './connector-config.dto';
import { toConfigSummary } from '../connectors.service';

const HASH = 'a'.repeat(64);

function body(): Record<string, any> {
  return {
    hash: HASH,
    version: '0.3.0',
    checkIntervalSeconds: 3600,
    plugins: [
      { name: 'azure-keyvault', version: '0.3.0', source: 'bundled' },
      { name: 'my-plugin', version: null, source: 'path' },
    ],
    certificates: [
      {
        certificateId: 42,
        names: ['www.example.com', '*.example.com'],
        keyStore: {
          plugin: 'azure-keyvault',
          keyType: 'ecdsa-p256',
          settings: { vault: 'kv-prod', certificate_name: 'www' },
        },
        targets: [
          {
            label: 'azure-keyvault',
            plugin: 'azure-keyvault',
            implicit: true,
            runsCommand: false,
            verify: null,
            settings: { vault: 'kv-prod', certificate_name: 'www' },
          },
          {
            label: 'nginx-main',
            plugin: 'file',
            implicit: false,
            runsCommand: true,
            verify: {
              host: 'www.example.com',
              port: 443,
              skipChainValidation: false,
            },
            settings: {
              dir: '/etc/nginx/certs',
              fullchain: 'site.pem',
              key: 'site.key',
              exportable: true,
              mode_bits: 384,
            },
          },
        ],
      },
    ],
    truncated: false,
  };
}

describe('ConnectorConfigDto', () => {
  // Same options as the global pipe in main.ts
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const meta = { type: 'body' as const, metatype: ConnectorConfigDto };
  const parse = (value: unknown) =>
    pipe.transform(value, meta) as Promise<ConnectorConfigDto>;

  async function rejects(value: unknown, message?: RegExp) {
    let error: unknown;
    try {
      await parse(value);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(BadRequestException);
    if (message) {
      const res = (error as BadRequestException).getResponse() as {
        message: string[];
      };
      expect(res.message.join('\n')).toMatch(message);
    }
  }

  /** body() with one change made by `edit`. */
  function withChange(edit: (b: Record<string, any>) => void) {
    const b = body();
    edit(b);
    return b;
  }

  it('accepts the contract example and keeps every field', async () => {
    const dto = await parse(body());
    expect(toConfigSummary(dto)).toEqual(body());
  });

  it('fills in optional fields and treats null lists as empty', async () => {
    const dto = await parse({
      hash: HASH,
      version: '0.3.0',
      plugins: null,
      certificates: [
        {
          certificateId: 1,
          names: null,
          keyStore: { plugin: 'local', settings: null },
          targets: [
            {
              label: 'exec',
              plugin: 'exec',
              implicit: false,
              runsCommand: true,
            },
          ],
        },
      ],
    });
    expect(toConfigSummary(dto)).toEqual({
      hash: HASH,
      version: '0.3.0',
      checkIntervalSeconds: null,
      plugins: [],
      certificates: [
        {
          certificateId: 1,
          names: [],
          keyStore: { plugin: 'local', keyType: null, settings: {} },
          targets: [
            {
              label: 'exec',
              plugin: 'exec',
              implicit: false,
              runsCommand: true,
              verify: null,
              settings: {},
            },
          ],
        },
      ],
      truncated: false,
    });
  });

  it('drops unknown fields at every level', async () => {
    const b = body();
    b.command = 'rm -rf /';
    b.plugins[0].sha256 = 'x';
    b.certificates[0].owner = 'root';
    b.certificates[0].keyStore.tags = { a: 'b' };
    b.certificates[0].targets[1].env = { SECRET: 'x' };
    b.certificates[0].targets[1].verify.address = '10.0.0.1:443';
    const summary = toConfigSummary(await parse(b));
    expect(summary).toEqual(body());
    expect(JSON.stringify(summary)).not.toMatch(/rm -rf|sha256|root|SECRET/);
  });

  it('replaces control characters in setting values and the check host', async () => {
    const b = body();
    b.certificates[0].targets[1].settings.dir = '/etc/\nnginx\t\u0007certs ';
    b.certificates[0].targets[1].verify.host = 'www.example.com\r\n';
    const summary = toConfigSummary(await parse(b));
    expect(summary.certificates[0].targets[1].settings.dir).toBe(
      '/etc/ nginx certs',
    );
    expect(summary.certificates[0].targets[1].verify!.host).toBe(
      'www.example.com',
    );
  });

  it('accepts the limits exactly', async () => {
    const settings = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`k${i}`, 'v'.repeat(256)]),
    );
    const target = (i: number) => ({
      label: `t${i}`,
      plugin: 'file',
      implicit: false,
      runsCommand: false,
      verify: { host: 'h'.repeat(253), port: 65535, skipChainValidation: true },
      settings,
    });
    await parse({
      hash: HASH,
      version: 'v'.repeat(64),
      checkIntervalSeconds: 604800,
      plugins: Array.from({ length: 50 }, (_, i) => ({
        name: `p${i}`,
        version: null,
        source: 'builtin',
      })),
      certificates: [
        {
          certificateId: 1,
          names: Array.from({ length: 100 }, () => 'n'.repeat(253)),
          keyStore: {
            plugin: 'p'.repeat(64),
            keyType: 'k'.repeat(32),
            settings,
          },
          targets: Array.from({ length: 50 }, (_, i) => target(i)),
        },
      ],
      truncated: true,
    });
  });

  it.each<[string, (b: Record<string, any>) => void]>([
    ['a missing hash', (b) => delete b.hash],
    ['an uppercase hash', (b) => (b.hash = 'A'.repeat(64))],
    ['a short hash', (b) => (b.hash = 'a'.repeat(63))],
    ['a missing version', (b) => delete b.version],
    ['a version with spaces', (b) => (b.version = '0.3.0 beta')],
    ['a long version', (b) => (b.version = '1'.repeat(65))],
    ['a zero check interval', (b) => (b.checkIntervalSeconds = 0)],
    ['a check interval over 7 days', (b) => (b.checkIntervalSeconds = 604801)],
    ['a fractional check interval', (b) => (b.checkIntervalSeconds = 1.5)],
    ['plugins that are not a list', (b) => (b.plugins = { a: 1 })],
    [
      '51 plugins',
      (b) =>
        (b.plugins = Array.from({ length: 51 }, (_, i) => ({
          name: `p${i}`,
          version: null,
          source: 'bundled',
        }))),
    ],
    ['a bad plugin name', (b) => (b.plugins[0].name = 'azure keyvault')],
    ['a long plugin name', (b) => (b.plugins[0].name = 'p'.repeat(65))],
    ['an unknown plugin source', (b) => (b.plugins[0].source = 'internet')],
    ['a long plugin version', (b) => (b.plugins[0].version = '1'.repeat(65))],
    ['a plugin given as a string', (b) => (b.plugins = ['azure-keyvault'])],
    ['certificates that are not a list', (b) => (b.certificates = 'all')],
    [
      '501 certificates',
      (b) =>
        (b.certificates = Array.from({ length: 501 }, () =>
          structuredClone(b.certificates[0]),
        )),
    ],
    ['a nested certificate list', (b) => (b.certificates = [b.certificates])],
    ['certificate id 0', (b) => (b.certificates[0].certificateId = 0)],
    [
      'a string certificate id',
      (b) => (b.certificates[0].certificateId = '42'),
    ],
    [
      '101 names',
      (b) =>
        (b.certificates[0].names = Array.from({ length: 101 }, () => 'a.io')),
    ],
    ['a long name', (b) => (b.certificates[0].names = ['n'.repeat(254)])],
    ['a non-ASCII name', (b) => (b.certificates[0].names = ['bücher.de'])],
    ['a name that is not a string', (b) => (b.certificates[0].names = [42])],
    ['a missing key store', (b) => delete b.certificates[0].keyStore],
    ['a key store list', (b) => (b.certificates[0].keyStore = [])],
    [
      'a bad key store plugin',
      (b) => (b.certificates[0].keyStore.plugin = '../evil'),
    ],
    [
      'a long key type',
      (b) => (b.certificates[0].keyStore.keyType = 'k'.repeat(33)),
    ],
    [
      '51 targets',
      (b) =>
        (b.certificates[0].targets = Array.from({ length: 51 }, (_, i) => ({
          ...b.certificates[0].targets[1],
          label: `t${i}`,
        }))),
    ],
    ['a bad target label', (b) => (b.certificates[0].targets[0].label = 'a b')],
    [
      'a bad target plugin',
      (b) => (b.certificates[0].targets[0].plugin = 'a/b'),
    ],
    [
      'a missing implicit flag',
      (b) => delete b.certificates[0].targets[0].implicit,
    ],
    [
      'a string runsCommand',
      (b) => (b.certificates[0].targets[0].runsCommand = 'true'),
    ],
    ['a string verify', (b) => (b.certificates[0].targets[1].verify = 'yes')],
    ['port 0', (b) => (b.certificates[0].targets[1].verify.port = 0)],
    ['port 65536', (b) => (b.certificates[0].targets[1].verify.port = 65536)],
    [
      'a long verify host',
      (b) => (b.certificates[0].targets[1].verify.host = 'h'.repeat(254)),
    ],
    [
      'a missing skipChainValidation',
      (b) => delete b.certificates[0].targets[1].verify.skipChainValidation,
    ],
    ['a string truncated flag', (b) => (b.truncated = 'no')],
  ])('400s %s', async (_, edit) => {
    await rejects(withChange(edit));
  });

  describe('settings', () => {
    const target = (b: Record<string, any>) => b.certificates[0].targets[1];

    it.each<[string, unknown, RegExp]>([
      ['a list', ['a', 'b'], /settings must be an object/],
      ['a string', 'vault=kv', /settings must be an object/],
      [
        'a nested object',
        { files: { cert: 'c.pem' } },
        /"files" must be a string, boolean or number/,
      ],
      [
        'a list value',
        { names: ['a'] },
        /"names" must be a string, boolean or number/,
      ],
      ['a null value', { dir: null }, /"dir" must be a string/],
      [
        '11 keys',
        Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, 1])),
        /at most 10 keys/,
      ],
      ['an uppercase key', { Vault: 'kv' }, /keys must be/],
      ['a key starting with a digit', { '1dir': 'x' }, /keys must be/],
      ['a key with a dash', { 'cert-name': 'x' }, /keys must be/],
      ['a 33-character key', { ['k'.repeat(33)]: 'x' }, /keys must be/],
      ['an empty key', { '': 'x' }, /keys must be/],
      [
        'a 257-character value',
        { dir: 'd'.repeat(257) },
        /"dir" must be at most 256/,
      ],
    ])('400s %s', async (_, settings, message) => {
      await rejects(
        withChange((b) => (target(b).settings = settings)),
        message,
      );
      await rejects(
        withChange((b) => (b.certificates[0].keyStore.settings = settings)),
        message,
      );
    });

    it('never keeps a __proto__ key', async () => {
      // The global pipe deletes it before validation; the key pattern would
      // refuse it anyway
      expect(settingsProblem(JSON.parse('{"__proto__": "x"}'))).toMatch(
        /keys must be/,
      );
      const dto = await parse(
        withChange(
          (b) => (target(b).settings = JSON.parse('{"__proto__": {"a": 1}}')),
        ),
      );
      const settings = dto.certificates[0].targets[1].settings!;
      expect(Object.keys(settings)).toEqual([]);
      expect(Object.getPrototypeOf(settings)).toBe(Object.prototype);
    });

    it('accepts strings, booleans and finite numbers', async () => {
      const dto = await parse(
        withChange(
          (b) =>
            (target(b).settings = {
              dir: '',
              reuse_key: false,
              port: -1.5,
            }),
        ),
      );
      expect(dto.certificates[0].targets[1].settings).toEqual({
        dir: '',
        reuse_key: false,
        port: -1.5,
      });
    });
  });
});

describe('settingsProblem', () => {
  it('refuses numbers JSON cannot carry', () => {
    expect(settingsProblem({ n: Infinity })).toMatch(/finite/);
    expect(settingsProblem({ n: NaN })).toMatch(/finite/);
    expect(settingsProblem({ n: 1 })).toBeNull();
  });
});
