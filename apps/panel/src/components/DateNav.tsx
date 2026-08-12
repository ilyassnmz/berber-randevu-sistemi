import { addDaysToDate, formatDateTr, isToday, todayLocalDate } from '../lib/dates';

interface Props {
  date: string;
  onChange: (date: string) => void;
}

export function DateNav({ date, onChange }: Props) {
  return (
    <div className="date-nav">
      <button className="btn-icon" onClick={() => onChange(addDaysToDate(date, -1))} aria-label="Önceki gün">
        ‹
      </button>

      <div className="date-nav-label">{formatDateTr(date)}</div>

      <button className="btn-icon" onClick={() => onChange(addDaysToDate(date, 1))} aria-label="Sonraki gün">
        ›
      </button>

      {!isToday(date) && (
        <button className="btn btn-secondary date-nav-today" onClick={() => onChange(todayLocalDate())}>
          Bugün
        </button>
      )}
    </div>
  );
}
