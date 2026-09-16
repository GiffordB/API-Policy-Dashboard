/**
 * Which database this process is talking to — host and database name only,
 * never the credentials.
 *
 * Two Render databases can share a database name, so the instance ID in the
 * hostname is the only thing that tells them apart. Printing it is the
 * difference between a five-minute fix and an hour of guessing.
 */
export function whichDatabase(): string {
  const url = process.env.DATABASE_URL;
  if (!url) return "DATABASE_URL is not set";
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return "DATABASE_URL is not a valid URL";
  }
}
