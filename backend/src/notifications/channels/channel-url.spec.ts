import { promises as dns } from 'dns';
import {
  ChannelUrlError,
  parseChannelUrl,
  validateChannelUrl,
} from './channel-url';

const SLACK = 'https://hooks.slack.com/services/T000/B000/XXXXXXXX';

describe('channel URL validation', () => {
  afterEach(() => jest.restoreAllMocks());

  function resolvesTo(v4: string[], v6: string[] = []) {
    const r4 = jest.spyOn(dns, 'resolve4').mockResolvedValue(v4);
    jest.spyOn(dns, 'resolve6').mockResolvedValue(v6);
    return r4;
  }

  describe('common rules', () => {
    it.each(['webhook', 'slack', 'teams'] as const)(
      '%s requires https',
      (type) => {
        expect(() =>
          parseChannelUrl(type, SLACK.replace('https:', 'http:')),
        ).toThrow('URL must use https');
      },
    );

    it('rejects userinfo', () => {
      expect(() =>
        parseChannelUrl('webhook', 'https://user:pass@example.com/hook'),
      ).toThrow('must not contain a username or password');
    });

    it('rejects garbage and overly long URLs', () => {
      expect(() => parseChannelUrl('webhook', 'not a url')).toThrow(
        'URL is not valid',
      );
      expect(() =>
        parseChannelUrl('webhook', `https://example.com/${'a'.repeat(2100)}`),
      ).toThrow('at most 2048');
    });

    it('never echoes the URL in errors', () => {
      let caught: unknown;
      try {
        parseChannelUrl('slack', 'https://evil.example/secret-token-123');
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ChannelUrlError);
      expect((caught as Error).message).not.toContain('secret-token-123');
    });
  });

  describe('slack', () => {
    it('accepts an incoming webhook URL', () => {
      expect(parseChannelUrl('slack', SLACK).hostname).toBe('hooks.slack.com');
    });

    it.each([
      'https://hooks.slack.com/workflows/T000/A000/123/abc',
      'https://hooks.slack.com/services/',
      'https://hooks.slack.com.evil.com/services/T/B/X',
      'https://evilhooks.slack.com/services/T/B/X',
      'https://hooks.slack.com:8443/services/T/B/X',
    ])('rejects %s', (url) => {
      expect(() => parseChannelUrl('slack', url)).toThrow(
        'Slack URL must be an incoming webhook URL',
      );
    });
  });

  describe('teams', () => {
    it.each([
      'https://prod-12.westus.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?sig=x',
      'https://default123.ab.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/abc',
      'https://contoso.webhook.office.com/webhookb2/abc',
    ])('accepts %s', (url) => {
      expect(() => parseChannelUrl('teams', url)).not.toThrow();
    });

    it.each([
      'https://outlook.office.com/webhook/abc',
      'https://logic.azure.com.evil.com/x',
      'https://example.com/x',
      'https://prod.logic.azure.com:8443/x',
    ])('rejects %s', (url) => {
      expect(() => parseChannelUrl('teams', url)).toThrow(
        'Teams URL must be a Workflows webhook URL',
      );
    });
  });

  describe('webhook', () => {
    it.each([
      'https://localhost/hook',
      'https://app.localhost/hook',
      'https://127.0.0.1/hook',
      'https://10.0.0.8/hook',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/hook',
      'https://[::ffff:127.0.0.1]/hook',
      'https://[::ffff:10.0.0.1]/hook',
      'https://[fd00::1]/hook',
    ])('rejects private destination %s', async (url) => {
      const r4 = resolvesTo(['93.184.216.34']);
      await expect(validateChannelUrl('webhook', url)).rejects.toThrow(
        'Webhook URL must point to a public address',
      );
      expect(r4).not.toHaveBeenCalled();
    });

    it('accepts a public IP literal without DNS', async () => {
      const r4 = resolvesTo([]);
      await expect(
        validateChannelUrl('webhook', 'https://93.184.216.34/hook'),
      ).resolves.toBeInstanceOf(URL);
      expect(r4).not.toHaveBeenCalled();
    });

    it('accepts a host that resolves only to public addresses, on any port', async () => {
      resolvesTo(['93.184.216.34'], ['2606:2800:220:1::1']);
      const url = await validateChannelUrl(
        'webhook',
        'https://hooks.example.com:8443/kk',
      );
      expect(url.port).toBe('8443');
    });

    it('rejects a host with any private address', async () => {
      resolvesTo(['93.184.216.34'], ['::ffff:127.0.0.1']);
      await expect(
        validateChannelUrl('webhook', 'https://rebind.example.com/kk'),
      ).rejects.toThrow('Webhook URL must point to a public address');
    });

    it('flags unresolvable hosts as transient', async () => {
      jest.spyOn(dns, 'resolve4').mockRejectedValue(new Error('ENOTFOUND'));
      jest.spyOn(dns, 'resolve6').mockRejectedValue(new Error('ENOTFOUND'));
      await expect(
        validateChannelUrl('webhook', 'https://nope.invalid/kk'),
      ).rejects.toMatchObject({
        message: 'Webhook host could not be resolved',
        transient: true,
      });
    });

    it('does not resolve DNS for slack or teams', async () => {
      const r4 = resolvesTo([]);
      await validateChannelUrl('slack', SLACK);
      expect(r4).not.toHaveBeenCalled();
    });
  });
});
