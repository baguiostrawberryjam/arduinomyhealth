import { useState } from 'react';
import { api, DEMO_CREDENTIALS, errorMessage, MOCK } from '../api.js';
import { navigate } from '../router.js';
import Brand from '../components/Brand.jsx';
import Field from '../components/Field.jsx';

export default function Login({ onAuthenticated }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.login({ email: email.trim(), password });
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
        <h1 className="auth-title">Log in</h1>
        <p className="auth-sub">Use the same email and password you signed up with.</p>

        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <Field
            id="email"
            label="Email"
            type="email"
            value={email}
            autoComplete="email"
            required
            onChange={(e) => setEmail(e.target.value)}
          />
          <Field
            id="password"
            label="Password"
            type="password"
            value={password}
            autoComplete="current-password"
            required
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
            {submitting && <span className="spinner" aria-hidden="true" />}
            {submitting ? 'Logging in…' : 'Log in'}
          </button>
        </form>

        <p className="auth-foot">
          No account yet?{' '}
          <button type="button" className="linkbtn" onClick={() => navigate('/register')}>
            Create one
          </button>
        </p>

        {MOCK && (
          <p className="demo-hint">
            Demo data — no backend yet. Log in with <code>{DEMO_CREDENTIALS.email}</code> /{' '}
            <code>{DEMO_CREDENTIALS.password}</code>, or create an account.
          </p>
        )}
      </main>
    </div>
  );
}
