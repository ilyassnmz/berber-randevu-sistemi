import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createFixture, destroyFixture, testPrisma, type TestFixture } from './helpers.js';
import { handleInboundMessage } from '../src/services/chatbot/handler.js';
import { FakeWhatsAppClient, setWhatsAppClient } from '../src/services/whatsapp/client.js';
import type { InboundMessage } from '../src/services/whatsapp/payload.js';
import { ACTION, PREFIX, CHAT_STATE } from '../src/services/chatbot/states.js';

/**
 * ══════════════════════════════════════════════════════════════════
 *  CHATBOT — SAHTE WHATSAPP İLE UÇTAN UCA TEST
 * ══════════════════════════════════════════════════════════════════
 *
 * Meta hesabı olmadan chatbot'un tamamı burada sınanıyor. Sahte istemci
 * mesajları hiçbir yere göndermiyor, belleğe yazıyor; testler "bot ne
 * söyledi?" ve "hangi butonları gösterdi?" sorularını bunun üzerinden
 * doğruluyor.
 *
 * Gerçek numara geldiğinde tek değişiklik .env'e anahtarları girmek olacak —
 * bu testler aynen çalışmaya devam eder.
 */

const fake = new FakeWhatsAppClient();
let fx: TestFixture;
let shop: { id: string; timezone: string; contactPhone: string | null; cancelCutoffMin: number };

const CUSTOMER_PHONE = '+905551112233';
let messageCounter = 0;

/** Müşteriden gelen bir WhatsApp mesajı üretir. */
function inbound(text: string, from = CUSTOMER_PHONE): InboundMessage {
  messageCounter += 1;
  return {
    wamid: `wamid.test.${Date.now()}.${messageCounter}`,
    phoneNumberId: 'test-phone-id',
    from,
    profileName: 'Test Profili',
    timestamp: new Date(),
    text,
    isInteractive: text.includes(':') || text.startsWith('action_'),
    unsupportedType: null,
  };
}

/** Mesajı bota gönderir ve botun verdiği yanıtları döner. */
async function send(text: string, from = CUSTOMER_PHONE) {
  fake.clear();
  await handleInboundMessage(inbound(text, from), shop);
  return fake.messages;
}

/** Botun son mesajındaki buton/liste kimlikleri. */
function optionIds(): string[] {
  const last = fake.lastMessage;
  return [
    ...(last?.buttons?.map((b) => b.id) ?? []),
    ...(last?.rows?.map((r) => r.id) ?? []),
  ];
}

function lastBody(): string {
  return fake.lastMessage?.body ?? '';
}

beforeAll(async () => {
  setWhatsAppClient(fake);
  fx = await createFixture();

  const created = await testPrisma.shop.update({
    where: { id: fx.shopId },
    data: { whatsappPhoneId: 'test-phone-id', contactPhone: '0532 000 00 00' },
  });
  shop = {
    id: created.id,
    timezone: created.timezone,
    contactPhone: created.contactPhone,
    cancelCutoffMin: created.cancelCutoffMin,
  };

  // Tek berber bırakıyoruz: bot tek berber varsa seçim sormuyor,
  // akış daha net izleniyor. Çoklu berber ayrı testte.
  await testPrisma.barber.update({ where: { id: fx.staffId }, data: { isActive: false } });

  await testPrisma.workingHours.createMany({
    data: Array.from({ length: 7 }, (_, dayOfWeek) => ({
      shopId: fx.shopId,
      barberId: fx.adminId,
      dayOfWeek,
      startTime: '09:00',
      endTime: '20:15',
      isWorking: true,
    })),
    skipDuplicates: true,
  });
});

afterAll(async () => {
  setWhatsAppClient(null);
  await testPrisma.chatSession.deleteMany({ where: { shopId: fx.shopId } });
  await destroyFixture(fx.shopId);
  await testPrisma.$disconnect();
});

beforeEach(async () => {
  // Her test temiz bir konuşmayla başlasın
  await testPrisma.chatSession.deleteMany({ where: { shopId: fx.shopId } });
  await testPrisma.appointment.deleteMany({ where: { shopId: fx.shopId } });
  await testPrisma.customer.deleteMany({
    where: { shopId: fx.shopId, phone: CUSTOMER_PHONE },
  });
  fake.clear();
});

describe('İlk temas', () => {
  it('selamlamaya menüyle karşılık verir', async () => {
    await send('merhaba');

    expect(lastBody()).toContain('hoş geldiniz');
    expect(optionIds()).toEqual([
      ACTION.BOOK,
      ACTION.MY_APPOINTMENTS,
      ACTION.CANCEL,
    ]);
  });

  it('ilk temasta KVKK bilgilendirmesi gösterir', async () => {
    await send('merhaba');
    expect(lastBody()).toContain('Kişisel verileriniz');
  });

  it('yeni müşteriyi kaydeder ve onay zamanını işaretler', async () => {
    await send('merhaba');

    const customer = await testPrisma.customer.findFirst({
      where: { shopId: fx.shopId, phone: CUSTOMER_PHONE },
    });

    expect(customer).not.toBeNull();
    expect(customer!.consentAt).toBeInstanceOf(Date);
  });
});

describe('Randevu alma akışı', () => {
  it('ilk kez gelen müşteriden ad ister', async () => {
    await send('merhaba');
    await send(ACTION.BOOK);

    expect(lastBody()).toContain('adınızı');

    const session = await testPrisma.chatSession.findUnique({ where: { phone: CUSTOMER_PHONE } });
    expect(session?.state).toBe(CHAT_STATE.ASK_NAME);
  });

  it('adı kaydeder ve tarih sorar', async () => {
    await send('merhaba');
    await send(ACTION.BOOK);
    await send('Ahmet Yılmaz');

    const customer = await testPrisma.customer.findFirst({
      where: { shopId: fx.shopId, phone: CUSTOMER_PHONE },
    });
    expect(customer?.name).toBe('Ahmet Yılmaz');

    // Tek berber olduğu için berber sorulmadan tarihe geçmeli
    expect(lastBody()).toContain('Hangi gün');
    expect(optionIds()).toContain(ACTION.DATE_TOMORROW);
  });

  it('tarih seçilince müsait saatleri listeler', async () => {
    await send('merhaba');
    await send(ACTION.BOOK);
    await send('Ahmet Yılmaz');
    await send(ACTION.DATE_TOMORROW);

    const ids = optionIds();
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => id.startsWith(PREFIX.SLOT) || id === ACTION.MORE_TIMES)).toBe(true);
  });

  it('saat seçilince hizmet sorar', async () => {
    await send('merhaba');
    await send(ACTION.BOOK);
    await send('Ahmet Yılmaz');
    await send(ACTION.DATE_TOMORROW);

    const slotId = optionIds().find((id) => id.startsWith(PREFIX.SLOT))!;
    await send(slotId);

    expect(lastBody()).toContain('Ne yaptırmak');
    expect(optionIds().some((id) => id.startsWith(PREFIX.SERVICE))).toBe(true);
  });

  it('hizmet seçilince özet gösterir', async () => {
    await send('merhaba');
    await send(ACTION.BOOK);
    await send('Ahmet Yılmaz');
    await send(ACTION.DATE_TOMORROW);
    const slotId = optionIds().find((id) => id.startsWith(PREFIX.SLOT))!;
    await send(slotId);
    await send(`${PREFIX.SERVICE}${fx.serviceId}`);

    expect(lastBody()).toContain('Randevu Özeti');
    expect(lastBody()).toContain('Test Hizmet');
    expect(optionIds()).toEqual([ACTION.CONFIRM_YES, ACTION.CONFIRM_NO]);
  });

  it('onaylayınca randevu OLUŞTURUR', async () => {
    await send('merhaba');
    await send(ACTION.BOOK);
    await send('Ahmet Yılmaz');
    await send(ACTION.DATE_TOMORROW);
    const slotId = optionIds().find((id) => id.startsWith(PREFIX.SLOT))!;
    await send(slotId);
    await send(`${PREFIX.SERVICE}${fx.serviceId}`);
    await send(ACTION.CONFIRM_YES);

    expect(lastBody()).toContain('Randevunuz oluşturuldu');

    const appointments = await testPrisma.appointment.findMany({
      where: { shopId: fx.shopId },
      include: { customer: true },
    });

    expect(appointments).toHaveLength(1);
    expect(appointments[0]!.status).toBe('confirmed');
    expect(appointments[0]!.source).toBe('whatsapp');
    expect(appointments[0]!.customer.name).toBe('Ahmet Yılmaz');
  });

  it('vazgeçilince randevu oluşturmaz', async () => {
    await send('merhaba');
    await send(ACTION.BOOK);
    await send('Ahmet Yılmaz');
    await send(ACTION.DATE_TOMORROW);
    const slotId = optionIds().find((id) => id.startsWith(PREFIX.SLOT))!;
    await send(slotId);
    await send(`${PREFIX.SERVICE}${fx.serviceId}`);
    await send(ACTION.CONFIRM_NO);

    const count = await testPrisma.appointment.count({ where: { shopId: fx.shopId } });
    expect(count).toBe(0);
  });

  it('adı bilinen müşteriye tekrar ad sormaz', async () => {
    await testPrisma.customer.create({
      data: { shopId: fx.shopId, name: 'Bilinen Müşteri', phone: CUSTOMER_PHONE },
    });

    await send('merhaba');
    await send(ACTION.BOOK);

    expect(lastBody()).not.toContain('adınızı');
    expect(lastBody()).toContain('Hangi gün');
  });

  it('düz metinle de randevu alınabilir (buton kullanmayan müşteri)', async () => {
    await send('merhaba');
    await send('1'); // "Randevu Al" yerine
    expect(lastBody()).toContain('adınızı');
  });
});

describe('Aynı güne ikinci randevu engeli', () => {
  it('aynı güne ikinci randevuyu reddeder', async () => {
    // İlk randevu
    await send('merhaba');
    await send(ACTION.BOOK);
    await send('Ahmet Yılmaz');
    await send(ACTION.DATE_TOMORROW);
    const firstSlot = optionIds().find((id) => id.startsWith(PREFIX.SLOT))!;
    await send(firstSlot);
    await send(`${PREFIX.SERVICE}${fx.serviceId}`);
    await send(ACTION.CONFIRM_YES);

    // Aynı gün için ikinci deneme
    await send(ACTION.BOOK);
    await send(ACTION.DATE_TOMORROW);
    const secondSlot = optionIds().find((id) => id.startsWith(PREFIX.SLOT))!;
    await send(secondSlot);
    await send(`${PREFIX.SERVICE}${fx.serviceId}`);
    await send(ACTION.CONFIRM_YES);

    expect(lastBody()).toContain('zaten bir randevunuz var');

    const count = await testPrisma.appointment.count({ where: { shopId: fx.shopId } });
    expect(count).toBe(1);
  });
});

describe('Randevularım ve iptal', () => {
  async function bookOne(): Promise<string> {
    await send('merhaba');
    await send(ACTION.BOOK);
    await send('Ahmet Yılmaz');
    await send(ACTION.DATE_TOMORROW);
    const slotId = optionIds().find((id) => id.startsWith(PREFIX.SLOT))!;
    await send(slotId);
    await send(`${PREFIX.SERVICE}${fx.serviceId}`);
    await send(ACTION.CONFIRM_YES);

    const appointment = await testPrisma.appointment.findFirst({ where: { shopId: fx.shopId } });
    return appointment!.id;
  }

  it('aktif randevuları listeler', async () => {
    await bookOne();
    await send(ACTION.MY_APPOINTMENTS);

    expect(lastBody()).toContain('Aktif randevularınız');
    expect(lastBody()).toContain('Test Hizmet');
  });

  it('randevu yoksa uygun mesaj verir', async () => {
    await send('merhaba');
    await send(ACTION.MY_APPOINTMENTS);

    expect(lastBody()).toContain('Aktif randevunuz bulunmuyor');
  });

  it('randevuyu iptal eder', async () => {
    const appointmentId = await bookOne();

    await send(ACTION.CANCEL);
    expect(optionIds().some((id) => id.startsWith(PREFIX.APPOINTMENT))).toBe(true);

    await send(`${PREFIX.APPOINTMENT}${appointmentId}`);
    expect(lastBody()).toContain('emin misiniz');

    await send(ACTION.CONFIRM_YES);
    expect(lastBody()).toContain('iptal edildi');

    const appointment = await testPrisma.appointment.findUnique({ where: { id: appointmentId } });
    expect(appointment?.status).toBe('cancelled');
    expect(appointment?.cancelledBy).toBe('customer');
  });

  it('iptalden vazgeçilince randevu durur', async () => {
    const appointmentId = await bookOne();

    await send(ACTION.CANCEL);
    await send(`${PREFIX.APPOINTMENT}${appointmentId}`);
    await send(ACTION.CONFIRM_NO);

    const appointment = await testPrisma.appointment.findUnique({ where: { id: appointmentId } });
    expect(appointment?.status).toBe('confirmed');
  });

  it('kesim saatine giren randevuyu iptal ettirmez', async () => {
    const appointmentId = await bookOne();

    // Randevuyu 30 dakika sonrasına çekiyoruz (kesim 120 dakika)
    await testPrisma.appointment.update({
      where: { id: appointmentId },
      data: {
        startsAt: new Date(Date.now() + 30 * 60_000),
        endsAt: new Date(Date.now() + 75 * 60_000),
      },
    });

    await send(ACTION.CANCEL);
    await send(`${PREFIX.APPOINTMENT}${appointmentId}`);

    expect(lastBody()).toContain('dakikadan az kaldığı için');
    expect(lastBody()).toContain('0532 000 00 00');

    const appointment = await testPrisma.appointment.findUnique({ where: { id: appointmentId } });
    expect(appointment?.status).toBe('confirmed');
  });
});

describe('Kara liste', () => {
  it('kara listedeki müşteriye randevu akışı açmaz', async () => {
    await testPrisma.customer.create({
      data: {
        shopId: fx.shopId,
        name: 'Kara Liste',
        phone: CUSTOMER_PHONE,
        isBlacklisted: true,
        blacklistNote: 'Test',
      },
    });

    await send('merhaba');

    expect(lastBody()).toContain('randevu alamıyorsunuz');
    // Sebep açıklanmıyor
    expect(lastBody()).not.toContain('kara liste');
    expect(optionIds()).toHaveLength(0);
  });
});

describe('Opt-out (Meta politikası)', () => {
  it('DUR yazınca mesaj almayı kapatır', async () => {
    await send('merhaba');
    await send('DUR');

    expect(lastBody()).toContain('durdurdunuz');

    const customer = await testPrisma.customer.findFirst({
      where: { shopId: fx.shopId, phone: CUSTOMER_PHONE },
    });
    expect(customer?.optedOut).toBe(true);
  });

  it('tekrar yazınca aboneliği geri açar', async () => {
    await send('merhaba');
    await send('DUR');
    await send('merhaba');

    const customer = await testPrisma.customer.findFirst({
      where: { shopId: fx.shopId, phone: CUSTOMER_PHONE },
    });
    expect(customer?.optedOut).toBe(false);
    expect(lastBody()).toContain('hoş geldiniz');
  });
});

describe('Hatalı girdi yönetimi', () => {
  it('anlaşılmayan mesajda menüyü tekrar gösterir', async () => {
    await send('merhaba');
    const messages = await send('asdfghjkl');

    expect(messages.some((m) => m.body.includes('anlayamadım'))).toBe(true);
  });

  it('3 hatalı girdiden sonra insana yönlendirir', async () => {
    await send('merhaba');
    await send('qwerty');
    await send('asdfgh');
    await send('zxcvbn');

    expect(lastBody()).toContain('0532 000 00 00');

    // Sayaç sıfırlanmalı ki müşteri baştan deneyebilsin
    const session = await testPrisma.chatSession.findUnique({ where: { phone: CUSTOMER_PHONE } });
    expect(session?.invalidInputCount).toBe(0);
  });

  it('desteklenmeyen mesaj türüne kibar yanıt verir', async () => {
    fake.clear();
    await handleInboundMessage(
      { ...inbound(''), unsupportedType: 'image' },
      shop,
    );

    expect(lastBody()).toContain('yazılı mesajları');
    expect(optionIds()).toContain(ACTION.BOOK);
  });
});

describe('Global komutlar', () => {
  it('MENÜ her adımda ana menüye döndürür', async () => {
    await send('merhaba');
    await send(ACTION.BOOK);
    await send('Ahmet Yılmaz');
    await send(ACTION.DATE_TOMORROW);

    await send('menü');

    expect(lastBody()).toContain('hoş geldiniz');
    const session = await testPrisma.chatSession.findUnique({ where: { phone: CUSTOMER_PHONE } });
    expect(session?.state).toBe(CHAT_STATE.MAIN_MENU);
  });
});

describe('Oturum yönetimi', () => {
  it('süresi dolmuş oturumu sıfırdan başlatır', async () => {
    await send('merhaba');
    await send(ACTION.BOOK);

    // Oturumu geçmişe çekiyoruz
    await testPrisma.chatSession.update({
      where: { phone: CUSTOMER_PHONE },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    await send('merhaba');

    // Ad sorma adımında kalmamalı, baştan başlamalı
    expect(lastBody()).toContain('hoş geldiniz');
  });

  it('farklı müşteriler eş zamanlı konuşabilir', async () => {
    const other = '+905554445566';

    await send('merhaba');
    await send(ACTION.BOOK);

    await send('merhaba', other);

    const sessions = await testPrisma.chatSession.findMany({ where: { shopId: fx.shopId } });
    expect(sessions.length).toBeGreaterThanOrEqual(2);

    const mine = sessions.find((s) => s.phone === CUSTOMER_PHONE);
    const theirs = sessions.find((s) => s.phone === other);

    // Birbirinin durumunu ezmemeli
    expect(mine?.state).toBe(CHAT_STATE.ASK_NAME);
    expect(theirs?.state).toBe(CHAT_STATE.MAIN_MENU);

    await testPrisma.customer.deleteMany({ where: { shopId: fx.shopId, phone: other } });
  });
});

describe('Spam koruması', () => {
  it('1 dakikada eşiği aşan mesajlar sessizce atlanır ve 5 dakikalık susma başlar', async () => {
    const spammer = '+905557778899';

    // Eşiğin (20) altında kalan mesajlar normal işlenmeye devam etmeli
    for (let i = 0; i < 20; i++) {
      await send('merhaba', spammer);
    }

    // 21. mesaj eşiği aşıyor — bot hiçbir şey söylememeli
    const replies = await send('merhaba', spammer);
    expect(replies).toHaveLength(0);

    const customer = await testPrisma.customer.findFirst({
      where: { shopId: fx.shopId, phone: spammer },
    });
    expect(customer?.silencedUntil).toBeTruthy();
    expect(customer!.silencedUntil!.getTime()).toBeGreaterThan(Date.now());

    // Susma sürerken gelen bir mesaj da sessizce atlanmalı
    const stillSilent = await send('MENÜ', spammer);
    expect(stillSilent).toHaveLength(0);

    await testPrisma.customer.deleteMany({ where: { shopId: fx.shopId, phone: spammer } });
  });
});
