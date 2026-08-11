import { maskPhone } from '@berber/shared';
import { prisma } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { getWhatsAppClient, type ReplyButton, type ListRow, type SendResult } from './client.js';
import { TEMPLATES, type TemplateKey } from './templates.js';

/**
 * Müşteriye mesaj gönderme katmanı.
 *
 * Üç sorumluluğu var ve üçü de dağıtılmamalı:
 *   1. 24 saat penceresi kararı — serbest metin mi, şablon mu?
 *   2. Opt-out kontrolü — "DUR" diyene mesaj gönderilmez (Meta politikası)
 *   3. Her gönderimin outbound_messages'a kaydı — hata ayıklama ve maliyet takibi
 */

/** WhatsApp'ın serbest mesaj penceresi. */
const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Müşteri, serbest metin gönderilebilecek pencerede mi?
 *
 * Pencere müşterinin BİZE attığı son mesajdan itibaren sayılır.
 */
export function isWithinServiceWindow(
  lastInboundAt: Date | null | undefined,
  now = new Date(),
): boolean {
  if (!lastInboundAt) return false;
  return now.getTime() - lastInboundAt.getTime() < SERVICE_WINDOW_MS;
}

interface CustomerTarget {
  id: string;
  shopId: string;
  phone: string | null;
  optedOut: boolean;
  lastInboundAt: Date | null;
}

async function loadCustomer(customerId: string): Promise<CustomerTarget | null> {
  return prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, shopId: true, phone: true, optedOut: true, lastInboundAt: true },
  });
}

interface SendOutcome {
  sent: boolean;
  reason?: 'no_phone' | 'opted_out' | 'send_failed';
  result?: SendResult;
}

async function persistOutbound(params: {
  shopId: string;
  customerId: string | null;
  result: SendResult;
  bodyPreview: string;
  templateName?: string | undefined;
  category: 'service' | 'utility';
}): Promise<void> {
  try {
    await prisma.outboundMessage.create({
      data: {
        shopId: params.shopId,
        customerId: params.customerId,
        wamid: params.result.wamid,
        templateName: params.templateName ?? null,
        category: params.category,
        bodyPreview: params.bodyPreview.slice(0, 200),
        status: params.result.success ? 'sent' : 'failed',
        errorCode: params.result.errorCode ?? null,
        errorText: params.result.errorText ?? null,
        sentAt: params.result.success ? new Date() : null,
      },
    });
  } catch (error) {
    // Kayıt tutulamadı diye mesaj gönderimi başarısız sayılmaz.
    logger.error({ err: error }, 'Giden mesaj kaydı yazılamadı');
  }
}

/**
 * Chatbot yanıtı — yalnızca 24 saat penceresi içinde kullanılır.
 *
 * Müşteri bize mesaj attığı için buradayız, dolayısıyla pencere zaten açık.
 * Yine de kontrol ediyoruz: pencere kapalıysa mesaj Meta tarafından
 * reddedilir ve sebebini bilmeden hata ayıklamaya çalışırız.
 */
export async function replyToCustomer(
  customer: CustomerTarget,
  body: string,
  options?: { buttons?: ReplyButton[]; list?: { buttonLabel: string; rows: ListRow[] } },
): Promise<SendOutcome> {
  if (!customer.phone) return { sent: false, reason: 'no_phone' };
  if (customer.optedOut) return { sent: false, reason: 'opted_out' };

  const client = getWhatsAppClient();

  let result: SendResult;
  if (options?.buttons?.length) {
    result = await client.sendButtons(customer.phone, body, options.buttons);
  } else if (options?.list?.rows.length) {
    result = await client.sendList(
      customer.phone,
      body,
      options.list.buttonLabel,
      options.list.rows,
    );
  } else {
    result = await client.sendText(customer.phone, body);
  }

  await persistOutbound({
    shopId: customer.shopId,
    customerId: customer.id,
    result,
    bodyPreview: body,
    category: 'service',
  });

  return result.success ? { sent: true, result } : { sent: false, reason: 'send_failed', result };
}

/**
 * Şablon mesajı — 24 saat penceresi dışında tek seçenek.
 *
 * Hatırlatmalar, berber kaynaklı iptal ve saat değişikliği bildirimleri
 * bu yolla gider.
 */
export async function sendTemplateToCustomer(
  customerId: string,
  templateKey: TemplateKey,
  params: string[],
): Promise<SendOutcome> {
  const customer = await loadCustomer(customerId);

  if (!customer) {
    logger.warn({ customerId }, 'Şablon gönderilemedi: müşteri bulunamadı');
    return { sent: false, reason: 'no_phone' };
  }
  if (!customer.phone) return { sent: false, reason: 'no_phone' };
  if (customer.optedOut) {
    logger.info({ customerId }, 'Şablon gönderilmedi: müşteri mesaj almak istemiyor');
    return { sent: false, reason: 'opted_out' };
  }

  const template = TEMPLATES[templateKey];
  const client = getWhatsAppClient();

  const result = await client.sendTemplate(customer.phone, template.name, params);

  await persistOutbound({
    shopId: customer.shopId,
    customerId: customer.id,
    result,
    bodyPreview: `${template.name}: ${params.join(' | ')}`,
    templateName: template.name,
    category: 'utility',
  });

  if (!result.success) {
    logger.error(
      { customerId, template: template.name, errorCode: result.errorCode },
      'Şablon mesajı gönderilemedi',
    );
  }

  return result.success ? { sent: true, result } : { sent: false, reason: 'send_failed', result };
}

/**
 * Duruma göre serbest metin veya şablon seçer.
 *
 * Bu karar TEK bir yerde verilsin diye burada. Dağıtılırsa, bir yerde
 * unutulur ve o mesaj üretimde sessizce gönderilmez.
 */
export async function sendToCustomer(
  customerId: string,
  options: {
    /** Pencere açıksa gönderilecek metin. */
    text: string;
    /** Pencere kapalıysa kullanılacak şablon. */
    template: TemplateKey;
    templateParams: string[];
  },
): Promise<SendOutcome> {
  const customer = await loadCustomer(customerId);
  if (!customer) return { sent: false, reason: 'no_phone' };

  if (isWithinServiceWindow(customer.lastInboundAt)) {
    return replyToCustomer(customer, options.text);
  }

  logger.debug(
    { customerId, phone: customer.phone ? maskPhone(customer.phone) : null },
    '24 saat penceresi kapalı — şablona düşülüyor',
  );

  return sendTemplateToCustomer(customerId, options.template, options.templateParams);
}

/** Müşterinin son mesaj zamanını günceller — pencere hesabı buna dayanıyor. */
export async function touchInbound(customerId: string): Promise<void> {
  await prisma.customer.update({
    where: { id: customerId },
    data: { lastInboundAt: new Date() },
  });
}
