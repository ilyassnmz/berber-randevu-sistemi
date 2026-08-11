import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { maskPhone } from '@berber/shared';

/**
 * WhatsApp Cloud API istemcisi.
 *
 * Arayüz ve iki uygulaması var:
 *
 *   MetaWhatsAppClient — gerçek Meta Cloud API
 *   FakeWhatsAppClient — mesajları belleğe yazar, hiçbir yere göndermez
 *
 * Sahte istemci sayesinde chatbot'un tamamı Meta hesabı olmadan
 * geliştirilebiliyor ve test edilebiliyor. Gerçek numara geldiğinde tek
 * yapılacak şey .env'e anahtarları girmek — kod değişmiyor.
 */

export interface SendResult {
  success: boolean;
  /** Meta'nın mesaj kimliği. Sahte istemcide uydurulur. */
  wamid: string | null;
  errorCode?: string;
  errorText?: string;
}

export interface ReplyButton {
  /** Buton tıklandığında geri gelen kimlik. Maks 256 karakter. */
  id: string;
  /** Buton üzerindeki yazı. Maks 20 karakter. */
  title: string;
}

export interface ListRow {
  id: string;
  /** Maks 24 karakter. */
  title: string;
  /** Maks 72 karakter. */
  description?: string;
}

export interface WhatsAppClient {
  sendText(to: string, body: string): Promise<SendResult>;

  /** En fazla 3 buton — Meta sınırı. */
  sendButtons(to: string, body: string, buttons: ReplyButton[]): Promise<SendResult>;

  /** En fazla 10 satır — Meta sınırı. */
  sendList(
    to: string,
    body: string,
    buttonLabel: string,
    rows: ListRow[],
  ): Promise<SendResult>;

  /** 24 saatlik pencere dışında tek gönderilebilen mesaj türü. */
  sendTemplate(
    to: string,
    templateName: string,
    bodyParams: string[],
    languageCode?: string,
  ): Promise<SendResult>;
}

/** Meta sınırları — aşılırsa API hata döner, önceden kırpıyoruz. */
export const WHATSAPP_LIMITS = {
  MAX_BUTTONS: 3,
  MAX_LIST_ROWS: 10,
  BUTTON_TITLE: 20,
  LIST_ROW_TITLE: 24,
  LIST_ROW_DESCRIPTION: 72,
  BODY_TEXT: 1024,
} as const;

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

// ─────────────────────────────────────────────────────────
// Gerçek istemci
// ─────────────────────────────────────────────────────────

export class MetaWhatsAppClient implements WhatsAppClient {
  constructor(
    private readonly phoneNumberId: string,
    private readonly accessToken: string,
    private readonly apiVersion: string = env.WHATSAPP_API_VERSION,
  ) {}

  private get endpoint(): string {
    return `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;
  }

  private async post(payload: Record<string, unknown>): Promise<SendResult> {
    const body = JSON.stringify({ messaging_product: 'whatsapp', ...payload });

    // Üstel geri çekilmeli yeniden deneme: geçici ağ/oran hatalarında
    // mesajın büsbütün kaybolmasını engeller.
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetch(this.endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          body,
          signal: AbortSignal.timeout(15_000),
        });

        const json = (await response.json()) as {
          messages?: Array<{ id: string }>;
          error?: { code?: number; message?: string; error_subcode?: number };
        };

        if (response.ok && json.messages?.[0]) {
          return { success: true, wamid: json.messages[0].id };
        }

        const errorCode = String(json.error?.code ?? response.status);
        const errorText = json.error?.message ?? 'Bilinmeyen hata';

        // 4xx kalıcı hatadır (geçersiz numara, şablon uyuşmazlığı) —
        // tekrar denemek anlamsız. 5xx ve 429 geçicidir.
        const isRetryable = response.status >= 500 || response.status === 429;

        if (!isRetryable || attempt === maxAttempts) {
          logger.error(
            { errorCode, errorText, attempt },
            'WhatsApp mesajı gönderilemedi',
          );
          return { success: false, wamid: null, errorCode, errorText };
        }
      } catch (error) {
        if (attempt === maxAttempts) {
          logger.error({ err: error }, 'WhatsApp isteği başarısız');
          return {
            success: false,
            wamid: null,
            errorCode: 'NETWORK_ERROR',
            errorText: error instanceof Error ? error.message : String(error),
          };
        }
      }

      await new Promise((r) => setTimeout(r, 2 ** attempt * 500));
    }

    return { success: false, wamid: null, errorCode: 'UNKNOWN' };
  }

  sendText(to: string, body: string): Promise<SendResult> {
    return this.post({
      to,
      type: 'text',
      text: { body: truncate(body, WHATSAPP_LIMITS.BODY_TEXT), preview_url: false },
    });
  }

  sendButtons(to: string, body: string, buttons: ReplyButton[]): Promise<SendResult> {
    return this.post({
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: truncate(body, WHATSAPP_LIMITS.BODY_TEXT) },
        action: {
          buttons: buttons.slice(0, WHATSAPP_LIMITS.MAX_BUTTONS).map((b) => ({
            type: 'reply',
            reply: { id: b.id, title: truncate(b.title, WHATSAPP_LIMITS.BUTTON_TITLE) },
          })),
        },
      },
    });
  }

  sendList(
    to: string,
    body: string,
    buttonLabel: string,
    rows: ListRow[],
  ): Promise<SendResult> {
    return this.post({
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: truncate(body, WHATSAPP_LIMITS.BODY_TEXT) },
        action: {
          button: truncate(buttonLabel, WHATSAPP_LIMITS.BUTTON_TITLE),
          sections: [
            {
              rows: rows.slice(0, WHATSAPP_LIMITS.MAX_LIST_ROWS).map((r) => ({
                id: r.id,
                title: truncate(r.title, WHATSAPP_LIMITS.LIST_ROW_TITLE),
                ...(r.description
                  ? { description: truncate(r.description, WHATSAPP_LIMITS.LIST_ROW_DESCRIPTION) }
                  : {}),
              })),
            },
          ],
        },
      },
    });
  }

  sendTemplate(
    to: string,
    templateName: string,
    bodyParams: string[],
    languageCode = 'tr',
  ): Promise<SendResult> {
    return this.post({
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        ...(bodyParams.length > 0
          ? {
              components: [
                {
                  type: 'body',
                  parameters: bodyParams.map((text) => ({ type: 'text', text })),
                },
              ],
            }
          : {}),
      },
    });
  }
}

// ─────────────────────────────────────────────────────────
// Sahte istemci
// ─────────────────────────────────────────────────────────

export interface RecordedMessage {
  to: string;
  type: 'text' | 'buttons' | 'list' | 'template';
  body: string;
  buttons?: ReplyButton[];
  rows?: ListRow[];
  templateName?: string;
  templateParams?: string[];
  sentAt: Date;
}

/**
 * Hiçbir yere mesaj göndermez; gönderilenleri bellekte tutar.
 *
 * Geliştirmede konsola yazar, böylece chatbot akışı Meta hesabı olmadan
 * gerçek bir konuşma gibi izlenebilir. Testlerde `messages` dizisi üzerinden
 * "bot ne söyledi?" doğrulanır.
 */
export class FakeWhatsAppClient implements WhatsAppClient {
  readonly messages: RecordedMessage[] = [];

  constructor(private readonly logToConsole = false) {}

  private record(message: RecordedMessage): SendResult {
    this.messages.push(message);

    if (this.logToConsole) {
      logger.info(
        { to: maskPhone(message.to), type: message.type },
        `[SAHTE WhatsApp] ${message.body.split('\n')[0] ?? ''}`,
      );
    }

    return { success: true, wamid: `fake_${Date.now()}_${this.messages.length}` };
  }

  /** Son gönderilen mesaj — testlerde en sık kullanılan sorgu. */
  get lastMessage(): RecordedMessage | undefined {
    return this.messages.at(-1);
  }

  clear(): void {
    this.messages.length = 0;
  }

  sendText(to: string, body: string): Promise<SendResult> {
    return Promise.resolve(this.record({ to, type: 'text', body, sentAt: new Date() }));
  }

  sendButtons(to: string, body: string, buttons: ReplyButton[]): Promise<SendResult> {
    return Promise.resolve(
      this.record({ to, type: 'buttons', body, buttons, sentAt: new Date() }),
    );
  }

  sendList(
    to: string,
    body: string,
    _buttonLabel: string,
    rows: ListRow[],
  ): Promise<SendResult> {
    return Promise.resolve(this.record({ to, type: 'list', body, rows, sentAt: new Date() }));
  }

  sendTemplate(
    to: string,
    templateName: string,
    bodyParams: string[],
  ): Promise<SendResult> {
    return Promise.resolve(
      this.record({
        to,
        type: 'template',
        body: `[şablon: ${templateName}] ${bodyParams.join(' | ')}`,
        templateName,
        templateParams: bodyParams,
        sentAt: new Date(),
      }),
    );
  }
}

// ─────────────────────────────────────────────────────────
// Seçim
// ─────────────────────────────────────────────────────────

let clientInstance: WhatsAppClient | null = null;

/**
 * Yapılandırma tamsa gerçek istemciyi, değilse sahtesini döner.
 *
 * Böylece Meta hesabı olmadan da uygulama çalışır ve chatbot geliştirilebilir.
 */
export function getWhatsAppClient(): WhatsAppClient {
  if (clientInstance) return clientInstance;

  if (env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_ACCESS_TOKEN) {
    clientInstance = new MetaWhatsAppClient(
      env.WHATSAPP_PHONE_NUMBER_ID,
      env.WHATSAPP_ACCESS_TOKEN,
    );
    logger.info('WhatsApp: gerçek Meta istemcisi kullanılıyor');
  } else {
    clientInstance = new FakeWhatsAppClient(true);
    logger.warn('WhatsApp: SAHTE istemci kullanılıyor — mesajlar gönderilmiyor');
  }

  return clientInstance;
}

/** Testlerde istemciyi değiştirmek için. */
export function setWhatsAppClient(client: WhatsAppClient | null): void {
  clientInstance = client;
}
