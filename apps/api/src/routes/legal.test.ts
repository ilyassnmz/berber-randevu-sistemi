import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';

describe('GET /gizlilik', () => {
  const app = createApp();

  it('jetonsuz, herkese açık olarak yanıt verir', async () => {
    const res = await request(app).get('/gizlilik');

    expect(res.status).toBe(200);
    expect(res.type).toBe('text/html');
    expect(res.text).toContain('Özdede Hair Studio');
    expect(res.text).toContain('KVKK');
  });
});
