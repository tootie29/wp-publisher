// lib/auth.ts
import NextAuth from 'next-auth';
import { authConfig } from './auth.config';

const allowedDomain = (process.env.ALLOWED_EMAIL_DOMAIN || '').toLowerCase().trim();
const allowedEmails = (process.env.ALLOWED_EMAILS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user }) {
      const email = user.email?.toLowerCase();
      if (!email) return false;

      const hasList = allowedEmails.length > 0;
      const hasDomain = !!allowedDomain;
      if (!hasList && !hasDomain) return true;

      const matchesList = hasList && allowedEmails.includes(email);
      const matchesDomain = hasDomain && email.endsWith(`@${allowedDomain}`);
      return matchesList || matchesDomain;
    },
  },
});
