import Link from "next/link";
import { TRACKS } from "@/lib/tracks";

export const metadata = { title: "Not found — Policy Radar" };

/**
 * Pages come and go as sources are connected and parked, and a bookmark
 * outlives them. A dead link should hand you the live ones rather than a bare
 * 404 that leaves you guessing whether the whole thing is broken.
 */
export default function NotFound() {
  return (
    <main className="wrap" style={{ paddingTop: 48, maxWidth: 640 }}>
      <section className="panel" style={{ padding: 22 }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: "-.012em" }}>
          There is no page here
        </h1>
        <p className="note" style={{ margin: "8px 0 0", fontSize: 13, lineHeight: 1.6 }}>
          It may have been a page that is no longer tracked — States and Litigation were both
          removed, and any bookmark to them lands here. Nothing was lost: those records are still
          in the database, waiting for their source to be settled.
        </p>
        <div className="acts" style={{ marginTop: 16 }}>
          {TRACKS.map((t) => (
            <Link key={t.slug} className="btn pri" href={`/${t.slug}`} style={{ textDecoration: "none" }}>
              {t.label}
            </Link>
          ))}
          <Link className="btn" href="/coverage" style={{ textDecoration: "none" }}>
            What we watch
          </Link>
        </div>
      </section>
    </main>
  );
}
