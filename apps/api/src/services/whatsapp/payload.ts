/**
 * Meta webhook gövdesinin ayrıştırılması.
 *
 * Meta'nın yapısı derin ve çoğu alan opsiyonel. Ayrıştırmayı tek yerde
 * toplayıp geri kalan koda düz bir tip veriyoruz — böylece `entry[0].changes[0]
 * .value.messages[0]` zincirini her yerde tekrar etmiyoruz.
 */

export interface InboundMessage {
  /** Meta mesaj kimliği. Idempotency bunun üzerine kurulu. */
  wamid: string;
  /**
   * Mesajın geldiği WhatsApp numarasının Meta kimliği.
   * Hangi dükkana ait olduğu bundan çözülür (`shops.whatsappPhoneId`).
   */
  phoneNumberId: string | null;
  /** Gönderenin E.164 numarası (baştaki + olmadan gelir). */
  from: string;
  /** WhatsApp profilindeki ad — chatbot'un ad sorma adımında öneri olarak kullanılır. */
  profileName: string | null;
  timestamp: Date;
  /**
   * Kullanıcının verdiği yanıtın metin karşılığı.
   *
   * Butona/liste satırına tıklandıysa buton kimliği (`id`) gelir; düz metin
   * yazıldıysa metnin kendisi. Chatbot ikisini de aynı şekilde işleyebilsin
   * diye tek alanda birleştirildi.
   */
  text: string;
  /** Butondan mı geldi, elle mi yazıldı? */
  isInteractive: boolean;
  /** Desteklenmeyen tür (resim, ses, konum...) */
  unsupportedType: string | null;
}

export interface StatusUpdate {
  wamid: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  errorCode: string | null;
  errorText: string | null;
}

export interface ParsedWebhook {
  messages: InboundMessage[];
  statuses: StatusUpdate[];
}

interface RawWebhook {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
        messages?: Array<Record<string, unknown>>;
        statuses?: Array<Record<string, unknown>>;
      };
    }>;
  }>;
}

const SUPPORTED_TYPES = new Set(['text', 'interactive', 'button']);

export function parseWebhook(body: unknown): ParsedWebhook {
  const messages: InboundMessage[] = [];
  const statuses: StatusUpdate[] = [];

  const raw = body as RawWebhook;
  if (!raw?.entry) return { messages, statuses };

  for (const entry of raw.entry) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      // Profil adı contacts dizisinde, mesajla ayrı geliyor
      const profileName = value.contacts?.[0]?.profile?.name ?? null;
      const phoneNumberId = value.metadata?.phone_number_id ?? null;

      for (const msg of value.messages ?? []) {
        const parsed = parseMessage(msg, profileName, phoneNumberId);
        if (parsed) messages.push(parsed);
      }

      for (const status of value.statuses ?? []) {
        const parsed = parseStatus(status);
        if (parsed) statuses.push(parsed);
      }
    }
  }

  return { messages, statuses };
}

function parseMessage(
  msg: Record<string, unknown>,
  profileName: string | null,
  phoneNumberId: string | null,
): InboundMessage | null {
  const wamid = typeof msg.id === 'string' ? msg.id : null;
  const from = typeof msg.from === 'string' ? msg.from : null;
  const type = typeof msg.type === 'string' ? msg.type : 'unknown';

  if (!wamid || !from) return null;

  const timestamp =
    typeof msg.timestamp === 'string'
      ? new Date(Number(msg.timestamp) * 1000)
      : new Date();

  const base = {
    wamid,
    phoneNumberId,
    // Meta numarayı + olmadan gönderir; kendi kayıtlarımız E.164 formatında.
    from: from.startsWith('+') ? from : `+${from}`,
    profileName,
    timestamp,
    isInteractive: false,
    unsupportedType: null as string | null,
  };

  if (type === 'text') {
    const text = (msg.text as { body?: string } | undefined)?.body ?? '';
    return { ...base, text: text.trim() };
  }

  if (type === 'interactive') {
    const interactive = msg.interactive as
      | {
          type?: string;
          button_reply?: { id?: string; title?: string };
          list_reply?: { id?: string; title?: string };
        }
      | undefined;

    const reply = interactive?.button_reply ?? interactive?.list_reply;
    if (reply?.id) {
      return { ...base, text: reply.id, isInteractive: true };
    }
    return { ...base, text: '', isInteractive: true };
  }

  // Eski tarz şablon butonu
  if (type === 'button') {
    const payload = (msg.button as { payload?: string; text?: string } | undefined)?.payload;
    return { ...base, text: (payload ?? '').trim(), isInteractive: true };
  }

  // Resim, ses, konum, sticker... Chatbot bunları anlamaz ama sessiz kalmamalı.
  if (!SUPPORTED_TYPES.has(type)) {
    return { ...base, text: '', unsupportedType: type };
  }

  return null;
}

function parseStatus(status: Record<string, unknown>): StatusUpdate | null {
  const wamid = typeof status.id === 'string' ? status.id : null;
  const statusValue = typeof status.status === 'string' ? status.status : null;

  if (!wamid || !statusValue) return null;
  if (!['sent', 'delivered', 'read', 'failed'].includes(statusValue)) return null;

  const errors = status.errors as Array<{ code?: number; title?: string }> | undefined;
  const firstError = errors?.[0];

  return {
    wamid,
    status: statusValue as StatusUpdate['status'],
    errorCode: firstError?.code != null ? String(firstError.code) : null,
    errorText: firstError?.title ?? null,
  };
}
