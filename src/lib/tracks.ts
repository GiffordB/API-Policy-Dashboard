import { Track } from "@prisma/client";

/**
 * One page per track. These used to be tabs on a single page; a policy team
 * works one of these at a time, and a page can be bookmarked, linked to a
 * colleague, and left open.
 */
export const TRACKS = [
  { slug: "regulatory", track: Track.FEDERAL,  label: "Regulatory",  blurb: "Federal agency rulemaking" },
  { slug: "congress",   track: Track.CONGRESS, label: "Congress",    blurb: "Bills and resolutions" },
  { slug: "states",     track: Track.STATE,    label: "States",      blurb: "State legislatures" },
  // No Litigation page. There is no court feed, and a page nothing can fill is
  // a promise the tool does not keep. Track.COURT stays in the schema so the
  // handful of records that use it are never orphaned.
] as const;

export type TrackSlug = (typeof TRACKS)[number]["slug"];

export const trackBySlug = (slug: string) => TRACKS.find((t) => t.slug === slug) ?? null;
export const slugForTrack = (track: string) =>
  TRACKS.find((t) => t.track === track)?.slug ?? "regulatory";
