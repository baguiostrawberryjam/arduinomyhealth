import { formatDateTime } from '../format.js';

/**
 * Online/offline for the shared Catcher Device, straight from /api/me.
 *
 * `deviceOnline` is computed on the server (last heartbeat within 15 minutes),
 * so the browser never does clock math and a wrong clock on the viewer's phone
 * cannot make a live Catcher look dead.
 */
export default function DeviceStatus({ online, lastSeenAt }) {
  return (
    <span
      className="device-status"
      title={lastSeenAt ? `Last heard from ${formatDateTime(lastSeenAt)}` : undefined}
    >
      <span className={`dot ${online ? 'dot-online' : 'dot-offline'}`} aria-hidden="true" />
      <span>
        Catcher {online ? 'online' : 'offline'}
        {!online && lastSeenAt && (
          <span className="sr-only"> — last seen {formatDateTime(lastSeenAt)}</span>
        )}
      </span>
    </span>
  );
}
