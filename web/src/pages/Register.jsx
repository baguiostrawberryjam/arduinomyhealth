import { useState } from 'react';
import { api, errorMessage } from '../api.js';
import { navigate } from '../router.js';
import Brand from '../components/Brand.jsx';
import Field from '../components/Field.jsx';

const EMAIL_RE = /^\S+@\S+\.\S+$/;

function validate({ name, email, password, pin }) {
  const errors = {};
  if (!name.trim()) errors.name = 'Please enter your name.';
  if (!EMAIL_RE.test(email.trim())) errors.email = 'Please enter a valid email address.';
  if (password.length < 8) errors.password = 'Use at least 8 characters.';
  if (!/^\d{4}$/.test(pin)) errors.pin = 'The PIN must be exactly 4 digits.';
  return errors;
}

export default function Register({ onAuthenticated }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', pin: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (key) => (event) => {
    const value = key === 'pin' ? event.target.value.replace(/\D/g, '').slice(0, 4) : event.target.value;
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);

    const found = validate(form);
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }

    setSubmitting(true);
    try {
      // Register does not set the session cookie, so log in with the same
      // credentials straight after. The User ID the server generated is then
      // read back from /api/me and shown on the dashboard.
      await api.register({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        pin: form.pin,
      });
      await api.login({ email: form.email.trim(), password: form.password });
      await onAuthenticated();
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-wrap">
      <main className="auth-card">
        <div className="auth-brand">
          <Brand />
        </div>
        <h1 className="auth-title">Create your account</h1>
        <p className="auth-sub">
          You will get a 6-digit User ID. That, plus the PIN you choose here, is what you type at
          the Catcher Device.
        </p>

        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <Field
            id="name"
            label="Full name"
            value={form.name}
            autoComplete="name"
            error={errors.name}
            onChange={set('name')}
          />
          <Field
            id="email"
            label="Email"
            type="email"
            value={form.email}
            autoComplete="email"
            error={errors.email}
            onChange={set('email')}
          />
          <Field
            id="password"
            label="Password"
            type="password"
            value={form.password}
            autoComplete="new-password"
            hint="At least 8 characters. Used to log in to this website."
            error={errors.password}
            onChange={set('password')}
          />
          <Field
            id="pin"
            label="Catcher PIN"
            className="field-pin"
            type="password"
            inputMode="numeric"
            pattern="\d{4}"
            maxLength={4}
            value={form.pin}
            autoComplete="off"
            hint="4 digits. You type this on the Catcher Device keypad, so keep it memorable."
            error={errors.pin}
            onChange={set('pin')}
          />
          <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
            {submitting && <span className="spinner" aria-hidden="true" />}
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="auth-foot">
          Already have an account?{' '}
          <button type="button" className="linkbtn" onClick={() => navigate('/login')}>
            Log in
          </button>
        </p>
      </main>
    </div>
  );
}
