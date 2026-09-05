/**
 * How to take a reading. The 6-digit User ID exists because you cannot type an
 * email address on a 4x4 numeric keypad — it is a login identifier for the
 * shared Catcher Device, not a secret. The PIN is the secret, so it is never shown.
 */
export default function UserCodeCard({ userCode, deviceOnline }) {
  return (
    <div className="card usercode-card">
      <div className="usercode-block">
        <div className="usercode-caption">Your User ID</div>
        <div className="usercode-digits">{userCode}</div>
      </div>
      <div>
        <ol className="usercode-steps">
          <li>
            At the Catcher Device, type your User ID <strong>{userCode}</strong> and press <strong>#</strong>.
          </li>
          <li>
            Type your <strong>4-digit PIN</strong> and press <strong>#</strong>.
          </li>
          <li>Rest your finger on the sensor and hold still while it measures.</li>
          <li>
            Press <strong>A</strong> when you are done. The Catcher also logs you out on its own
            after about 2 minutes.
          </li>
        </ol>
        <p className="usercode-note">
          {deviceOnline
            ? 'Readings are saved to your account automatically, about every 15 seconds.'
            : 'The Catcher Device is offline right now. It needs to be switched on and connected to WiFi before anyone can log in at the keypad.'}
        </p>
      </div>
    </div>
  );
}
