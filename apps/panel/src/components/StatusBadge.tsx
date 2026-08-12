import type { AppointmentStatus } from '../lib/types';
import { STATUS_LABELS_TR } from '../lib/types';

/**
 * Durum rozeti — renk TEK BAŞINA anlam taşımıyor, yanında etiket de var.
 * (Renk körlüğü olan bir kullanıcı yalnızca renge bakarak ayırt edemezdi.)
 */
const ICONS: Record<AppointmentStatus, string> = {
  pending_confirm: '🟡',
  confirmed: '🔵',
  cancelled: '🔴',
  completed: '🟢',
  no_show: '⚪',
};

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  return (
    <span className="status-badge" data-status={status}>
      {ICONS[status]} {STATUS_LABELS_TR[status]}
    </span>
  );
}
