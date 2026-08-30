import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createFixture, destroyFixture, testPrisma, extractCookie, type TestFixture } from './helpers.js';

/**
 * Kimlik doğrulama — entegrasyon testleri.
 *
 * Bu testler güvenlik gereksinimlerinin otomatik karşılığıdır. Elle test bir kez yapılır, bunlar her commit'te.
 */

const app = createApp();
const REFRESH_COOKIE = 'berber_refresh';
const BASE = '/api/v1/auth';

let fx: TestFixture;

beforeAll(async () => {
  fx = await createFixture();
});

afterAll(async () => {
  await destroyFixture(fx.shopId);
  await testPrisma.$disconnect();
});

/** Her testten önce kilit ve sayaçları sıfırla — testler birbirini etkilemesin. */
beforeEach(async () => {
  await testPrisma.barber.updateMany({
    where: { shopId: fx.shopId },
    data: { failedLoginCount: 0, lockedUntil: null, isActive: true },
  });
});

async function loginAs(email: string, password = fx.password) {
  return request(app).post(`${BASE}/login`).send({ email, password });
}

describe('POST /login', () => {
  it('doğru bilgilerle giriş yapar ve jeton döner', async () => {
    const res = await loginAs(fx.adminEmail);

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.barber).toMatchObject({
      id: fx.adminId,
      email: fx.adminEmail,
      role: 'admin',
    });
  });

  it('şifreyi ve şifre özetini yanıtta ASLA döndürmez', async () => {
    const res = await loginAs(fx.adminEmail);
    const body = JSON.stringify(res.body);

    expect(body).not.toContain('passwordHash');
    expect(body).not.toContain(fx.password);
  });

  it('yenileme jetonunu httpOnly çerezde gönderir', async () => {
    const res = await loginAs(fx.adminEmail);
    const setCookie = res.headers['set-cookie'];

    expect(setCookie).toBeDefined();
    const cookieString = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);

    // XSS ile okunamaması için httpOnly şart
    expect(cookieString).toContain('HttpOnly');
    // CSRF koruması
    expect(cookieString).toContain('SameSite=Strict');
    // Yenileme jetonu gövdede DÖNMEMELİ
    expect(res.body.refreshToken).toBeUndefined();
  });

  it('hatalı şifreyi reddeder', async () => {
    const res = await loginAs(fx.adminEmail, 'yanlis-parola');
    expect(res.status).toBe(401);
  });

  it('var olmayan e-posta ile hatalı şifre AYNI mesajı döndürür', async () => {
    // Farklı mesaj verilseydi, saldırgan hangi e-postaların kayıtlı
    // olduğunu tek tek deneyerek çıkarabilirdi.
    const wrongPassword = await loginAs(fx.adminEmail, 'yanlis-parola');
    const noSuchUser = await loginAs('olmayan@test.local');

    expect(wrongPassword.status).toBe(noSuchUser.status);
    expect(wrongPassword.body.error.message).toBe(noSuchUser.body.error.message);
  });

  it('pasif hesabı reddeder', async () => {
    await testPrisma.barber.update({
      where: { id: fx.staffId },
      data: { isActive: false },
    });

    const res = await loginAs(fx.staffEmail);
    expect(res.status).toBe(401);
  });

  it('geçersiz e-posta biçimini doğrulama hatasıyla reddeder', async () => {
    const res = await request(app)
      .post(`${BASE}/login`)
      .send({ email: 'eposta-degil', password: 'x' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('Hesap kilitleme', () => {
  it('5 hatalı denemeden sonra hesabı kilitler', async () => {
    for (let i = 0; i < 5; i++) {
      await loginAs(fx.staffEmail, 'yanlis-parola');
    }

    // Artık DOĞRU şifreyle bile girilemez
    const res = await loginAs(fx.staffEmail);

    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('kilitli');
  });

  it('kilit süresi sunucuda tutulur, istemci atlayamaz', async () => {
    for (let i = 0; i < 5; i++) {
      await loginAs(fx.staffEmail, 'yanlis-parola');
    }

    const barber = await testPrisma.barber.findUnique({ where: { id: fx.staffId } });
    expect(barber?.lockedUntil).toBeInstanceOf(Date);
    expect(barber!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it('başarılı giriş sayacı sıfırlar', async () => {
    await loginAs(fx.adminEmail, 'yanlis-parola');
    await loginAs(fx.adminEmail, 'yanlis-parola');

    const res = await loginAs(fx.adminEmail);
    expect(res.status).toBe(200);

    const barber = await testPrisma.barber.findUnique({ where: { id: fx.adminId } });
    expect(barber?.failedLoginCount).toBe(0);
  });
});

describe('GET /me', () => {
  it('jetonsuz erişimi reddeder', async () => {
    const res = await request(app).get(`${BASE}/me`);
    expect(res.status).toBe(401);
  });

  it('geçersiz jetonu reddeder', async () => {
    const res = await request(app)
      .get(`${BASE}/me`)
      .set('Authorization', 'Bearer uydurma.jeton.degeri');

    expect(res.status).toBe(401);
  });

  it('geçerli jetonla berber bilgilerini döner', async () => {
    const loginRes = await loginAs(fx.adminEmail);

    const res = await request(app)
      .get(`${BASE}/me`)
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.barber.id).toBe(fx.adminId);
    expect(res.body.barber.passwordHash).toBeUndefined();
  });
});

describe('POST /refresh — jeton rotasyonu', () => {
  it('geçerli çerezle yeni jeton üretir', async () => {
    const loginRes = await loginAs(fx.adminEmail);
    const cookie = extractCookie(loginRes.headers['set-cookie'], REFRESH_COOKIE);

    const res = await request(app)
      .post(`${BASE}/refresh`)
      .set('Cookie', `${REFRESH_COOKIE}=${cookie}`);

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
  });

  it('kullanılan jeton bir daha geçerli olmaz', async () => {
    const loginRes = await loginAs(fx.adminEmail);
    const oldCookie = extractCookie(loginRes.headers['set-cookie'], REFRESH_COOKIE);

    // İlk kullanım başarılı
    const first = await request(app)
      .post(`${BASE}/refresh`)
      .set('Cookie', `${REFRESH_COOKIE}=${oldCookie}`);
    expect(first.status).toBe(200);

    // Aynı jetonun ikinci kullanımı reddedilmeli
    const second = await request(app)
      .post(`${BASE}/refresh`)
      .set('Cookie', `${REFRESH_COOKIE}=${oldCookie}`);
    expect(second.status).toBe(401);
  });

  it('çalınmış jeton yeniden kullanılırsa TÜM oturumları kapatır', async () => {
    // Senaryo: saldırgan jetonu çaldı. Meşru kullanıcı yeniledi, eski jeton
    // iptal oldu. Saldırgan eski jetonu kullanmaya çalışıyor → bu bir hırsızlık
    // işaretidir, kullanıcının tüm oturumları kapatılır.
    const loginRes = await loginAs(fx.adminEmail);
    const stolenCookie = extractCookie(loginRes.headers['set-cookie'], REFRESH_COOKIE);

    const rotated = await request(app)
      .post(`${BASE}/refresh`)
      .set('Cookie', `${REFRESH_COOKIE}=${stolenCookie}`);
    const freshCookie = extractCookie(rotated.headers['set-cookie'], REFRESH_COOKIE);

    // Saldırgan eski jetonu deniyor
    await request(app)
      .post(`${BASE}/refresh`)
      .set('Cookie', `${REFRESH_COOKIE}=${stolenCookie}`);

    // Meşru kullanıcının YENİ jetonu da artık geçersiz olmalı
    const legitimate = await request(app)
      .post(`${BASE}/refresh`)
      .set('Cookie', `${REFRESH_COOKIE}=${freshCookie}`);

    expect(legitimate.status).toBe(401);
  });

  it('çerezsiz isteği reddeder', async () => {
    const res = await request(app).post(`${BASE}/refresh`);
    expect(res.status).toBe(401);
  });
});

describe('POST /logout', () => {
  it('yenileme jetonunu iptal eder', async () => {
    const loginRes = await loginAs(fx.adminEmail);
    const cookie = extractCookie(loginRes.headers['set-cookie'], REFRESH_COOKIE);

    const logoutRes = await request(app)
      .post(`${BASE}/logout`)
      .set('Cookie', `${REFRESH_COOKIE}=${cookie}`);
    expect(logoutRes.status).toBe(200);

    // Çıkıştan sonra jeton kullanılamaz
    const res = await request(app)
      .post(`${BASE}/refresh`)
      .set('Cookie', `${REFRESH_COOKIE}=${cookie}`);
    expect(res.status).toBe(401);
  });

  it('jeton olmadan çağrılsa da hata vermez', async () => {
    const res = await request(app).post(`${BASE}/logout`);
    expect(res.status).toBe(200);
  });
});

describe('POST /change-password', () => {
  it('yanlış mevcut şifreyle değiştirmeyi reddeder', async () => {
    const loginRes = await loginAs(fx.adminEmail);

    const res = await request(app)
      .post(`${BASE}/change-password`)
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
      .send({ currentPassword: 'yanlis', newPassword: 'yeni-parola-12345' });

    expect(res.status).toBe(400);
  });

  it('kısa yeni şifreyi reddeder', async () => {
    const loginRes = await loginAs(fx.adminEmail);

    const res = await request(app)
      .post(`${BASE}/change-password`)
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
      .send({ currentPassword: fx.password, newPassword: 'kisa' });

    expect(res.status).toBe(400);
  });

  it('şifreyi değiştirir ve tüm oturumları kapatır', async () => {
    const loginRes = await loginAs(fx.staffEmail);
    const cookie = extractCookie(loginRes.headers['set-cookie'], REFRESH_COOKIE);
    const newPassword = 'yepyeni-parola-98765';

    const res = await request(app)
      .post(`${BASE}/change-password`)
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
      .send({ currentPassword: fx.password, newPassword });

    expect(res.status).toBe(200);

    // Eski oturum düşmüş olmalı
    const refreshRes = await request(app)
      .post(`${BASE}/refresh`)
      .set('Cookie', `${REFRESH_COOKIE}=${cookie}`);
    expect(refreshRes.status).toBe(401);

    // Yeni şifreyle giriş yapılabilmeli
    const newLogin = await loginAs(fx.staffEmail, newPassword);
    expect(newLogin.status).toBe(200);

    // Sonraki testler için geri al
    await request(app)
      .post(`${BASE}/change-password`)
      .set('Authorization', `Bearer ${newLogin.body.accessToken}`)
      .send({ currentPassword: newPassword, newPassword: fx.password });
  });
});
