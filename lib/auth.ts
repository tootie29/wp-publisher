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

      if (allowedEmails.length > 0 && !allowedEmails.includes(email)) return false;
      if (allowedDomain && !email.endsWith(`@${allowedDomain}`)) return false;

      return true;
    },
  },
});
