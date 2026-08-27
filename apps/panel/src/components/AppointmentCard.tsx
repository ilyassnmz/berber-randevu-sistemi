import { AlertTriangle } from 'lucide-react';
import { formatPhoneForDisplay } from '@berber/shared';
import type { Appointment } from '../lib/types';
import { formatTimeTr } from '../lib/dates';
import { StatusBadge } from './StatusBadge';

interface Props {
  appointment: Appointment;
  onClick: () => void;
}

export function AppointmentCard({ appointment, onClick }: Props) {
  const name = appointment.customer.name ?? 'İsimsiz müşteri';
  const noShowBadge = appointment.customer.noShowCount >= 3;

  return (
    <button className="appointment-card" data-status={appointment.status} onClick={onClick}>
      <div className="appt-time">
        {appointment.localStartTime ?? formatTimeTr(appointment.startsAt)}
      </div>
      <div className="appt-body">
        <div className="appt-name">
          {name}{noShowBadge && <AlertTriangle size={13} aria-hidden className="appt-warn" />}
        </div>
        <div className="appt-meta">
          {/* Randevuda birden fazla hizmet olabilir ("Saç + Ağda"). Yalnızca
              ana hizmet yazılsaydı berber, müşterinin ağda da istediğini
              kartta göremez, randevuyu açmak zorunda kalırdı. */}
          {appointment.services?.length
            ? appointment.services.map((s) => s.name).join(' + ')
            : appointment.service.name}
          {/* WhatsApp'tan gelen numara veritabanında E.164 (+905321234567)
              tutuluyor — berbere okunabilir yerel biçimde gösteriliyor. */}
          {appointment.customer.phone
            ? ` · ${formatPhoneForDisplay(appointment.customer.phone)}`
            : ''}
        </div>
      </div>
      <StatusBadge status={appointment.status} />
    </button>
  );
}
