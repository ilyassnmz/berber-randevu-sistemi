interface Props {
  label: string;
  onClick: () => void;
  /**
   * Saati geçmiş slot.
   *
   * Gün görünümünde gösteriliyor ama tıklanamıyor: geçmişe randevu
   * yazılamaz, sunucu zaten reddeder. Tıklanabilir bırakılsaydı berber
   * dokunup hata mesajıyla karşılaşırdı.
   */
  isPast?: boolean | undefined;
}

/** Boş saat — dokununca walk-in randevu formu açılır. */
export function SlotCard({ label, onClick, isPast = false }: Props) {
  return (
    <button
      className={`slot-card${isPast ? ' slot-card-past' : ''}`}
      onClick={onClick}
      disabled={isPast}
      aria-label={isPast ? `${label} — geçmiş saat` : `${label} — randevu ekle`}
    >
      {isPast ? `${label} · Boş geçti` : `${label} · Boş — randevu eklemek için dokunun`}
    </button>
  );
}
