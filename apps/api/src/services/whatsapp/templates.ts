/**
 * Meta'ya onaylatılacak mesaj şablonları.
 *
 * ── Neden şablon gerekiyor? ───────────────────────────────────────
 *
 * WhatsApp, müşterinin son mesajından sonraki 24 saat boyunca serbest metin
 * yazmaya izin verir. Bu pencerenin DIŞINDA yalnızca Meta'nın önceden
 * onayladığı şablonlar gönderilebilir.
 *
 * "Yarın randevunuz var" hatırlatması tanımı gereği bu pencerenin dışındadır
 * — müşteri randevuyu bir gün önce almış, 24 saat çoktan geçmiştir.
 * Serbest metin olarak kodlanırsa geliştirmede çalışır (çünkü test ederken
 * az önce mesaj atmışsınızdır), üretimde sessizce başarısız olur.
 *
 * ── Kategori seçimi maliyeti belirler ─────────────────────────────
 *
 * Hepsi UTILITY olmalı. MARKETING kategorisi kat kat pahalı ve bu mesajların
 * hiçbiri pazarlama değil — hepsi kullanıcının kendi işlemiyle ilgili.
 */

export interface TemplateDefinition {
  /** Meta panelinde oluşturulacak ad. Küçük harf ve alt çizgi. */
  name: string;
  category: 'UTILITY';
  language: 'tr';
  /** {{1}}, {{2}} ... sırasıyla bodyParams'a karşılık gelir. */
  body: string;
  /** Parametrelerin ne olduğunu açıklar — Meta onay formunda örnek istenir. */
  params: string[];
}

export const TEMPLATES = {
  APPOINTMENT_CONFIRMED: {
    name: 'randevu_onay',
    category: 'UTILITY',
    language: 'tr',
    body:
      'Randevunuz oluşturuldu ✅\n\n' +
      '📅 {{1}}\n' +
      '🕘 {{2}}\n' +
      '💈 {{3}}\n' +
      '✂️ {{4}}\n\n' +
      'Görüşmek üzere!',
    params: ['tarih', 'saat', 'berber adı', 'hizmet'],
  },

  REMINDER_1_DAY: {
    name: 'hatirlatma_1gun',
    category: 'UTILITY',
    language: 'tr',
    body:
      'Hatırlatma 📅\n\n' +
      'Yarın saat {{1}}\'te {{2}} ile randevunuz var.\n\n' +
      'İptal etmek isterseniz bu mesaja yanıt verin.',
    params: ['saat', 'berber adı'],
  },

  REMINDER_1_HOUR: {
    name: 'hatirlatma_1saat',
    category: 'UTILITY',
    language: 'tr',
    body: 'Randevunuza 1 saat kaldı ⏰\n\nSaat {{1}}\'te {{2}} sizi bekliyor 💈',
    params: ['saat', 'berber adı'],
  },

  CANCELLED_BY_BARBER: {
    name: 'berber_iptal',
    category: 'UTILITY',
    language: 'tr',
    body:
      'Randevunuz iptal edildi ❌\n\n' +
      '📅 {{1}} — 🕘 {{2}}\n\n' +
      'Özür dileriz. Yeni randevu için bu mesaja yanıt verebilirsiniz.',
    params: ['tarih', 'saat'],
  },

  RESCHEDULED_BY_BARBER: {
    name: 'saat_degisikligi',
    category: 'UTILITY',
    language: 'tr',
    body:
      'Randevu saatiniz değişti 🔄\n\n' +
      'Eski: {{1}}\n' +
      'Yeni: {{2}}\n\n' +
      'Uygun değilse bu mesaja yanıt verin.',
    params: ['eski tarih ve saat', 'yeni tarih ve saat'],
  },
} as const satisfies Record<string, TemplateDefinition>;

export type TemplateKey = keyof typeof TEMPLATES;

/**
 * Meta panelinde şablon oluştururken kopyalanacak metni üretir.
 * `npm run whatsapp:templates` ile yazdırılır.
 */
export function printTemplatesForMetaConsole(): string {
  const lines: string[] = [
    '═'.repeat(70),
    '  META ŞABLONLARI — developers.facebook.com → WhatsApp → Message Templates',
    '═'.repeat(70),
    '',
    'Her biri için: New Template → Category: Utility → Language: Turkish',
    '',
  ];

  for (const [key, tpl] of Object.entries(TEMPLATES)) {
    lines.push('─'.repeat(70));
    lines.push(`  ${key}`);
    lines.push('─'.repeat(70));
    lines.push(`  Ad       : ${tpl.name}`);
    lines.push(`  Kategori : ${tpl.category}`);
    lines.push(`  Dil      : Türkçe (tr)`);
    lines.push('');
    lines.push('  Gövde:');
    for (const line of tpl.body.split('\n')) {
      lines.push(`    ${line}`);
    }
    lines.push('');
    lines.push(`  Parametreler: ${tpl.params.map((p, i) => `{{${i + 1}}} = ${p}`).join(', ')}`);
    lines.push('');
  }

  lines.push('═'.repeat(70));
  lines.push('  Onay genelde 1-3 gün sürer. Onaylanmadan hatırlatmalar gönderilemez.');
  lines.push('═'.repeat(70));

  return lines.join('\n');
}
