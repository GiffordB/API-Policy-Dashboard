import { loadDashboard } from "@/lib/dto";
import Dashboard from "@/components/Dashboard";

export const dynamic = "force-dynamic";   // the dashboard is always live

export default async function Page() {
  const data = await loadDashboard();
  if (!data.divisions.length) {
    return (
      <main className="wrap" style={{ paddingTop: 40 }}>
        <section className="panel" style={{ padding: 22 }}>
          <h1 style={{ marginTop: 0, fontSize: 18 }}>The database is empty</h1>
          <p className="note">
            Run <code>npm run db:push</code>, then <code>npm run seed</code>, then{" "}
            <code>npm run collect</code> to pull the last 30 days from the Federal Register.
          </p>
        </section>
      </main>
    );
  }
  return <Dashboard data={data} />;
}
