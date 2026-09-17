"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { CoverageData, WatchDTO } from "@/lib/coverage";

const KINDS = {
  AGENCY:  { title: "Agencies swept",        blurb: "Every rule, proposal and notice these agencies publish is read on each run." },
  TERM:    { title: "Terms we always search", blurb: "Searched across every connected source — the whole Federal Register, including agencies not on the list above, and every bill that moved in Congress. This is how something outside the usual sources still reaches you." },
  DOCKET:  { title: "Dockets we follow",      blurb: "Pinned by docket number and followed whatever the documents are titled." },
  EXCLUDE: { title: "Dropped on purpose",     blurb: "Two thirds of the Federal Register is routine paperwork. These patterns drop it before it reaches the dashboard. Switch one off if you think we are missing something." },
} as const;

export default function Coverage({ data }: { data: CoverageData }) {
  const router = useRouter();
  const params = useSearchParams();
  const { divisions, watches, lastRun, totalItems, untraced } = data;
  const DIV = useMemo(() => Object.fromEntries(divisions.map((d) => [d.id, d])), [divisions]);

  const [actor, setActor] = useState("setup");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<null | "TERM" | "DOCKET">(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    try { const a = localStorage.getItem("pr_actor"); if (a) setActor(a); } catch {}
    const seed = params.get("add");
    if (seed) setAdding("TERM");
  }, [params]);

  const by = (k: string) => watches.filter((w) => w.kind === k);

  const toggle = async (w: WatchDTO) => {
    setBusy(true);
    try {
      await fetch(`/api/watches/${w.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ actor, active: !w.active }),
      });
      router.refresh();
    } finally { setBusy(false); }
  };

  return (
    <>
      <header className="top">
        <div className="top-in">
          <div className="brand">
            <span className="dot" aria-hidden="true" />
            <h1>Policy Radar</h1>
            <span className="sub">Coverage</span>
          </div>
          <Link href="/regulatory" className="chip" style={{ textDecoration: "none" }}>← Back to the dashboard</Link>
          <span className="clock">
            {lastRun ? `Last run ${new Date(lastRun.at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "Never run"}
          </span>
        </div>
      </header>

      <div className="wrap">
        <section className="panel" style={{ marginTop: 18, padding: "16px 18px" }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, letterSpacing: "-.012em" }}>
            What we scrape the federal sites for
          </h2>
          <p className="note" style={{ margin: "7px 0 0", maxWidth: "70ch", fontSize: 13, lineHeight: 1.55 }}>
            Everything on this page is live. The collectors read it at the start of each run, so a
            change here changes what arrives on the dashboard an hour later. Nothing is deleted —
            pausing an entry stops future runs from using it and keeps the record of what it found.
          </p>
        </section>

        <section className="band" aria-label="Coverage summary">
          <div className="stat"><div className="k">Agencies swept</div>
            <div className="v">{by("AGENCY").filter((w) => w.active).length}</div>
            <div className="n">every document they publish</div></div>
          <div className="stat"><div className="k">Terms searched</div>
            <div className="v">{by("TERM").filter((w) => w.active).length}</div>
            <div className="n">across the whole register</div></div>
          <div className="stat"><div className="k">Dockets pinned</div>
            <div className="v">{by("DOCKET").filter((w) => w.active).length}</div>
            <div className="n">followed by number</div></div>
          <div className="stat"><div className="k">Patterns dropped</div>
            <div className="v">{by("EXCLUDE").filter((w) => w.active).length}</div>
            <div className="n">routine paperwork</div></div>
          <div className="stat"><div className="k">Records held</div>
            <div className="v">{totalItems}</div>
            <div className="n">{untraced > 0 ? `${untraced} pre-date the watchlist` : "all traced to a watch"}</div></div>
        </section>

        {(["AGENCY", "TERM", "DOCKET", "EXCLUDE"] as const).map((kind) => {
          const rows = by(kind);
          const meta = KINDS[kind];
          return (
            <section className="panel" style={{ marginTop: 18 }} key={kind} aria-label={meta.title}>
              <div className="panel-hd">
                <h2>{meta.title}</h2>
                <span className="count">{rows.filter((r) => r.active).length} active</span>
                {(kind === "TERM" || kind === "DOCKET") && (
                  <button className="addbtn spacer" onClick={() => { setErr(""); setAdding(kind); }}>
                    + Add {kind === "TERM" ? "a term" : "a docket"}
                  </button>
                )}
              </div>
              <p className="note" style={{ margin: 0, padding: "10px 14px 0", maxWidth: "78ch", fontSize: 12.5 }}>
                {meta.blurb}
              </p>

              {rows.length === 0 ? (
                <p className="note" style={{ padding: "14px" }}>Nothing here yet.</p>
              ) : (
                <div className="tscroll">
                  <table className="items" style={{ minWidth: 700 }}>
                    <thead>
                      <tr>
                        <th scope="col">{kind === "EXCLUDE" ? "Pattern" : "What we look for"}</th>
                        <th scope="col">Division</th>
                        <th scope="col">{kind === "EXCLUDE" ? "Dropped, last run" : "Found, last run"}</th>
                        <th scope="col">Records held</th>
                        <th scope="col">Added by</th>
                        <th scope="col" style={{ width: 96 }}>State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((w) => (
                        <tr key={w.id} className={w.active ? "" : "ghost"}>
                          <td>
                            <div className="it-title">{w.label}</div>
                            <div className="it-dock">{w.value}</div>
                            {w.note && <div className="note" style={{ marginTop: 4, fontSize: 11.5 }}>{w.note}</div>}
                          </td>
                          <td>
                            {w.divisionId && DIV[w.divisionId] ? (
                              <span className="dvtag">
                                <i style={{ background: DIV[w.divisionId].colorVar }} />{DIV[w.divisionId].name}
                              </span>
                            ) : <span style={{ color: "var(--muted)", fontSize: 12 }}>all</span>}
                          </td>
                          <td style={{ fontVariantNumeric: "tabular-nums" }}>{w.lastHits}</td>
                          <td style={{ fontVariantNumeric: "tabular-nums" }}>
                            {kind === "EXCLUDE" ? <span style={{ color: "var(--muted)" }}>—</span> : w.found}
                          </td>
                          <td style={{ fontSize: 12, color: "var(--ink-2)" }}>{w.addedBy}</td>
                          <td>
                            <button className="chip" aria-pressed={w.active} disabled={busy} onClick={() => toggle(w)}>
                              {w.active ? "Watching" : "Paused"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}


        <footer>
          <b>Honest limits.</b> Only the Federal Register is connected, so this page describes
          federal rulemaking coverage and nothing else. A term reaches every agency in the register,
          not only the ones swept above — but it cannot reach a source that is not connected.
        </footer>
      </div>

      {adding && (
        <AddWatch
          kind={adding} divisions={divisions} actor={actor} seed={params.get("add") ?? ""}
          error={err} setError={setErr}
          onClose={() => setAdding(null)}
          onDone={() => { setAdding(null); router.refresh(); }}
        />
      )}
    </>
  );
}

function AddWatch({ kind, divisions, actor, seed, error, setError, onClose, onDone }: {
  kind: "TERM" | "DOCKET";
  divisions: { id: string; name: string }[];
  actor: string; seed: string; error: string;
  setError: (s: string) => void; onClose: () => void; onDone: () => void;
}) {
  const [value, setValue] = useState(seed);
  const [label, setLabel] = useState(seed);
  const [note, setNote] = useState("");
  const [divisionId, setDivisionId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  const save = async () => {
    setError("");
    if (value.trim().length < 2) return setError("Give it something to search for.");
    setSaving(true);
    try {
      const res = await fetch("/api/watches", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actor, kind, value: value.trim(),
          label: label.trim() || value.trim(),
          note: note.trim() || undefined,
          divisionId: divisionId || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(typeof json.error === "string" ? json.error : "That did not save."); return; }
      onDone();
    } finally { setSaving(false); }
  };

  return (
    <>
      <div className="scrim show" onClick={onClose} />
      <aside className="drawer show" role="dialog" aria-modal="true" aria-label={`Add a ${kind.toLowerCase()}`}>
        <div className="dhd">
          <div style={{ minWidth: 0 }}>
            <h3>{kind === "TERM" ? "Search for this from now on" : "Follow this docket"}</h3>
            <div className="dk">Takes effect on the next collector run</div>
          </div>
          <button className="xbtn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="dbody">
          <div className="dsec">
            <div className="field" style={{ marginBottom: 11 }}>
              <label htmlFor="wValue">{kind === "TERM" ? "Words to search" : "Docket number"}</label>
              <input id="wValue" value={value} autoFocus
                     onChange={(e) => { setValue(e.target.value); if (!label || label === value) setLabel(e.target.value); }}
                     placeholder={kind === "TERM" ? "class VI" : "EPA-HQ-OAR-2026-0177"} />
            </div>
            <div className="field" style={{ marginBottom: 11 }}>
              <label htmlFor="wLabel">What to call it</label>
              <input id="wLabel" value={label} onChange={(e) => setLabel(e.target.value)}
                     placeholder="Class VI injection wells" />
            </div>
            <div className="field" style={{ marginBottom: 11 }}>
              <label htmlFor="wNote">Why it is on the list</label>
              <input id="wNote" value={note} onChange={(e) => setNote(e.target.value)}
                     placeholder="So the next person knows" />
            </div>
            <div className="field">
              <label htmlFor="wDiv">Division that cares</label>
              <select id="wDiv" value={divisionId} onChange={(e) => setDivisionId(e.target.value)}>
                <option value="">All divisions</option>
                {divisions.filter((d) => d.id !== "none").map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <p className="note" style={{ margin: "11px 0 0" }}>
              {kind === "TERM"
                ? "A term searches the whole Federal Register, including agencies not on the swept list. It runs on every collection from now on, and the coverage page shows what it finds."
                : "A pinned docket is followed by number, so it stays tracked even when the documents in it are titled differently. Exclusion patterns never apply to a pinned docket."}
            </p>
          </div>
          <div className="dsec">
            <div className="acts">
              <button className="btn pri" onClick={save} disabled={saving}>
                {saving ? "Saving…" : kind === "TERM" ? "Search for this from now on" : "Follow this docket"}
              </button>
              <button className="btn" onClick={onClose}>Cancel</button>
              {error && <span style={{ alignSelf: "center", color: "var(--critical)", fontSize: 12, fontWeight: 600 }}>{error}</span>}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
