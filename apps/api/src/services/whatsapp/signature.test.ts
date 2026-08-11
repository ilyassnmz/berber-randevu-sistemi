import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyWebhookSignature, verifyWebhookChallenge } from './signature.js';

const APP_SECRET = 'test-app-secret-degeri';

function sign(body: string, secret = APP_SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(Buffer.from(body)).digest('hex')}`;
}

describe('verifyWebhookSignature', () => {
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });

  it('doğru imzayı kabul eder', () => {
    const result = verifyWebhookSignature(Buffer.from(body), sign(body), APP_SECRET);
    expect(result.valid).toBe(true);
  });

  it('yanlış app secret ile üretilmiş imzayı reddeder', () => {
    const forged = sign(body, 'saldirganin-tahmini');
    const result = verifyWebhookSignature(Buffer.from(body), forged, APP_SECRET);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('İmza eşleşmedi');
  });

  it('gövde değiştirilmişse reddeder', () => {
    // Saldırgan meşru bir imzayı yakalayıp gövdeyi değiştirirse yakalanmalı
    const signature = sign(body);
    const tampered = JSON.stringify({ object: 'whatsapp_business_account', entry: ['sahte'] });

    const result = verifyWebhookSignature(Buffer.from(tampered), signature, APP_SECRET);
    expect(result.valid).toBe(false);
  });

  it('imza başlığı yoksa reddeder', () => {
    const result = verifyWebhookSignature(Buffer.from(body), undefined, APP_SECRET);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('İmza başlığı yok');
  });

  it('sha256= öneki olmayan başlığı reddeder', () => {
    const result = verifyWebhookSignature(Buffer.from(body), 'abc123', APP_SECRET);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('İmza biçimi tanınmadı');
  });

  it('ham gövde yoksa reddeder', () => {
    // express.json'ın verify geri çağrısı çalışmazsa bu duruma düşülür;
    // sessizce geçmek yerine reddediyoruz.
    const result = verifyWebhookSignature(undefined, sign(body), APP_SECRET);
    expect(result.valid).toBe(false);
  });

  it('boş gövdeyi reddeder', () => {
    const result = verifyWebhookSignature(Buffer.alloc(0), sign(''), APP_SECRET);
    expect(result.valid).toBe(false);
  });

  it('yeniden serileştirilmiş gövde imzayı bozar', () => {
    // Bu testin amacı bir TASARIM KURALINI korumak: imza HAM gövde üzerinden
    // doğrulanmalı. Biri JSON.parse + JSON.stringify yapmaya kalkarsa anahtar
    // sırası değişebilir ve imza tutmaz.
    const original = '{"b":2,"a":1}';
    const signature = sign(original);
    const reserialized = JSON.stringify(JSON.parse(original)); // → {"b":2,"a":1} olabilir ama garanti değil

    const originalResult = verifyWebhookSignature(
      Buffer.from(original),
      signature,
      APP_SECRET,
    );
    expect(originalResult.valid).toBe(true);

    // Boşluk eklenmiş hali kesinlikle bozulur
    const spaced = JSON.stringify(JSON.parse(original), null, 2);
    expect(verifyWebhookSignature(Buffer.from(spaced), signature, APP_SECRET).valid).toBe(false);
    expect(reserialized.length).toBeGreaterThan(0);
  });
});

describe('verifyWebhookChallenge', () => {
  const TOKEN = 'benim-dogrulama-jetonum';

  it('doğru mod ve jetonu kabul eder', () => {
    expect(verifyWebhookChallenge('subscribe', TOKEN, TOKEN)).toBe(true);
  });

  it('yanlış jetonu reddeder', () => {
    expect(verifyWebhookChallenge('subscribe', 'yanlis-jeton-ayni-uzunluk', TOKEN)).toBe(false);
  });

  it('farklı uzunluktaki jetonu reddeder', () => {
    expect(verifyWebhookChallenge('subscribe', 'kisa', TOKEN)).toBe(false);
  });

  it('subscribe olmayan modu reddeder', () => {
    expect(verifyWebhookChallenge('unsubscribe', TOKEN, TOKEN)).toBe(false);
    expect(verifyWebhookChallenge(undefined, TOKEN, TOKEN)).toBe(false);
  });

  it('jeton yoksa reddeder', () => {
    expect(verifyWebhookChallenge('subscribe', undefined, TOKEN)).toBe(false);
  });
});
