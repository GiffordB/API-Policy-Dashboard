import { Track } from "@prisma/client";

/**
 * One page per track. These used to be tabs on a single page; a policy team
 * works one of these at a time, and a page can be bookmarked, linked to a
 * colleague, and left open.
 */
export const TRACKS = [
  { slug: "regulatory", track: Track.FEDERAL,  label: "Regulatory",  blurb: "Federal agency rulemaking" },
  { slug: "congress",   track: Track.CONGRESS, label: "Congress",    blurb: "Bills and resolutions" },
  // No States or Litigation page.
  //
  // State legislatures are parked pending a decision on the data source, and
  // there is no court feed at all. A page nothing fills is a promise the tool
  // does not keep.
  //
  // Both enum values stay in the schema, and the records already gathered stay
  // in the database. Putting a line back here restores its page and its records
  // together — that is the whole undo.
] as const;

export type TrackSlug = (typeof TRACKS)[number]["slug"];

export const trackBySlug = (slug: string) => TRACKS.find((t) => t.slug === slug) ?? null;
export const slugForTrack = (track: string) =>
  TRACKS.find((t) => t.track === track)?.slug ?? "regulatory";
