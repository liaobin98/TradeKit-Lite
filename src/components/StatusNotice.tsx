import { CircleCheck, TriangleAlert } from 'lucide-react';

export type StatusMessage = { text: string; tone: 'success' | 'warning' };

export function StatusNotice({ message }: { message: StatusMessage | null }) {
  const warning = message?.tone === 'warning';
  const Icon = warning ? TriangleAlert : CircleCheck;
  return (
    <p className={`status-notice${warning ? ' status-notice-warning' : ''}`} role={warning ? 'alert' : 'status'} aria-atomic="true">
      {message && <><Icon size={16} aria-hidden="true" /><span>{message.text}</span></>}
    </p>
  );
}
