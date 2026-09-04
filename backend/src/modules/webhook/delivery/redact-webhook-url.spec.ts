import { describe, expect, it } from 'vitest';
import { redactWebhookUrl } from './redact-webhook-url.js';

describe('redactWebhookUrl', () => {
  it('strips credentials, query string and fragment', () => {
    expect(
      redactWebhookUrl(
        'https://user:supersecret@hooks.example.com/path?token=abc&x=1#frag',
      ),
    ).toBe('https://hooks.example.com/path');
  });

  it('does not throw on malformed input', () => {
    expect(redactWebhookUrl('not a url')).toBe('[invalid-url]');
  });
});
