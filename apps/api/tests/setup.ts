import { testVeritabaninaYonlendir } from './db-env.js';

/**
 * Entegrasyon testleri için ortam hazırlığı — her test dosyasından önce.
 *
 * Veritabanı yönlendirmesi ve üretim koruması `db-env.ts` içinde; burada
 * yalnızca uygulamanın açılış kontrollerini geçmek için gereken değerler var.
 */

testVeritabaninaYonlendir();

// env.ts üretim kontrollerini tetiklemesin
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET ??= 'test-secret-en-az-otuz-iki-karakter-olmali-tamam';
