// app/login/page.tsx
import { auth } from '@/lib/auth';
import { signInWithGoogleAction } from '@/lib/auth-actions';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { callbackUrl?: string; error?: string };
}) {
  const session = await auth();
  if (session) redirect(searchParams.callbackUrl || '/');

  const callbackUrl = searchParams.callbackUrl;
  const error = searchParams.error;

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <form
        action={signInWithGoogleAction.bind(null, callbackUrl)}
        className="w-full max-w-md"
      >
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8">
          <h1 className="text-2xl font-semibold">Sign in</h1>
          <p className="text-white/60 text-sm mt-2">Use your company Google account.</p>

          {error && (
            <div className="mt-5 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-300">
              {error === 'AccessDenied'
                ? 'That email isn’t allowed to sign in. Ask an admin if you need access.'
                : 'Sign-in failed. Please try again.'}
            </div>
          )}

          <button
            type="submit"
            className="mt-6 w-full rounded-lg bg-white text-black font-medium py-2.5 hover:bg-white/90 transition"
          >
            Continue with Google
          </button>
        </div>
      </form>
    </main>
  );
}
