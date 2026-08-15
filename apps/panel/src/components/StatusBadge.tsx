import { Clock, CheckCircle2, XCircle, Check, UserX } from 'lucide-react';
import type { AppointmentStatus } from '../lib/types';
import { STATUS_LABELS_TR } from '../lib/types';

/**
 * Durum rozeti — renk TEK BAŞINA anlam taşımıyor, yanında etiket de var.
 * (Renk körlüğü olan bir kullanıcı yalnızca renge bakarak ayırt edemezdi.)
 *
 * İkonlar emoji değil: emoji her işletim sisteminde farklı çiziliyor
 * (Android'de yuvarlak, iOS'ta parlak, Windows'ta düz) ve boyutu kontrol
 * edilemiyordu — çizgi kalınlığı ve rengi metinden miras alan gerçek SVG
 * ikonlar hem tutarlı hem de tema değişince otomatik uyuyor.
 */
const ICONS: Record<AppointmentStatus, typeof Clock> = {
  pending_confirm: Clock,
  confirmed: CheckCircle2,
  cancelled: XCircle,
  completed: Check,
  no_show: UserX,
};

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  const Icon = ICONS[status];

  return (
    <span className="status-badge" data-status={status}>
      <Icon size={13} strokeWidth={2.5} aria-hidden />
      {STATUS_LABELS_TR[status]}
    </span>
  );
}
