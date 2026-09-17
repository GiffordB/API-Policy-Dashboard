"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { DashboardData, ItemDTO, PersonDTO } from "@/lib/dto";

/* ------------------------------------------------------------------ */
/* constants                                                          */
/* ------------------------------------------------------------------ */

const PRIORITIES = [
  { id: "URGENT",       nm: "URGENT",       rank: 0, cls: "p4" },
  { id: "HIGH",         nm: "High",         rank: 1, cls: "p3" },
  { id: "MEDIUM",       nm: "Medium",       rank: 2, cls: "p2" },
  { id: "LOW",          nm: "Low",          rank: 3, cls: "p1" },
  { id: "NOT_RELEVANT", nm: "Not relevant", rank: 4, cls: "p0" },
] as const;
const PRI = Object.fromEntries(PRIORITIES.map((p) => [p.id, p]));

const POSITIONS = [
  { id: "PENDING", nm: "No position yet", sig: "–" },
  { id: "SUPPORT", nm: "Support",         sig: "+" },
  { id: "OPPOSE",  nm: "Oppose",          sig: "\u2212" },
  { id: "AMEND",   nm: "Amend",           sig: "\u00b1" },
  { id: "MONITOR", nm: "Monitor",         sig: "\u25cb" },
] as const;
const POS = Object.fromEntries(POSITIONS.map((p) => [p.id, p]));

const STAGE_SETS: Record<string, string[]> = {
  FEDERAL:  ["Pre-rule", "Proposed", "Comment open", "OMB review", "Final", "Effective"],
  CONGRESS: ["Introduced", "Committee", "Floor", "Other chamber", "Enrolled", "Enacted"],
  STATE:    ["Introduced", "Committee", "Floor", "Other chamber", "Enrolled", "Enacted"],
  COURT:    ["Filed", "Briefing", "Argued", "Decided", "Mandate"],
};

const STATUS = {
  good:     { c: "var(--good)",     label: "On track" },
  warning:  { c: "var(--warning)",  label: "Watch" },
  serious:  { c: "var(--serious)",  label: "Close" },
  critical: { c: "var(--critical)", label: "Urgent" },
} as const;
type StatusKey = keyof typeof STATUS;

const URGENT_DAYS = 2;
const DL_MAX = 60;
const DL_SHOWN = 10;

function urgency(d: number | null): StatusKey | null {
  if (d === null || d < 0) return null;   // a shut window has no urgency left
  if (d <= 7) return "critical";
  if (d <= 14) return "serious";
  if (d <= 30) return "warning";
  return "good";
}

/** A distinct shape per status, so colour never carries the meaning alone. */
function Shape({ s, size = 10 }: { s: StatusKey; size?: number }) {
  const c = STATUS[s].c;
  const common = { width: size, height: size, viewBox: "0 0 10 10", "aria-hidden": true } as const;
  if (s === "good")    return <svg {...common}><circle cx="5" cy="5" r="4" fill={c} /></svg>;
  if (s === "warning") return <svg {...common}><path d="M5 .8 9.4 9H.6z" fill={c} /></svg>;
  if (s === "serious") return <svg {...common}><path d="M5 .6 9.4 5 5 9.4.6 5z" fill={c} /></svg>;
  return <svg {...common}><rect x="1" y="1" width="8" height="8" rx="1" fill={c} /></svg>;
}

function PriorityChip({ item, onClick }: { item: ItemDTO; onClick?: () => void }) {
  const p = PRI[item.priority];
  const cls = `prio ${p.cls}${item.priorityConfirmed ? "" : " unset"}`;
  const inner = (
    <>
      <span className="bars"><i /><i /><i /><i /></span>
      <b>{p.nm}</b>
    </>
  );
  if (!onClick) return <span className={cls}>{inner}</span>;
  return (
    <button className={cls} onClick={(e) => { e.stopPropagation(); onClick(); }}
            title="Change priority" aria-label={`Priority ${p.nm}. Change it.`}>
      {inner}<span className="car">▾</span>
    </button>
  );
}

/** `needed` marks a missing position on an item whose comment window is open. */
function PositionPill({ item, onClick }: { item: ItemDTO; onClick?: () => void }) {
  const p = POS[item.position] ?? POS.PENDING;
  const pending = item.position === "PENDING";
  const needed = pending && item.isOpen && item.days !== null && item.days <= 30;
  const cls = `posn${pending ? " pending" : ""}${needed ? " needed" : ""}`;
  const inner = <><span className="sig" aria-hidden="true">{p.sig}</span>{needed ? "Position needed" : p.nm}</>;
  if (!onClick) return <span className={cls}>{inner}</span>;
  return <button className={cls} onClick={(e) => { e.stopPropagation(); onClick(); }}>{inner}</button>;
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/* ------------------------------------------------------------------ */

type TrackDef = { slug: string; track: string; label: string; blurb: string };

export default function Dashboard({ data, track, trackLabel, trackBlurb, tracks }: {
  data: DashboardData;
  track: string; trackLabel: string; trackBlurb: string;
  tracks: TrackDef[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const { divisions, people, items, audits, runs, monthly } = data;
  const DIV = useMemo(() => Object.fromEntries(divisions.map((d) => [d.id, d])), [divisions]);

  const [actor, setActor] = useState<string>(people[0]?.name ?? "Unknown");
  const [division, setDivision] = useState("all");
  /** "" is everyone. Otherwise a person's id — the whole page narrows to them. */
  const [owner, setOwner] = useState("");
  const [topic, setTopic] = useState("All");
  const [query, setQuery] = useState("");
  const [showGhost, setShowGhost] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [menuFor, setMenuFor] = useState<{ id: string; x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      const a = localStorage.getItem("pr_actor"); if (a) setActor(a);
      const o = localStorage.getItem("pr_owner"); if (o) setOwner(o);
    } catch {}
  }, []);
  const changeOwner = (id: string) => {
    setOwner(id);
    try { localStorage.setItem("pr_owner", id); } catch {}
  };
  const changeActor = (n: string) => { setActor(n); try { localStorage.setItem("pr_actor", n); } catch {} };

  const live = (i: ItemDTO) => i.priority !== "NOT_RELEVANT";
  const inDivision = useCallback((i: ItemDTO) => division === "all" || i.divisionId === division, [division]);
  const isOwner = useCallback((i: ItemDTO) => !owner || i.ownerId === owner, [owner]);
  const scoped = useMemo(
    () => items.filter((i) => inDivision(i) && isOwner(i) && live(i)),
    [items, inDivision, isOwner]
  );
  const ownerName = owner ? people.find((p) => p.id === owner)?.name ?? null : null;

  /**
   * Searching is a mode, not a fourth filter.
   *
   * It used to be ANDed with division, tab and topic, so a search from inside a
   * narrowed view found nothing and gave no sign why. A search now looks at
   * every division, every tab and every topic, and each row says where it
   * lives. Browsing still respects the filters.
   */
  const searching = query.trim().length > 0;
  const byRelevance = (a: ItemDTO, b: ItemDTO) =>
    Number(a.priority === "NOT_RELEVANT") - Number(b.priority === "NOT_RELEVANT") ||
    Number(a.days === null) - Number(b.days === null) ||
    (a.days ?? 0) - (b.days ?? 0);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) {
      return items
        .filter((i) => `${i.title} ${i.agency} ${i.docket} ${i.topics.join(" ")} ${i.ownerName ?? ""} ${i.stage}`
          .toLowerCase().includes(q))
        .sort(byRelevance);
    }
    return items
      .filter(inDivision)
      .filter(isOwner)
      .filter((i) => showGhost || live(i))
      .filter((i) => i.track === track)
      .filter((i) => topic === "All" || i.topics.includes(topic))
      .sort(byRelevance);
  }, [items, inDivision, isOwner, showGhost, track, topic, query]);

  const openItem = openId ? items.find((i) => i.id === openId) ?? null : null;

  // Arriving from another page with ?open=<docket>.
  useEffect(() => {
    const docket = params.get("open");
    if (!docket) return;
    const hit = items.find((i) => i.docket === docket);
    if (hit) { setOpenId(hit.id); if (!live(hit)) setShowGhost(true); }
    router.replace(`/${tracks.find((t) => t.track === track)?.slug ?? "regulatory"}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- writes ---- */
  const patch = async (id: string, body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/items/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actor, ...body }),
      });
      if (!res.ok) alert((await res.json()).error ?? "That change did not save.");
      router.refresh();
    } finally { setBusy(false); }
  };

  /* ---- urgent band: time decides membership, priority decides order ---- */
  const urgent = useMemo(() =>
    items
      .filter((i) => live(i) && i.isOpen && i.days !== null && i.days >= 0 && i.days <= URGENT_DAYS)
      .sort((a, b) => PRI[a.priority].rank - PRI[b.priority].rank || (a.days ?? 0) - (b.days ?? 0)),
    [items]);

  const deadlines = useMemo(() =>
    scoped.filter((i) => i.isOpen && i.days !== null && i.days >= 0)
      .sort((a, b) => (a.days ?? 0) - (b.days ?? 0)),
    [scoped]);

  const jump = (i: ItemDTO) => {
    // Another track lives on another page. Carry the item across so the click
    // lands on it rather than on that page's first row.
    if (i.track !== track) {
      const to = tracks.find((t) => t.track === i.track);
      if (to) { router.push(`/${to.slug}?open=${encodeURIComponent(i.docket)}`); return; }
    }
    if (division !== "all" && division !== i.divisionId) setDivision(i.divisionId);
    if (owner && i.ownerId !== owner) changeOwner("");
    setTopic("All"); setQuery("");
    if (!live(i)) setShowGhost(true);
    setOpenId(i.id);
  };

  const topics = useMemo(() => {
    const pool = scoped.filter((i) => i.track === track);
    const freq: Record<string, number> = {};
    pool.flatMap((i) => i.topics).forEach((t) => (freq[t] = (freq[t] ?? 0) + 1));
    const top = Object.keys(freq).sort((a, b) => freq[b] - freq[a] || a.localeCompare(b)).slice(0, 8).sort();
    return ["All", ...new Set(topic === "All" ? top : [...top, topic])];
  }, [scoped, track, topic]);

  const ghostCount = items.filter((i) => inDivision(i) && !live(i) && i.track === track).length;

  return (
    <>
      <Header actor={actor} people={people} onActor={changeActor} query={query} onQuery={setQuery}
              busy={busy} hits={searching ? visible.length : null} />

      <div className="wrap">
        {/* A search is a question asked at the top of the page. Everything
            between the box and the answer gets out of the way, so the results
            appear where you are looking instead of a thousand pixels below. */}
        {!searching && (
          <>
            <UrgentBand list={urgent} DIV={DIV} onJump={jump} nextOpen={deadlines[0]?.days ?? null} />
            <DeadlinePanel list={deadlines} DIV={DIV} />
            <DivisionBar divisions={divisions} items={items.filter((i) => live(i) && isOwner(i))}
                         active={division} onPick={(id) => { setDivision(id); setTopic("All"); }} />
            <StatBand scoped={scoped} items={items} division={division} divisions={divisions} />
          </>
        )}

        <div className="main" style={searching ? { marginTop: 18, gridTemplateColumns: "minmax(0,1fr)" } : undefined}>
          <section className="panel" aria-label="Tracked items">
            <div className="panel-hd" style={{ borderBottom: 0, paddingBottom: 2 }}>
              <h2>{searching ? "Search results" : ownerName ? `${ownerName}'s ${trackLabel.toLowerCase()} items` : trackLabel}</h2>
              {!searching && !ownerName && <span className="count">{trackBlurb}</span>}
              {!searching && ownerName && (
                <span className="count">{scoped.length} across every division</span>
              )}
              {searching && (
                <span className="count">
                  {visible.length} match{visible.length === 1 ? "" : "es"} across every division
                </span>
              )}
              <button className="addbtn spacer" onClick={() => setAdding(true)}>+ Track a new item</button>
            </div>

            {searching ? (
              <div className="filters">
                <span className="flab">Searching</span>
                <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
                  &ldquo;{query}&rdquo; — every division, every tab, every topic. Division and topic filters do not apply.
                </span>
                <button className="chip spacer" onClick={() => setQuery("")}>Clear search</button>
              </div>
            ) : (
            <div className="tabs">
              {tracks.map((t) => {
                const n = items.filter((i) => live(i) && isOwner(i) && i.track === t.track).length;
                return (
                  <Link key={t.slug} href={`/${t.slug}`} className="tab"
                        aria-selected={t.track === track} style={{ textDecoration: "none" }}>
                    {t.label}<span className="tc">{n}</span>
                  </Link>
                );
              })}
            </div>
            )}

            {!searching && (
            <div className="filters">
              <span className="flab">Owner</span>
              <select value={owner} onChange={(e) => changeOwner(e.target.value)} aria-label="Filter by owner"
                      style={{ font: "inherit", fontSize: 12.5, color: "var(--ink)",
                               background: owner ? "var(--accent-soft)" : "var(--surface-2)",
                               border: "1px solid var(--rule)", borderRadius: 5, padding: "4px 8px",
                               fontWeight: owner ? 600 : 400, marginRight: 4 }}>
                <option value="">Everyone</option>
                {people.some((p) => p.name === actor) && (
                  <option value={people.find((p) => p.name === actor)!.id}>Mine — {actor}</option>
                )}
                <optgroup label="Someone else">
                  {people.filter((p) => p.name !== actor).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </optgroup>
              </select>
              <span className="flab">Topic</span>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                {topics.map((t) => (
                  <button key={t} className="chip" aria-pressed={t === topic} onClick={() => setTopic(t)}>{t}</button>
                ))}
              </div>
              {topic !== "All" && (
                <button className="chip spacer" onClick={() => setTopic("All")}>Clear topic</button>
              )}
            </div>
            )}

            <div className="tscroll">
              <table className="items">
                <colgroup>
                  <col className="c-item" /><col className="c-src" /><col className="c-stage" />
                  <col className="c-due" /><col className="c-pri" /><col className="c-pos" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">Item</th><th scope="col">Source</th><th scope="col">Stage</th>
                    <th scope="col">Next date</th><th scope="col">Priority</th><th scope="col">Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 ? (
                    <tr><td colSpan={6} style={{ padding: "24px 14px", color: "var(--muted)" }}>
                      {searching
                        ? `Nothing you track matches “${query}”. It may not be tracked yet.`
                        : topic !== "All"
                          ? `Nothing in ${DIV[division]?.name ?? "this view"} is tagged ${topic}.`
                          : "Nothing here."}
                      <button className="addbtn" style={{ marginLeft: 8 }} onClick={() => setAdding(true)}>
                        {searching ? `Search the Federal Register for “${query}”` : "+ Track a new item"}
                      </button>
                      {searching && (
                        <Link className="addbtn" style={{ marginLeft: 8, textDecoration: "none" }}
                              href={`/coverage?add=${encodeURIComponent(query.trim())}`}>
                          Watch for “{query.trim()}” from now on
                        </Link>
                      )}
                    </td></tr>
                  ) : visible.map((it) => {
                    const d = DIV[it.divisionId];
                    const u = it.isOpen ? urgency(it.days) : null;
                    const closed = it.days !== null && it.days < 0;
                    return (
                      <tr key={it.id} tabIndex={0} className={live(it) ? "" : "ghost"}
                          aria-selected={it.id === openId}
                          onClick={() => setOpenId(it.id)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenId(it.id); } }}>
                        <td>
                          <div className="dvtag">
                            <i style={{ background: d?.colorVar }} />{d?.name}
                            {searching && <span style={{ color: "var(--muted)" }}>
                              {" · "}{tracks.find((t) => t.track === it.track)?.label}
                            </span>}
                          </div>
                          <div className="it-title">{it.title}</div>
                          <div className="it-dock">{it.docket}</div>
                          <div className="segs">{it.topics.map((t) => <span className="seg" key={t}>{t}</span>)}</div>
                        </td>
                        <td className="org"><b>{it.agency}</b>{it.unit}</td>
                        <td><span className={`pill ${it.stage === "Comment open" ? "act" : it.stage === "Final" ? "fin" : it.track === "COURT" ? "lit" : ""}`}>{it.stage}</span></td>
                        <td>
                          {u ? (
                            <div className="due"><Shape s={u} /><b>{it.days}d</b><span style={{ color: "var(--muted)" }}>left</span></div>
                          ) : closed ? (
                            <div className="due" style={{ color: "var(--muted)" }}>comments closed</div>
                          ) : <div className="due" style={{ color: "var(--ink-2)" }}>—</div>}
                          <div className="it-dock" style={{ marginTop: 4 }}>{it.nextLabel}</div>
                          {it.commentCount !== null && it.commentCount > 0 && (
                            <div className="it-dock" style={{ marginTop: 3, color: "var(--ink-2)" }}>
                              {it.commentCount.toLocaleString()} comment{it.commentCount === 1 ? "" : "s"} filed
                            </div>
                          )}
                        </td>
                        <td>
                          <PriorityChip item={it} onClick={() => {
                            const el = document.activeElement as HTMLElement | null;
                            const r = el?.getBoundingClientRect();
                            setMenuFor({ id: it.id, x: (r?.left ?? 0) + window.scrollX, y: (r?.bottom ?? 0) + window.scrollY + 5 });
                          }} />
                        </td>
                        <td className="pos">
                          {it.ownerName ?? <span style={{ color: "var(--critical)", fontWeight: 600 }}>Owner needed</span>}
                          <div style={{ marginTop: 5 }}><PositionPill item={it} /></div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {ghostCount > 0 && (
              <div className="ghostbar">
                {showGhost ? `Showing ${ghostCount} not relevant` : `${ghostCount} marked not relevant`}
                <button onClick={() => setShowGhost((v) => !v)}>{showGhost ? "hide" : "show"}</button>
              </div>
            )}
          </section>

          {!searching && (
            <RightRail items={scoped} DIV={DIV} runs={runs} division={division} onJump={jump} />
          )}
        </div>

        {!searching && <MonthlyChart monthly={monthly} divisions={divisions} active={division} />}

        <footer>
          <b>Pilot.</b> Federal Register records are live. Congress, state legislatures and the courts are not
          connected yet. Edits are recorded against the name in the “acting as” picker, which is a convention,
          not a sign-in. Replace the pilot password with your identity provider before the audit trail is
          treated as evidence.
        </footer>
      </div>

      {menuFor && (
        <PriorityMenu at={menuFor} current={items.find((i) => i.id === menuFor.id)?.priority ?? "MEDIUM"}
                      onClose={() => setMenuFor(null)}
                      onPick={(p) => { const id = menuFor.id; setMenuFor(null); patch(id, { priority: p }); }} />
      )}

      {openItem && (
        <Drawer item={openItem} DIV={DIV} divisions={divisions} people={people}
                audits={audits.filter((a) => a.itemId === openItem.id)}
                onClose={() => setOpenId(null)} onPatch={(b) => patch(openItem.id, b)} busy={busy} />
      )}

      {adding && (
        <AddDialog divisions={divisions} people={people} actor={actor} seed={query}
                   onClose={() => setAdding(false)}
                   onAdded={(id) => { setAdding(false); setOpenId(id); router.refresh(); }} />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* pieces                                                             */
/* ------------------------------------------------------------------ */

function Header({ actor, people, onActor, query, onQuery, busy, hits }: {
  actor: string; people: PersonDTO[]; onActor: (n: string) => void;
  query: string; onQuery: (q: string) => void; busy: boolean;
  /** Result count, shown beside the box so a search answers where you typed it. */
  hits: number | null;
}) {
  const names = [...new Set(people.map((p) => p.name))].sort();
  return (
    <header className="top">
      <div className="top-in">
        <div className="brand">
          <span className="dot" aria-hidden="true" />
          <h1>Policy Radar</h1>
          <span className="sub">Regulatory &amp; legislative watch</span>
        </div>
        <label className="search">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="6.8" cy="6.8" r="4.6" stroke="currentColor" strokeWidth="1.6" />
            <path d="M10.4 10.4 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input value={query} onChange={(e) => onQuery(e.target.value)} type="search"
                 placeholder="Search dockets, bills, keywords" autoComplete="off" />
          {hits !== null && (
            <span style={{ flex: "none", fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap",
                           color: hits ? "var(--accent)" : "var(--critical)" }}>
              {hits} {hits === 1 ? "result" : "results"}
            </span>
          )}
        </label>
        <Link href="/coverage" className="chip" style={{ textDecoration: "none", whiteSpace: "nowrap" }}>
          What we watch
        </Link>
        <span className="actas">
          Acting as
          <select value={actor} onChange={(e) => onActor(e.target.value)} aria-label="Acting as">
            {names.map((n) => <option key={n}>{n}</option>)}
          </select>
        </span>
        <span className="clock">{busy ? "saving…" : new Date().toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</span>
      </div>
    </header>
  );
}

function UrgentBand({ list, DIV, onJump, nextOpen }: {
  list: ItemDTO[]; DIV: Record<string, { name: string; colorVar: string }>;
  onJump: (i: ItemDTO) => void; nextOpen: number | null;
}) {
  if (!list.length) return (
    <section>
      <div className="allclear">
        <Shape s="good" /> No comment period closes in the next 48 hours.
        {nextOpen !== null ? ` The next one closes in ${nextOpen} days.` : ""}
      </div>
    </section>
  );
  return (
    <section className="alert" aria-label="Urgent deadlines">
      <div className="alert-hd">
        <Shape s="critical" size={11} />
        <span className="t">Closing inside 48 hours</span>
        <span className="c">{list.length} item{list.length > 1 ? "s" : ""} · {new Set(list.map((i) => i.divisionId)).size} divisions</span>
        <span className="when">everyone, by priority then time</span>
      </div>
      {list.map((it) => {
        const d = DIV[it.divisionId];
        const draft = it.draftState ?? "No draft started";
        return (
          <button className="urow" key={it.id} onClick={() => onJump(it)}>
            <span className="cd"><b>{Math.max(1, it.days ?? 1)}</b><span>{(it.days ?? 1) <= 1 ? "day left" : "days left"}</span></span>
            <span className="mid">
              <span className="dvtag"><i style={{ background: d?.colorVar }} />{d?.name}</span>
              <span className="h">{it.agency} — {it.title}</span>
              <span className="m">
                <PriorityChip item={it} />
                <PositionPill item={it} />
                <span>{it.nextLabel}</span>
                <span className="d">{it.docket}</span>
                <span>{it.ownerName ?? "Owner needed"}</span>
                <span className={/^no draft/i.test(draft) ? "nodraft" : ""}>{draft}</span>
              </span>
            </span>
            <span className="go">Open
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M3.5 1.5 8 6l-4.5 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>
        );
      })}
    </section>
  );
}

function DeadlinePanel({ list, DIV }: { list: ItemDTO[]; DIV: Record<string, { name: string; colorVar: string }> }) {
  const head = list.slice(0, DL_SHOWN), rest = list.slice(DL_SHOWN);
  const half = Math.ceil(head.length / 2);
  const Bar = ({ it }: { it: ItemDTO }) => {
    const u = urgency(it.days)!, d = DIV[it.divisionId];
    return (
      <div className="dlrow">
        <div className="hd">
          <span className="nm">
            <i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: d?.colorVar, marginRight: 6 }} />
            {it.agency} — {it.title.split("—")[0].trim()}
          </span>
          <span className="st" style={{ color: STATUS[u].c }}><Shape s={u} size={9} /> {STATUS[u].label} · {it.days} d</span>
        </div>
        <div className="track" role="img" aria-label={`${d?.name}, ${it.agency}: ${it.days} days until comments close.`}>
          <div className="fill" style={{ width: `${Math.min((it.days ?? 0) / DL_MAX, 1) * 100}%`, background: STATUS[u].c }} />
        </div>
      </div>
    );
  };
  const Col = ({ arr }: { arr: ItemDTO[] }) => (
    <div className="dlcol">
      <div className="dl">{arr.map((it) => <Bar key={it.id} it={it} />)}</div>
      <div className="axis-days" aria-hidden="true"><span>0</span><span>15</span><span>30</span><span>45</span><span>60 days</span></div>
    </div>
  );
  return (
    <section className="panel" style={{ marginTop: 18 }} aria-label="Government comment deadlines">
      <div className="panel-hd">
        <h2>Government comment deadlines</h2>
        <span className="count">{list.length} open</span>
        <span className="spacer" style={{ fontSize: 11.5, color: "var(--muted)" }}>next 60 days</span>
      </div>
      <div className="cbody">
        {head.length ? (
          <div className="dlwrap">
            <Col arr={head.slice(0, half)} />
            {head.length > half && <Col arr={head.slice(half)} />}
          </div>
        ) : <p className="note">No comment window is open in this division.</p>}
        {rest.length > 0 && (
          <div className="dlmore" style={{ marginTop: 14 }}>
            {rest.length} further window{rest.length > 1 ? "s" : ""} open, the next at {rest[0].days} days
          </div>
        )}
      </div>
    </section>
  );
}

function DivisionBar({ divisions, items, active, onPick }: {
  divisions: { id: string; name: string; colorVar: string }[];
  items: ItemDTO[]; active: string; onPick: (id: string) => void;
}) {
  const Tile = ({ id, name, colour, pool }: { id: string; name: string; colour: string; pool: ItemDTO[] }) => {
    const due = pool.filter((i) => i.isOpen && i.days !== null && i.days <= 30).length;
    const urgentN = pool.filter((i) => i.isOpen && i.days !== null && i.days <= URGENT_DAYS).length;
    const noOwner = pool.filter((i) => !i.ownerId).length;
    const worst = pool.reduce<number | null>(
      (m, i) => (!i.isOpen || i.days === null || i.days < 0 ? m : m === null || i.days < m ? i.days : m), null);
    const u: StatusKey | null = urgentN ? "critical" : urgency(worst);
    return (
      <button className="dv" aria-pressed={active === id} style={{ ["--dvc" as string]: colour }} onClick={() => onPick(id)}>
        <span className="nm">{name}</span>
        <span className="ct"><b>{pool.length}</b><span>item{pool.length === 1 ? "" : "s"}</span></span>
        <span className="ur" style={{ color: noOwner ? "var(--critical)" : u ? STATUS[u].c : "var(--muted)" }}>
          {noOwner ? <><Shape s="critical" size={9} />{noOwner} owner needed</>
                   : <>{u && <Shape s={u} size={9} />}{due ? `${due} due ≤30d` : "no open windows"}</>}
        </span>
      </button>
    );
  };
  return (
    <nav className="divbar" aria-label="Policy division">
      <Tile id="all" name="All divisions" colour="var(--ink-2)" pool={items} />
      {divisions.map((d) => <Tile key={d.id} id={d.id} name={d.name} colour={d.colorVar} pool={items.filter((i) => i.divisionId === d.id)} />)}
    </nav>
  );
}

function StatBand({ scoped, items, division, divisions }: {
  scoped: ItemDTO[]; items: ItemDTO[]; division: string; divisions: { id: string; name: string }[];
}) {
  const due = scoped.filter((i) => i.isOpen && i.days !== null && i.days <= 30);
  const u = scoped.filter((i) => i.isOpen && i.days !== null && i.days <= URGENT_DAYS).length;
  const open = scoped.filter((i) => i.isOpen);
  const soon = open.map((i) => i.days).filter((d): d is number => d !== null && d >= 0);
  const unowned = scoped.filter((i) => !i.ownerId).length;
  const needPosition = scoped.filter(
    (i) => i.position === "PENDING" && i.isOpen && i.days !== null && i.days <= 30
  ).length;
  return (
    <section className="band" aria-label="Summary">
      <div className="stat"><div className="k">Tracked items</div><div className="v">{scoped.length}</div>
        <div className="n">{division === "all"
          ? `${new Set(items.filter((i) => i.track === "FEDERAL").map((i) => i.agency)).size} agencies`
          : divisions.find((d) => d.id === division)?.name}</div></div>
      <div className="stat flag"><div className="k">Deadlines ≤ 30 days</div><div className="v">{due.length}</div>
        <div className="n">{u ? `${u} close${u === 1 ? "s" : ""} inside 48 hours` : "none inside 48 hours"}</div></div>
      <div className="stat"><div className="k">Comment periods open</div><div className="v">{open.length}</div>
        <div className="n">{soon.length ? `earliest closes in ${Math.min(...soon)} day${Math.min(...soon) === 1 ? "" : "s"}` : "no window open"}</div></div>
      <div className="stat"><div className="k">Owner needed</div><div className="v">{unowned}</div>
        <div className="n">{unowned ? "unassigned since import" : "every item is owned"}</div></div>
      <div className="stat flag"><div className="k">Need a position</div><div className="v">{needPosition}</div>
        <div className="n">{due.length ? `of ${due.length} closing in 30 days` : "no window closing soon"}</div></div>
    </section>
  );
}

function RightRail({ items, DIV, runs, division, onJump }: {
  items: ItemDTO[]; DIV: Record<string, { name: string; colorVar: string }>;
  runs: DashboardData["runs"]; division: string; onJump: (i: ItemDTO) => void;
}) {
  const feed = items
    .filter((i) => i.lastFinding)
    .sort((a, b) => (b.lastFinding!.foundAt).localeCompare(a.lastFinding!.foundAt))
    .slice(0, 8);
  const lastRun = runs[0];
  return (
    <div className="rail">
      <section className="panel brief" aria-label="What the agents found">
        <div className="date">What the agents found</div>
        <h3>{division === "all" ? "Latest across every division" : `${DIV[division]?.name} — latest`}</h3>
        {feed.length === 0 ? <p>No findings yet. Run the collector.</p> : feed.map((i) => (
          <p key={i.id}>
            <span className="dvtag"><i style={{ background: DIV[i.divisionId]?.colorVar }} />{DIV[i.divisionId]?.name}</span><br />
            <b>{i.agency}</b> — {i.lastFinding!.summary}{" "}
            <button onClick={() => onJump(i)} style={{ appearance: "none", border: 0, background: "none", padding: 0, font: "inherit", color: "var(--accent)", cursor: "pointer", textDecoration: "underline" }}>open</button>
          </p>
        ))}
        <div className="by">Collected from the Federal Register API</div>
      </section>

      <section className="panel" aria-label="Agents">
        <div className="panel-hd"><h2>Agents</h2>
          <span className="count">{lastRun ? (lastRun.ok ? "healthy" : "failing") : "never run"}</span></div>
        <div className="agents">
          <div className="aghd">Collectors</div>
          {runs.length === 0 ? (
            <div className="ag"><span className="sdot"><Shape s="warning" size={9} /></span>
              <div className="body"><div className="nm">Federal Register watcher</div>
                <div className="mt">never run — start the Render cron job</div></div></div>
          ) : runs.slice(0, 6).map((r, n) => (
            <div className="ag" key={n}>
              <span className="sdot"><Shape s={r.ok ? "good" : "critical"} size={9} /></span>
              <div className="body">
                <div className="nm">{r.source.replace(/_/g, " ").toLowerCase()}</div>
                <div className="mt">{fmtDate(r.startedAt)} · checked {r.checked}</div>
                {r.error && <div className="mt" style={{ color: "var(--critical)", fontFamily: "var(--ui)", fontSize: 11.5, marginTop: 3 }}>{r.error}</div>}
              </div>
              <div className="hit">{r.created ? `+${r.created}` : ""} {r.changed ? `~${r.changed}` : ""}</div>
            </div>
          ))}
          <div className="aghd">Not connected yet</div>
          {["Regulations.gov dockets", "Congress.gov bills", "Open States bills", "CourtListener dockets"].map((n) => (
            <div className="ag" key={n}>
              <span className="sdot"><Shape s="warning" size={9} /></span>
              <div className="body"><div className="nm">{n}</div><div className="mt">needs an API key</div></div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function MonthlyChart({ monthly, divisions, active }: {
  monthly: Record<string, Record<string, number>>;
  divisions: { id: string; name: string; colorVar: string }[]; active: string;
}) {
  const months = Object.keys(monthly).sort();
  if (!months.length) return null;
  const totals = months.map((m) => divisions.reduce((a, d) => a + (monthly[m][d.id] ?? 0), 0));
  const yMax = Math.max(10, Math.ceil(Math.max(...totals) / 10) * 10);
  const W = 660, H = 268, L = 34, R = 8, T = 14, B = 46, PW = W - L - R, PH = H - T - B;
  const band = PW / months.length, bw = Math.min(38, band - 14);
  const y = (v: number) => T + PH - (v / yMax) * PH;
  const label = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleString(undefined, { month: "short" });

  return (
    <div className="charts" style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
      <section className="panel" aria-label="Federal actions by division">
        <div className="panel-hd"><h2>Federal actions by division</h2>
          <span className="count">last {months.length} months</span></div>
        <div className="cbody">
          <svg className={`chart${active === "all" ? "" : " dim"}`} id="chartA" viewBox={`0 0 ${W} ${H}`} role="img"
               aria-label={`Stacked columns of Federal Register documents per month, split across the five divisions. The busiest month has ${Math.max(...totals)}.`}>
            <text className="axlab" x="0" y="8">Documents</text>
            {Array.from({ length: yMax / 10 + 1 }, (_, k) => k * 10).map((t) => (
              <g key={t}>
                <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth="1" />
                <text className="tick" x={L - 7} y={y(t) + 3.5} textAnchor="end">{t}</text>
              </g>
            ))}
            {months.map((m, i) => {
              const x = L + i * band + (band - bw) / 2;
              let acc = 0;
              const tot = totals[i];
              return (
                <g key={m}>
                  {divisions.map((d, k) => {
                    const v = monthly[m][d.id] ?? 0;
                    const y0 = y(acc), y1 = y(acc + v);
                    acc += v;
                    const h = Math.max(1, y0 - y1 - 2);
                    if (v === 0) return null;
                    return <rect key={d.id} className={`seg-rect s-${d.id}${active === d.id ? " on" : ""}`}
                                 x={x} y={y1 + 2} width={bw} height={h} rx={k === divisions.length - 1 ? 3 : 0} fill={d.colorVar} />;
                  })}
                  <text className="tick" x={x + bw / 2} y={H - B + 20} textAnchor="middle">{label(m)}</text>
                  {tot > 0 && <text className="tick" x={x + bw / 2} y={y(tot) - 8} textAnchor="middle" fill="var(--ink-2)" fontWeight="600">{tot}</text>}
                </g>
              );
            })}
          </svg>
        </div>
        <div className="legend">
          {divisions.map((d) => <span className="lg" key={d.id}><i style={{ background: d.colorVar }} />{d.name}</span>)}
        </div>
      </section>
    </div>
  );
}

function PriorityMenu({ at, current, onPick, onClose }: {
  at: { x: number; y: number }; current: string; onPick: (p: string) => void; onClose: () => void;
}) {
  useEffect(() => {
    const away = () => onClose();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    setTimeout(() => document.addEventListener("click", away), 0);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("click", away); document.removeEventListener("keydown", esc); };
  }, [onClose]);
  return (
    <div className="primenu" role="menu" style={{ top: at.y, left: Math.min(at.x, (typeof window !== "undefined" ? window.innerWidth : 900) - 200) }}
         onClick={(e) => e.stopPropagation()}>
      {PRIORITIES.map((p) => (
        <div key={p.id}>
          {p.id === "NOT_RELEVANT" && <div className="sep" />}
          <button role="menuitemradio" aria-checked={current === p.id} onClick={() => onPick(p.id)}>
            <span className={`prio ${p.cls}`}><span className="bars"><i /><i /><i /><i /></span><b>{p.nm}</b></span>
          </button>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* drawer                                                             */
/* ------------------------------------------------------------------ */

function Drawer({ item, DIV, divisions, people, audits, onClose, onPatch, busy }: {
  item: ItemDTO;
  DIV: Record<string, { name: string; colorVar: string }>;
  divisions: { id: string; name: string }[];
  people: PersonDTO[];
  audits: DashboardData["audits"];
  onClose: () => void;
  onPatch: (body: Record<string, unknown>) => void;
  busy: boolean;
}) {
  const d = DIV[item.divisionId];
  const u = item.isOpen ? urgency(item.days) : null;
  const stages = STAGE_SETS[item.track] ?? STAGE_SETS.FEDERAL;
  const roster = people.filter((p) => p.divisionId === item.divisionId);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    <>
      <div className="scrim show" onClick={onClose} />
      <aside className="drawer show" role="dialog" aria-modal="true" aria-label={item.title}>
        <div className="dhd">
          <div style={{ minWidth: 0 }}>
            <h3>{item.title}</h3>
            <div className="dk">
              <span className="dvtag" style={{ margin: "0 8px 0 0" }}><i style={{ background: d?.colorVar }} />{d?.name}</span>
              {item.docket}{item.frCitation ? ` · ${item.frCitation}` : ""}
            </div>
          </div>
          <button className="xbtn" onClick={onClose} aria-label="Close details">×</button>
        </div>

        <div className="dbody">
          <div className="dsec">
            <div className="dt">Tracking</div>
            <div className="grid3">
              <div className="field">
                <label htmlFor="fPri">Priority</label>
                <select id="fPri" value={item.priority} disabled={busy}
                        onChange={(e) => onPatch({ priority: e.target.value })}>
                  {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.nm}</option>)}
                </select>
                {!item.priorityConfirmed && <span className="note">Set by an agent, not yet confirmed</span>}
              </div>
              <div className="field">
                <label htmlFor="fDiv">Department</label>
                <select id="fDiv" value={item.divisionId} disabled={busy}
                        onChange={(e) => onPatch({ divisionId: e.target.value })}>
                  {divisions.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="fOwn">Owner</label>
                <select id="fOwn" value={item.ownerId ?? ""} disabled={busy}
                        onChange={(e) => onPatch({ ownerId: e.target.value || null })}>
                  <option value="">— pick an owner —</option>
                  {roster.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                {!item.ownerId && <span className="warn">Owner needed</span>}
              </div>
            </div>
            <p className="note" style={{ margin: "9px 0 0" }}>
              The owner list follows the department. Change the department and the owner clears,
              because the old owner is not on the new list.
            </p>

            <div className="grid2" style={{ marginTop: 14 }}>
              <div className="field">
                <label htmlFor="fPos">Position</label>
                <select id="fPos" value={item.position} disabled={busy}
                        onChange={(e) => onPatch({ position: e.target.value })}>
                  {POSITIONS.map((p) => <option key={p.id} value={p.id}>{p.nm}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="fPosNote">Why</label>
                <input id="fPosNote" defaultValue={item.positionNote ?? ""} disabled={busy}
                       placeholder="One line the next person can act on"
                       onBlur={(e) => {
                         const v = e.target.value.trim();
                         if (v !== (item.positionNote ?? "")) onPatch({ positionNote: v || null });
                       }} />
              </div>
            </div>
            {item.positionSetBy && item.positionSetAt && (
              <div className="posnote">
                {item.positionNote || "No reason recorded."}
                <span className="by">{item.positionSetBy} · {fmtDate(item.positionSetAt)}</span>
              </div>
            )}
          </div>

          <div className="dsec">
            <div className="dt">Stage</div>
            <div className="steps">
              {stages.map((st, i) => (
                <div key={st} className={`step ${i < item.stageIndex ? "done" : i === item.stageIndex ? "now" : ""}`}>
                  <div className="mk" /><div className="lb">{st}</div>
                </div>
              ))}
            </div>
          </div>

          {item.lastFinding && (
            <div className="dsec">
              <div className="dt">Last change found by an agent</div>
              <div className="change">
                <div className="who">{item.lastFinding.source.replace(/_/g, " ").toLowerCase()} · {fmtDate(item.lastFinding.foundAt)}</div>
                {item.lastFinding.summary}
              </div>
            </div>
          )}

          {item.commentCount !== null && (
            <div className="dsec">
              <div className="dt">Comments filed</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 9 }}>
                <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-.02em" }}>
                  {item.commentCount.toLocaleString()}
                </span>
                <span className="note">on this docket, as Regulations.gov counts them</span>
              </div>
              {item.recentCommenters?.length ? (
                <>
                  <div className="audit">
                    {item.recentCommenters.map((c, n) => (
                      <div className="aud" key={n}>
                        <span className="when">{c.postedDate}</span>
                        <span className="what"><b>{c.submitter}</b>{c.title ? ` — ${c.title}` : ""}</span>
                      </div>
                    ))}
                  </div>
                  <p className="note" style={{ margin: "9px 0 0" }}>
                    The five most recent.{" "}
                    <a href={`https://www.regulations.gov/docket/${encodeURIComponent(item.docket)}/comments`}
                       target="_blank" rel="noreferrer">Read them on Regulations.gov</a>
                  </p>
                </>
              ) : (
                <p className="note" style={{ margin: 0 }}>Nobody has filed yet.</p>
              )}
            </div>
          )}

          <div className="dsec">
            <div className="dt">Record</div>
            <dl className="kv">
              <dt>Source</dt><dd>{item.agency}{item.unit ? ` — ${item.unit}` : ""}</dd>
              <dt>Next date</dt><dd>{u && <Shape s={u} size={9} />} {item.nextLabel ?? "—"}</dd>
              <dt>Topics</dt><dd>{item.topics.join(", ")}</dd>
              <dt>Standards</dt><dd>{item.standards.length ? item.standards.join(", ") : "—"}</dd>
              <dt>Official text</dt>
              <dd>{item.sourceUrl
                ? <a href={item.sourceUrl} target="_blank" rel="noreferrer">Read it on federalregister.gov</a>
                : "Added by hand, no public record linked"}</dd>
            </dl>
          </div>

          <div className="dsec">
            <div className="dt">Audit trail</div>
            <div className="audit">
              {audits.length === 0 ? <p className="note" style={{ margin: 0 }}>No changes recorded yet.</p>
                : audits.map((a) => (
                  <div className="aud" key={a.id}>
                    <span className="when">{fmtDate(a.at)}</span>
                    <span className="what">
                      <b>{a.actor}</b> set {a.field} to <b>{a.toValue}</b>{" "}
                      {a.fromValue && <span className="from">{a.fromValue}</span>}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* add a reg                                                          */
/* ------------------------------------------------------------------ */

type LookupHit = {
  docket: string; title: string; agency: string; unit: string | null; stage: string;
  commentDueAt: string | null; publishedOn: string; sourceUrl: string;
  suggestedDivision: string; topics: string[];
};

function AddDialog({ divisions, people, actor, seed, onClose, onAdded }: {
  divisions: { id: string; name: string }[]; people: PersonDTO[];
  actor: string; seed: string; onClose: () => void; onAdded: (id: string) => void;
}) {
  const [q, setQ] = useState(seed);
  const [hits, setHits] = useState<LookupHit[] | null>(null);
  const [msg, setMsg] = useState("");
  const [looking, setLooking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const [form, setForm] = useState({
    docket: "", title: "", agency: "", unit: "", stage: "Comment open",
    commentDueAt: "", divisionId: divisions[0]?.id ?? "up", ownerId: "",
    priority: "MEDIUM", position: "PENDING", topics: "", sourceUrl: "",
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const roster = people.filter((p) => p.divisionId === form.divisionId);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  // Arriving from a search that found nothing: go straight to the source.
  useEffect(() => {
    if (seed.trim()) void lookup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The owner must be on the chosen department's roster.
  useEffect(() => {
    if (form.ownerId && !roster.some((p) => p.id === form.ownerId)) set("ownerId", "");
  }, [form.divisionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const lookup = async () => {
    if (!q.trim()) return;
    setLooking(true); setMsg(""); setHits(null);
    try {
      const res = await fetch(`/api/lookup?q=${encodeURIComponent(q.trim())}`);
      const json = await res.json();
      const results = (json.results ?? []) as LookupHit[];
      setHits(results);
      setMsg(results.length
        ? `${results.length} match${results.length > 1 ? "es" : ""} in the Federal Register. Pick one.`
        : "Nothing in the Federal Register. Fill the fields by hand.");
    } catch {
      setMsg("The lookup failed. Fill the fields by hand.");
    } finally { setLooking(false); }
  };

  const choose = (h: LookupHit) => {
    setForm((f) => ({
      ...f,
      docket: h.docket, title: h.title, agency: h.agency, unit: h.unit ?? "",
      stage: h.stage, commentDueAt: h.commentDueAt ?? "",
      divisionId: h.suggestedDivision, topics: h.topics.join(", "), sourceUrl: h.sourceUrl,
    }));
    setHits(null);
    setMsg("Loaded. Check the department, then set an owner.");
  };

  const save = async () => {
    setErr("");
    if (!form.title.trim()) return setErr("A title is required.");
    if (!form.docket.trim()) return setErr("A docket or bill number is required.");
    setSaving(true);
    try {
      const res = await fetch("/api/items", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actor,
          docket: form.docket.trim(), title: form.title.trim(),
          agency: form.agency.trim() || "Unknown", unit: form.unit.trim() || undefined,
          stage: form.stage,
          commentDueAt: form.commentDueAt ? new Date(form.commentDueAt).toISOString() : null,
          divisionId: form.divisionId, ownerId: form.ownerId || null,
          priority: form.priority, position: form.position,
          topics: form.topics.split(",").map((t) => t.trim()).filter(Boolean),
          sourceUrl: form.sourceUrl || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setErr(json.error ?? "That did not save."); return; }
      onAdded(json.id);
    } finally { setSaving(false); }
  };

  return (
    <>
      <div className="scrim show" onClick={onClose} />
      <aside className="drawer show" role="dialog" aria-modal="true" aria-label="Track a new item">
        <div className="dhd">
          <div style={{ minWidth: 0 }}>
            <h3>Track a new item</h3>
            <div className="dk">Nothing is filed until you press Track it</div>
          </div>
          <button className="xbtn" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="dbody">
          <div className="dsec">
            <div className="dt">Look it up</div>
            <div className="field">
              <label htmlFor="nLook">Federal Register number, a URL, or words from the title</label>
              <input id="nLook" value={q} onChange={(e) => setQ(e.target.value)}
                     onKeyDown={(e) => { if (e.key === "Enter") lookup(); }}
                     placeholder="2026-12345, or “refinery flares”" />
            </div>
            <div className="acts" style={{ marginTop: 9 }}>
              <button className="btn pri" onClick={lookup} disabled={looking}>{looking ? "Looking…" : "Look it up"}</button>
              <span className="note" style={{ alignSelf: "center" }}>{msg}</span>
            </div>
            {hits && hits.length > 0 && (
              <div style={{ marginTop: 11, display: "flex", flexDirection: "column", gap: 0 }}>
                {hits.map((h) => (
                  <button key={h.docket + h.sourceUrl} className="urow" style={{ borderTop: "1px solid var(--rule)" }}
                          onClick={() => choose(h)}>
                    <span className="mid">
                      <span className="h">{h.agency} — {h.title}</span>
                      <span className="m">
                        <span className="d">{h.docket}</span>
                        <span>{h.stage}</span>
                        {h.commentDueAt && <span>comments due {h.commentDueAt}</span>}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            <p className="note" style={{ margin: "9px 0 0" }}>
              The Federal Register is live. Bills, state legislatures and court dockets need their API keys
              before this box can find them.
            </p>
          </div>

          <div className="dsec">
            <div className="dt">The record</div>
            <div className="field" style={{ marginBottom: 11 }}>
              <label htmlFor="nTitle">Title</label>
              <input id="nTitle" value={form.title} onChange={(e) => set("title", e.target.value)} />
            </div>
            <div className="grid2" style={{ marginBottom: 11 }}>
              <div className="field"><label htmlFor="nDock">Docket or bill number</label>
                <input id="nDock" value={form.docket} onChange={(e) => set("docket", e.target.value)} /></div>
              <div className="field"><label htmlFor="nOrg">Agency or chamber</label>
                <input id="nOrg" value={form.agency} onChange={(e) => set("agency", e.target.value)} /></div>
            </div>
            <div className="grid2" style={{ marginBottom: 11 }}>
              <div className="field"><label htmlFor="nStage">Stage</label>
                <select id="nStage" value={form.stage} onChange={(e) => set("stage", e.target.value)}>
                  {STAGE_SETS.FEDERAL.map((x) => <option key={x}>{x}</option>)}
                </select></div>
              <div className="field"><label htmlFor="nDue">Comments close on</label>
                <input id="nDue" type="date" value={form.commentDueAt} onChange={(e) => set("commentDueAt", e.target.value)} /></div>
            </div>
            <div className="field"><label htmlFor="nTopics">Topics, separated by commas</label>
              <input id="nTopics" value={form.topics} onChange={(e) => set("topics", e.target.value)} placeholder="Emissions, Refining" /></div>
          </div>

          <div className="dsec">
            <div className="dt">Tracking</div>
            <div className="grid3">
              <div className="field"><label htmlFor="nPri">Priority</label>
                <select id="nPri" value={form.priority} onChange={(e) => set("priority", e.target.value)}>
                  {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.nm}</option>)}
                </select></div>
              <div className="field"><label htmlFor="nDiv">Department</label>
                <select id="nDiv" value={form.divisionId} onChange={(e) => set("divisionId", e.target.value)}>
                  {divisions.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select></div>
              <div className="field"><label htmlFor="nOwn">Owner</label>
                <select id="nOwn" value={form.ownerId} onChange={(e) => set("ownerId", e.target.value)}>
                  <option value="">— pick an owner —</option>
                  {roster.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select></div>
            </div>
            <div className="field" style={{ marginTop: 11 }}>
              <label htmlFor="nPos">Position</label>
              <select id="nPos" value={form.position} onChange={(e) => set("position", e.target.value)}>
                {POSITIONS.map((p) => <option key={p.id} value={p.id}>{p.nm}</option>)}
              </select>
            </div>
          </div>

          <div className="dsec">
            <div className="acts">
              <button className="btn pri" onClick={save} disabled={saving}>{saving ? "Saving…" : "Track it"}</button>
              <button className="btn" onClick={onClose}>Cancel</button>
              {err && <span style={{ alignSelf: "center", color: "var(--critical)", fontSize: 12, fontWeight: 600 }}>{err}</span>}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
