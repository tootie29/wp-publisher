// lib/users.ts
// Helpers for deriving a filesystem-safe key from a user identity.
// We use the user's email (lower-cased + slugified) so files in
// data/connector/<userKey>/... are readable by humans during debugging.

export function userKey(email: string | null | undefined): string {
  if (!email) return '__anonymous__';
  return email
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// All authenticated team members can act on any project. `ownerEmail` is
// retained on the project record so cron knows whose extension session to
// use as the runner for Surfer/Frase fetches, but it no longer gates ACL.
export function ownsProject(
  _ownerEmail: string | null | undefined,
  viewerEmail: string | null | undefined
): boolean {
  return !!viewerEmail;
}
