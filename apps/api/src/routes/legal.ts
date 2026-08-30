import { Router } from 'express';

export const legalRouter: Router = Router();

/**
 * Gizlilik politikası — herkese açık, giriş gerektirmez.
 *
 * ⚠️ Bu sayfa dekoratif değil: Meta, WhatsApp Business hesabını onaylamadan
 * önce yayında bir gizlilik politikası URL'i istiyor. Ayrıca KVKK gereği
 * telefon numarası + ad toplayan her sistemin aydınlatma metni olmalı.
 *
 * ⚠️ Bu HUKUKİ bir belge — metin İlyas (geliştirici) tarafından taslak
 * olarak hazırlandı, avukat onaylı değil. Yayına almadan önce gözden
 * geçirilmesi öneriliyor.
 */
legalRouter.get('/gizlilik', (_req, res) => {
  res.type('html').send(PRIVACY_POLICY_HTML);
});

/**
 * KVKK başvuruları için iletişim adresi.
 *
 * Ortam değişkeninden okunuyor: aydınlatma metninde gerçek bir adres bulunmak
 * zorunda ama bu adres dükkana özel, kaynak koda ait değil.
 */
const KVKK_EPOSTA = process.env.LEGAL_CONTACT_EMAIL ?? 'info@ozdedehairstudio.com';

const PRIVACY_POLICY_HTML = `<!doctype html>
<html lang="tr">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Gizlilik Politikası — Özdede Hair Studio</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 720px; margin: 0 auto; padding: 32px 20px 64px; line-height: 1.65; color: #1a1a1a; }
  h1 { font-size: 24px; margin-bottom: 4px; }
  .updated { color: #666; font-size: 14px; margin-bottom: 32px; }
  h2 { font-size: 18px; margin-top: 32px; }
  ul { padding-left: 20px; }
  a { color: #b8860b; }
  .contact { background: #f7f7f7; border-radius: 8px; padding: 16px 20px; margin-top: 32px; }
</style>
</head>
<body>
  <h1>Gizlilik Politikası ve Aydınlatma Metni</h1>
  <p class="updated">Özdede Hair Studio · Son güncelleme: 12 Ağustos 2026</p>

  <p>
    Bu metin, 6698 sayılı Kişisel Verilerin Korunması Kanunu ("KVKK") uyarınca,
    Özdede Hair Studio ("işletme", "biz") tarafından WhatsApp üzerinden randevu
    hizmeti sunulurken işlenen kişisel verileriniz hakkında sizi bilgilendirmek
    amacıyla hazırlanmıştır.
  </p>

  <h2>1. Hangi verileri topluyoruz?</h2>
  <ul>
    <li><strong>Ad ve soyad</strong> — randevunuzu tanımlamak için</li>
    <li><strong>Telefon numarası</strong> — WhatsApp üzerinden mesajlaştığınız numara</li>
    <li><strong>Randevu geçmişi</strong> — aldığınız, iptal ettiğiniz veya katılmadığınız randevular</li>
  </ul>
  <p>Sağlık, ödeme veya konum bilgisi gibi başka bir veri talep etmiyor ve işlemiyoruz.</p>

  <h2>2. Verilerinizi neden işliyoruz?</h2>
  <ul>
    <li>Randevu oluşturmak, değiştirmek ve iptal etmek</li>
    <li>Randevu hatırlatma mesajı göndermek (1 gün ve 1 saat önce)</li>
    <li>Randevuya gelmeme geçmişini takip ederek hizmet kalitesini korumak</li>
  </ul>

  <h2>3. Verileriniz kimlerle paylaşılıyor?</h2>
  <p>
    Mesajlaşma altyapısı için <strong>Meta (WhatsApp Business Platform)</strong>
    kullanılmaktadır; mesajlarınız bu hizmet üzerinden iletilir. Verileriniz
    başka hiçbir üçüncü tarafla, reklam amacıyla veya pazarlama şirketleriyle
    paylaşılmaz, satılmaz.
  </p>

  <h2>4. Verileriniz ne kadar süre saklanır?</h2>
  <p>
    Verileriniz, işletmeyle aktif randevu ilişkiniz sürdüğü müddetçe saklanır.
    Uzun süreli hareketsizlik sonrasında verileriniz silinebilir veya
    anonimleştirilebilir.
  </p>

  <h2>5. Haklarınız</h2>
  <p>KVKK madde 11 uyarınca şu haklara sahipsiniz:</p>
  <ul>
    <li>Verilerinizin işlenip işlenmediğini öğrenme</li>
    <li>İşlenmişse buna ilişkin bilgi talep etme</li>
    <li>Verilerinizin düzeltilmesini veya silinmesini isteme</li>
    <li>İşlemenin kanuna aykırı olması hâlinde zararın giderilmesini talep etme</li>
  </ul>
  <p>
    WhatsApp üzerinden <strong>"DUR"</strong> yazarak randevu hatırlatma ve
    bilgilendirme mesajlarını istediğiniz zaman durdurabilirsiniz.
  </p>

  <h2>6. İletişim</h2>
  <div class="contact">
    <p>Verilerinizle ilgili sorularınız veya talepleriniz için:</p>
    <p>📧 <a href="mailto:${KVKK_EPOSTA}">${KVKK_EPOSTA}</a></p>
  </div>
</body>
</html>`;
