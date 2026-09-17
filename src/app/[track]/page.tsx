import { notFound } from "next/navigation";
import { loadDashboard } from "@/lib/dto";
import { trackBySlug, TRACKS } from "@/lib/tracks";
import Dashboard from "@/components/Dashboard";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ track: string }> }) {
  const t = trackBySlug((await params).track);
  return { title: t ? `${t.label} — Policy Radar` : "Policy Radar" };
}

export default async function TrackPage({ params }: { params: Promise<{ track: string }> }) {
  const t = trackBySlug((await params).track);
  if (!t) notFound();

  const data = await loadDashboard();
  if (!data.divisions.length) {
    return (
      <main className="wrap" style={{ paddingTop: 40 }}>
        <section className="panel" style={{ padding: 22 }}>
          <h1 style={{ marginTop: 0, fontSize: 18 }}>The database is empty</h1>
          <p className="note">
            Run <code>npm run db:deploy</code>, then the seed endpoint, then a collection.
          </p>
        </section>
      </main>
    );
  }
  return <Dashboard data={data} track={t.track} trackLabel={t.label} trackBlurb={t.blurb} tracks={[...TRACKS]} />;
}
