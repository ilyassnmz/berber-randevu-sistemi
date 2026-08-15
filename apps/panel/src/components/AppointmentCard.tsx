import { AlertTriangle } from 'lucide-react';
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
          {appointment.service.name}
          {appointment.customer.phone ? ` · ${appointment.customer.phone}` : ''}
        </div>
      </div>
      <StatusBadge status={appointment.status} />
    </button>
  );
}
