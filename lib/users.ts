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

export function ownsProject(
  ownerEmail: string | null | undefined,
  viewerEmail: string | null | undefined
): boolean {
  if (!ownerEmail) return true; // legacy / shared
  if (!viewerEmail) return false;
  return ownerEmail.toLowerCase() === viewerEmail.toLowerCase();
}
