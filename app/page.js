import { loadDashboard } from '../lib/data.js';
import Dashboard from './Dashboard.js';
import Mark from './Mark.js';

export const dynamic = 'force-dynamic';

export default async function Page() {
  let data;
  try {
    data = await loadDashboard();
  } catch (e) {
    return (
      <main className="shell">
        <header className="top">
          <div className="brand"><Mark /><span>LopyMarket</span></div>
        </header>
        <section className="empty-state">
          <h2>The dashboard can&apos;t reach the database</h2>
          <p>
            Check that <code>DATABASE_URL</code> is set in Vercel&apos;s environment variables, then redeploy.
          </p>
          <p className="muted small">Error: {e.message}</p>
        </section>
      </main>
    );
  }
  return <Dashboard initial={data} passwordProtected={!!process.env.DASHBOARD_PASSWORD} />;
}
