import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  ChevronLeft,
  CalendarCheck,
  CalendarX2,
  AlertCircle,
  Check,
  Phone,
  Scissors,
  Sun,
  Moon,
} from 'lucide-react';
import {
  normalizePhone,
  computeAppointmentDuration,
  sumServicePrices,
  MAX_SERVICES_PER_APPOINTMENT,
} from '@berber/shared';
import { fetchShopInfo, fetchSlots, createAppointment, ApiError } from '../lib/api';
import { storeToken, getStoredTokens } from '../lib/storage';
import { getStoredTheme, toggleTheme, type Theme } from '../lib/theme';
import {
  buildDateStrip,
  formatDateChip,
  formatDateLong,
  formatPrice,
  formatDuration,
  formatAppointmentMoment,
  dayOfWeek,
} from '../lib/dates';
import type { CreatedAppointment } from '../lib/types';

/**
 * Randevu alma akışı.
 *
 * Sıra: hizmet → berber → gün ve saat → bilgiler → onay
 *
 * Tek berber varsa berber adımı atlanıyor — müşteriye seçeneksiz bir soru
 * sormanın anlamı yok.
 *
 * ⚠️ Adımlar tarayıcı geçmişine YAZILMIYOR (router yerine state). Geri tuşu
 * akışın ortasında sayfayı terk eder gibi görünebilirdi; onun yerine her
 * adımda görünür bir "Geri" düğmesi var.
 */

type Step = 'service' | 'barber' | 'time' | 'details';

const STEP_ORDER: Step[] = ['service', 'barber', 'time', 'details'];

export default function BookingPage() {
  const shopQuery = useQuery({ queryKey: ['shop'], queryFn: fetchShopInfo });

  const [step, setStep] = useState<Step>('service');

  /**
   * Seçilen hizmetler.
   *
   * Müşteri birden fazla hizmet seçebiliyor ("saç + ağda"). Süreler
   * TOPLANMIYOR — ikisi aynı oturumda yapılıyor; yalnızca "ayrı zaman
   * isteyen" hizmetler (lazer) randevuyu uzatıyor. Bu yüzden seçim tek
   * seçimli bir liste değil, işaretlenebilir bir küme.
   */
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [barberId, setBarberId] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedAppointment | null>(null);

  // Tema `<html data-theme>` üzerinden uygulanıyor; buradaki state yalnızca
  // düğmenin doğru ikonu göstermesi için.
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme());

  const info = shopQuery.data;
  const services = info?.services ?? [];
  const barbers = info?.barbers ?? [];
  const timezone = info?.shop.timezone ?? 'Europe/Istanbul';

  const selectedServices = services.filter((s) => serviceIds.includes(s.id));
  const barber = barbers.find((b) => b.id === barberId) ?? null;

  /** "Saç + Ağda" — seçilen hizmetlerin tek satırlık gösterimi. */
  const serviceLabel = selectedServices.map((s) => s.name).join(' + ');

  // Süre ve ücret sunucudakiyle AYNI fonksiyonlardan hesaplanıyor; ekranda
  // yazan ile takvimde ayrılan süre ayrışamaz.
  const totalDuration =
    selectedServices.length > 0 ? computeAppointmentDuration(selectedServices) : 0;
  const totalPrice = sumServicePrices(selectedServices);

  // Tarih şeridi: bugün + sunucunun izin verdiği kadar ileri gün.
  // Sınır burada sabit yazılmıyor; kaynağı veritabanı.
  const dateStrip = info ? buildDateStrip(timezone, info.shop.maxAdvanceDays + 1) : [];
  const activeDate = date ?? dateStrip[0] ?? null;

  const slotsQuery = useQuery({
    queryKey: ['slots', barberId, serviceIds.join(','), activeDate],
    queryFn: () => fetchSlots(barberId!, serviceIds, activeDate!),
    enabled: step === 'time' && Boolean(barberId && serviceIds.length > 0 && activeDate),
  });

  const mutation = useMutation({
    mutationFn: () =>
      createAppointment({
        barberId: barberId!,
        serviceIds,
        startsAt: startsAt!,
        customerName: customerName.trim(),
        customerPhone: phone.trim(),
      }),
    onSuccess: (result) => {
      storeToken(result.token);
      setCreated(result);
    },
    onError: (error) => {
      setFormError(
        error instanceof ApiError ? error.message : 'Randevu oluşturulamadı. Tekrar deneyin.',
      );
    },
  });

  /**
   * Hizmeti seçime ekler ya da çıkarır.
   *
   * ⚠️ Seçim ARTIK bir sonraki adıma GEÇİRMİYOR. Tek hizmet seçilirken
   * dokunmak doğrudan ilerletiyordu; çoklu seçimde bu, ikinci hizmeti
   * seçmeye fırsat vermeden akışı öne atardı. Devam etmek artık ayrı bir
   * düğme — müşteri seçimini bitirdiğinde basıyor.
   */
  function toggleService(id: string) {
    setStartsAt(null); // saat listesi süreye bağlı; seçim değişince geçersiz

    setServiceIds((current) => {
      if (current.includes(id)) return current.filter((x) => x !== id);
      if (current.length >= MAX_SERVICES_PER_APPOINTMENT) return current;
      return [...current, id];
    });
  }

  function handleServiceContinue() {
    if (serviceIds.length === 0) return;

    if (barbers.length === 1) {
      setBarberId(barbers[0]!.id);
      setStep('time');
      return;
    }
    setStep('barber');
  }

  function handleBarberPick(id: string) {
    setBarberId(id);
    setStartsAt(null);
    setStep('time');
  }

  function goBack() {
    if (step === 'details') return setStep('time');
    if (step === 'time') return setStep(barbers.length === 1 ? 'service' : 'barber');
    if (step === 'barber') return setStep('service');
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    if (customerName.trim().length < 2) {
      setFormError('Lütfen adınızı ve soyadınızı yazın.');
      return;
    }

    // Sunucu zaten doğruluyor; buradaki kontrol, müşteriyi bir gidiş-dönüş
    // beklemeden uyarmak için. Aynı fonksiyon (@berber/shared) kullanıldığı
    // için iki taraf asla ayrışmıyor.
    if (!normalizePhone(phone)) {
      setFormError('Telefon numaranızı 05XX XXX XX XX biçiminde yazın.');
      return;
    }

    mutation.mutate();
  }

  function startOver() {
    setCreated(null);
    setStep('service');
    setServiceIds([]);
    setBarberId(null);
    setDate(null);
    setStartsAt(null);
    setCustomerName('');
    setPhone('');
    setFormError(null);
  }

  // ── Yükleniyor / hata ──────────────────────────────────

  if (shopQuery.isLoading) {
    return (
      <div className="page">
        <div className="loading-center">
          <div className="spinner" />
        </div>
      </div>
    );
  }

  if (shopQuery.isError || !info) {
    return (
      <div className="page">
        <div className="state-message">
          <AlertCircle size={30} strokeWidth={1.5} aria-hidden />
          <span>
            Randevu sistemine şu anda ulaşılamıyor.
            <br />
            Lütfen birazdan tekrar deneyin.
          </span>
        </div>
      </div>
    );
  }

  // ── Başarı ekranı ──────────────────────────────────────

  if (created) {
    return (
      <div className="page">
        <div className="result-icon result-icon-success">
          <CalendarCheck size={30} aria-hidden />
        </div>
        <h1 className="result-title">Randevunuz alındı</h1>
        <p className="result-text">
          {formatAppointmentMoment(created.appointment.startsAt, timezone)}
          <br />
          {created.appointment.barberName} ·{' '}
          {/* Sunucu hizmetlerin tamamını dönüyor; `serviceName` eski
              sürümlerle uyum için duruyor ve burada yedek olarak kullanılıyor. */}
          {created.appointment.services?.length
            ? created.appointment.services.map((s) => s.name).join(' + ')
            : created.appointment.serviceName}
        </p>

        <div className="notice notice-info">
          <AlertCircle size={17} aria-hidden />
          <span>
            Bu sayfayı kaydedin ya da aşağıdaki bağlantıyı not alın — randevunuzu
            görüntülemek ve iptal etmek için gerekiyor.
          </span>
        </div>

        <Link
          to={`/randevu/${created.token}`}
          className="btn btn-primary btn-block"
          style={{ marginBottom: 10 }}
        >
          Randevumu görüntüle
        </Link>

        <button type="button" className="btn btn-secondary btn-block" onClick={startOver}>
          Yeni randevu al
        </button>

        <Footer contactPhone={info.shop.contactPhone} />
      </div>
    );
  }

  // ── Akış ───────────────────────────────────────────────

  const stepIndex = STEP_ORDER.indexOf(step);
  const savedTokens = getStoredTokens();

  return (
    <div className="page">
      <header className="site-header">
        <button
          type="button"
          className="theme-toggle"
          onClick={() => setTheme(toggleTheme())}
          aria-label={theme === 'dark' ? 'Açık temaya geç' : 'Koyu temaya geç'}
          title={theme === 'dark' ? 'Açık tema' : 'Koyu tema'}
        >
          {theme === 'dark' ? <Sun size={17} aria-hidden /> : <Moon size={17} aria-hidden />}
        </button>

        <div className="brand-mark">
          <Scissors size={19} aria-hidden />
        </div>
        <h1>{info.shop.name}</h1>
        <p>Online randevu</p>
      </header>

      <div className="steps" aria-hidden>
        {STEP_ORDER.filter((s) => !(s === 'barber' && barbers.length === 1)).map((s) => (
          <span
            key={s}
            className="step-dot"
            data-state={
              STEP_ORDER.indexOf(s) < stepIndex
                ? 'done'
                : STEP_ORDER.indexOf(s) === stepIndex
                  ? 'active'
                  : 'todo'
            }
          />
        ))}
      </div>

      {step !== 'service' && (
        <button type="button" className="btn-back" onClick={goBack}>
          <ChevronLeft size={17} aria-hidden /> Geri
        </button>
      )}

      {/* ── 1. Hizmet ── */}
      {step === 'service' && (
        <>
          {savedTokens.length > 0 && (
            <Link to={`/randevu/${savedTokens[0]}`} className="notice notice-info">
              <CalendarCheck size={17} aria-hidden />
              <span>Daha önce aldığınız randevuyu görüntülemek için dokunun.</span>
            </Link>
          )}

          <h2 className="step-title">Hangi hizmetleri istiyorsunuz?</h2>
          <p className="step-hint">Birden fazla seçebilirsiniz.</p>

          {services.length === 0 ? (
            <div className="state-message">
              <CalendarX2 size={30} strokeWidth={1.5} aria-hidden />
              <span>Şu anda tanımlı hizmet yok. Lütfen bizi arayın.</span>
            </div>
          ) : (
            <>
              <div className="option-list">
                {services.map((s) => {
                  const secili = serviceIds.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className={`option-card option-card-multi${secili ? ' selected' : ''}`}
                      aria-pressed={secili}
                      onClick={() => toggleService(s.id)}
                    >
                      {/* Kutucuk seçili değilken de yer kaplıyor: aksi halde
                          seçim yapıldıkça satırlar yana kayıyor. */}
                      <span className="option-check" aria-hidden>
                        {secili && <Check size={14} />}
                      </span>
                      <span className="option-body">
                        <span className="option-name">{s.name}</span>
                        <span className="option-meta">{formatDuration(s.durationMin)}</span>
                      </span>
                      {formatPrice(s.price) && (
                        <span className="option-price">{formatPrice(s.price)}</span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/*
                Seçim özeti.
                Toplam SÜRE burada gösteriliyor çünkü çoklu seçimde sezgiye
                aykırı: iki hizmet seçmek süreyi genelde uzatmıyor, ama lazer
                eklemek uzatıyor. Müşteri ne kadar zaman ayırdığını randevuyu
                onaylamadan önce görmeli.
              */}
              {selectedServices.length > 0 && (
                <div className="selection-summary">
                  <span className="selection-summary-names">{serviceLabel}</span>
                  <span className="selection-summary-meta">
                    {formatDuration(totalDuration)}
                    {formatPrice(totalPrice) ? ` · ${formatPrice(totalPrice)}` : ''}
                  </span>
                </div>
              )}

              <button
                type="button"
                className="btn btn-primary btn-block"
                disabled={selectedServices.length === 0}
                onClick={handleServiceContinue}
              >
                Devam
              </button>
            </>
          )}
        </>
      )}

      {/* ── 2. Berber ── */}
      {step === 'barber' && (
        <>
          <h2 className="step-title">Berberinizi seçin</h2>
          <p className="step-hint">{serviceLabel}</p>

          <div className="option-list">
            {barbers.map((b) => (
              <button
                key={b.id}
                type="button"
                className="option-card"
                aria-pressed={barberId === b.id}
                onClick={() => handleBarberPick(b.id)}
              >
                <span className="option-name">{b.name}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* ── 3. Gün ve saat ── */}
      {step === 'time' && (
        <>
          <h2 className="step-title">Gün ve saat seçin</h2>
          <p className="step-hint">
            {serviceLabel}
            {barber ? ` · ${barber.name}` : ''}
          </p>

          <div className="date-strip" role="group" aria-label="Gün seçimi">
            {dateStrip.map((d) => {
              const chip = formatDateChip(d);
              // Berberin o gün çalışıp çalışmadığı /shop yanıtından biliniyor;
              // kapalı gün için sunucuya sormaya gerek yok. Kapalı günler devre
              // dışı bırakılıyor ki müşteri boşuna tıklamasın.
              // `?? null` bilerek: alan eksikse HİÇBİR gün kapalı sayılmıyor.
              // Bir dönem bu satır eksik alanda çöküyordu ve TÜM sayfa beyaz
              // kalıyordu — bir süsleme özelliği yüzünden randevu almanın
              // tamamen durması kabul edilemez.
              const calisilanGunler = barber?.workingDays ?? null;
              const kapali = calisilanGunler ? !calisilanGunler.includes(dayOfWeek(d)) : false;
              return (
                <button
                  key={d}
                  type="button"
                  className={`date-chip${kapali ? ' date-chip-closed' : ''}`}
                  disabled={kapali}
                  aria-pressed={activeDate === d}
                  aria-label={kapali ? `${formatDateLong(d)} — kapalı` : formatDateLong(d)}
                  onClick={() => {
                    setDate(d);
                    setStartsAt(null);
                  }}
                >
                  <span className="date-chip-weekday">{chip.weekday}</span>
                  <span className="date-chip-day">{chip.day}</span>
                  <span className="date-chip-month">{chip.month}</span>
                </button>
              );
            })}
          </div>

          {slotsQuery.isLoading && (
            <div className="loading-center">
              <div className="spinner" />
            </div>
          )}

          {slotsQuery.isError && (
            <div className="notice notice-error">
              <AlertCircle size={17} aria-hidden />
              <span>Saatler yüklenemedi. Lütfen tekrar deneyin.</span>
            </div>
          )}

          {slotsQuery.data && slotsQuery.data.slots.length === 0 && (
            <div className="state-message">
              <CalendarX2 size={30} strokeWidth={1.5} aria-hidden />
              {/* Sebebi sunucu söylüyor: kapalı / izinli / dolu.
                  Üçünü "doldu" diye anlatmak yanıltıcıydı — berber izinliyken
                  müşteri saatlerin dolduğunu sanıp erken davranmaya çalışıyordu. */}
              {slotsQuery.data.reason === 'closed' ? (
                <span>
                  Bu gün kapalıyız.
                  <br />
                  Açık bir gün seçebilirsiniz.
                </span>
              ) : slotsQuery.data.reason === 'timeoff' ? (
                <span>
                  {barber?.name} bu gün randevu almıyor.
                  <br />
                  Başka bir gün seçebilirsiniz.
                </span>
              ) : (
                <span>
                  Bu gün için uygun saat kalmamış.
                  <br />
                  Başka bir gün seçebilirsiniz.
                </span>
              )}
            </div>
          )}

          {slotsQuery.data && slotsQuery.data.slots.length > 0 && (
            <div className="slot-grid">
              {slotsQuery.data.slots.map((slot) => (
                <button
                  key={slot.startsAt}
                  type="button"
                  className="slot-btn"
                  aria-pressed={startsAt === slot.startsAt}
                  onClick={() => {
                    setStartsAt(slot.startsAt);
                    setStep('details');
                  }}
                >
                  {slot.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── 4. Bilgiler ve onay ── */}
      {step === 'details' && (
        <>
          <h2 className="step-title">Son adım</h2>
          <p className="step-hint">Randevunuzu size bağlayabilmemiz için.</p>

          <div className="summary">
            <div className="summary-row">
              <span>{selectedServices.length > 1 ? 'Hizmetler' : 'Hizmet'}</span>
              <span>
                {serviceLabel}
                {/* Ücretler toplanır; süre ise seçime göre hesaplanır. */}
                {formatPrice(totalPrice) ? ` · ${formatPrice(totalPrice)}` : ''}
              </span>
            </div>
            <div className="summary-row">
              <span>Süre</span>
              <span>{formatDuration(totalDuration)}</span>
            </div>
            <div className="summary-row">
              <span>Berber</span>
              <span>{barber?.name}</span>
            </div>
            <div className="summary-row">
              <span>Tarih ve saat</span>
              <span>{startsAt ? formatAppointmentMoment(startsAt, timezone) : '—'}</span>
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            <label className="field">
              <span>Ad Soyad</span>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                autoComplete="name"
                maxLength={120}
                required
              />
            </label>

            <label className="field">
              <span>Telefon</span>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
                placeholder="05XX XXX XX XX"
                inputMode="tel"
                required
              />
              <span className="field-hint">
                Randevunuzla ilgili bir durum olursa berberimiz buradan ulaşacak.
              </span>
            </label>

            {formError && (
              <div className="notice notice-error" role="alert">
                <AlertCircle size={17} aria-hidden />
                <span>{formError}</span>
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary btn-block"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? (
                <span className="spinner" />
              ) : (
                <>
                  <Check size={17} aria-hidden /> Randevuyu onayla
                </>
              )}
            </button>
          </form>
        </>
      )}

      <Footer contactPhone={info.shop.contactPhone} />
    </div>
  );
}

function Footer({ contactPhone }: { contactPhone: string | null }) {
  return (
    <footer className="site-footer">
      {contactPhone ? (
        <p>
          Sorunuz mu var?{' '}
          <a href={`tel:${contactPhone}`}>
            <Phone size={13} aria-hidden /> {contactPhone}
          </a>
        </p>
      ) : (
        <p>Özdede Hair Studio</p>
      )}
    </footer>
  );
}
