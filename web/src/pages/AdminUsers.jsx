import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api.js';
import { formatTimestamp } from '../format.js';
import { navigate } from '../router.js';
import Brand from '../components/Brand.jsx';
import Dashboard from './Dashboard.jsx';

/**
 * Every account, and the way into one.
 *
 * Read-only by design: no editing, no deletion, no impersonation. Selecting a
 * row opens the ordinary dashboard pointed at that person, so the charts, the
 * table, the zoom and the CSV all work here without a line of new code.
 *
 * Both admin routes live in this one component. /admin/user/:id needs the
 * person's name and User ID, which are in this same list, so routing through
 * here means one query answers both screens — and a shared link or a hard
 * refresh straight onto a user still works.
 */
export default function AdminUsers({ me, onLogout, viewUserId = null }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .adminUsers()
      .then((data) => {
        if (!cancelled) setUsers(data.users);
      })
      .catch((err) => {
        if (!cancelled) {
          setUsers([]);
          setError(errorMessage(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const withReadings = users.filter((u) => u.readingCount > 0).length;

  if (viewUserId !== null) {
    const viewUser = users.find((u) => u.id === viewUserId);
    if (viewUser) return <Dashboard me={me} onLogout={onLogout} viewUser={viewUser} />;
    if (!loading && !error) {
      return (
        <div className="shell">
          <main className="container">
            <div className="card">
              <div className="empty">
                <p className="empty-title">No such user</p>
                <p className="empty-body">
                  Account #{viewUserId} does not exist. It may have been removed.
                </p>
                <button
                  type="button"
                  className="linkbtn backlink"
                  onClick={() => navigate('/admin')}
                >
                  &larr; All users
                </button>
              </div>
            </div>
          </main>
        </div>
      );
    }
    // Still loading, or the list failed — fall through to the list's own
    // skeleton and error, which is the same thing this screen would show.
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Brand />
          <div className="topbar-right">
            <button type="button" className="btn btn-ghost" onClick={() => navigate('/')}>
              My readings
            </button>
            <span className="topbar-user">{me.name}</span>
            <button type="button" className="btn btn-ghost" onClick={onLogout}>
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="container">
        <div className="page-head">
          <div>
            <h1 className="page-title">All users</h1>
            <p className="page-sub">
              {loading
                ? 'Loading accounts…'
                : `${users.length.toLocaleString()} registered, ${withReadings.toLocaleString()} with readings. Select a name to see that person's dashboard.`}
            </p>
          </div>
        </div>

        {error && (
          <div className="alert alert-error" role="alert">
            <span>{error}</span>
            <button
              type="button"
              className="linkbtn"
              onClick={() => setReloadKey((k) => k + 1)}
              style={{ color: 'inherit' }}
            >
              Try again
            </button>
          </div>
        )}

        <section className="section section-first">
          {loading ? (
            <div className="card">
              <div className="card-pad">
                {Array.from({ length: 6 }, (_, i) => (
                  <div
                    key={i}
                    className="skeleton skeleton-line"
                    style={{ marginBottom: 14, width: `${92 - i * 6}%` }}
                  />
                ))}
              </div>
            </div>
          ) : users.length === 0 && !error ? (
            <div className="card">
              <div className="empty">
                <p className="empty-title">No accounts yet</p>
                <p className="empty-body">
                  Users appear here as soon as they register on the site.
                </p>
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="table-scroll">
                <table className="readings users-table">
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Email</th>
                      <th scope="col">User ID</th>
                      <th scope="col" className="col-num">
                        Readings
                      </th>
                      <th scope="col">Last reading</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr
                        key={user.id}
                        className="row-link"
                        onClick={() => navigate(`/admin/user/${user.id}`)}
                      >
                        <td>
                          <button type="button" className="linkbtn">
                            {user.name}
                          </button>
                          {user.id === me.id && <span className="tag">you</span>}
                        </td>
                        <td className="muted-cell">{user.email}</td>
                        <td className="time-cell">{user.userCode}</td>
                        <td className={`col-num num ${user.readingCount === 0 ? 'muted-cell' : ''}`}>
                          {user.readingCount.toLocaleString()}
                        </td>
                        <td className="time-cell">
                          {user.lastReadingAt ? formatTimestamp(user.lastReadingAt) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
