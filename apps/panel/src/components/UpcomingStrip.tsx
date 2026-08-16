import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock } from 'lucide-react';
import { fetchAppointments } from '../lib/endpoints';
import { addDaysToDate, todayLocalDate, isoToLocalDate, formatDateShortTr } from '../lib/dates';

/**
 * Yaklaşan randevu şeridi.
 *
 * ── Neden var? ────────────────────────────────────────────────────
 *
 * Takvim yalnızca SEÇİLİ günü gösteriyor ve açılışta bugüne düşüyor.
 * Müşteri siteden yarına randevu aldığında, berber panele girip bugünü
 * görüyor ve ekran bomboş — randevunun düşmediğini sanıyor. Gerçekten
 * yaşandı: üç randevu kaydedilmişti ama hiçbiri görünmüyordu, çünkü
 * hepsi ertesi güne alınmıştı.
 *
 * Bu şerit, önümüzdeki bir haftada randevu olan günleri gösterip tek
 * dokunuşla o güne atlıyor. Yani "randevu var mı?" sorusu artık gün gün
 * gezinmeyi gerektirmiyor.
 *
 * Seçili gün şeritte GÖSTERİLMİYOR — zaten ekranda o günün akışı var,
 * tekrar etmek yer kaplardı.
 */

interface Props {
  barberId: string;
  selectedDate: string;
  onPick: (date: string) => void;
}

/** Kaç günlük ileriye bakılıyor. Müşteri zaten en fazla 7 gün sonrasına alabiliyor. */
const LOOKAHEAD_DAYS = 7;

export function UpcomingStrip({ barberId, selectedDate, onPick }: Props) {
  const today = todayLocalDate();
  const until = addDaysToDate(today, LOOKAHEAD_DAYS);

  const query = useQuery({
    queryKey: ['upcoming', barberId, today],
    queryFn: () => fetchAppointments({ barberId, from: today, to: until }),
  });

  const days = useMemo(() => {
    const items = (query.data?.items ?? []).filter((a) => a.status !== 'cancelled');

    // Gün başına randevu sayısı
    const counts = new Map<string, number>();
    for (const a of items) {
      const day = isoToLocalDate(a.startsAt);
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }

    return [...counts.entries()]
      .filter(([day]) => day !== selectedDate)
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [query.data, selectedDate]);

  if (days.length === 0) return null;

  const total = days.reduce((sum, [, count]) => sum + count, 0);

  return (
    <div className="upcoming-strip">
      <div className="upcoming-strip-label">
        <CalendarClock size={14} aria-hidden />
        <span>
          Başka günlerde {total} randevu
        </span>
      </div>
      <div className="upcoming-strip-chips">
        {days.map(([day, count]) => (
          <button
            key={day}
            type="button"
            className="upcoming-chip"
            onClick={() => onPick(day)}
            aria-label={`${formatDateShortTr(day)} — ${count} randevu`}
          >
            {formatDateShortTr(day)}
            <span className="upcoming-chip-count">{count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
