interface Props {
  label: string;
  onClick: () => void;
}

/** Boş saat — dokununca walk-in randevu formu açılır. */
export function SlotCard({ label, onClick }: Props) {
  return (
    <button className="slot-card" onClick={onClick}>
      {label} · Boş — randevu eklemek için dokunun
    </button>
  );
}
