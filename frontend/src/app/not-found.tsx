import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-brand-bg flex flex-col items-center justify-center px-4 text-center">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[400px] h-[250px] rounded-full bg-brand-purple/10 blur-[80px] pointer-events-none" />

      <div className="relative">
        <p className="text-8xl font-display font-bold text-orange-gradient mb-4">404</p>
        <h1 className="text-2xl font-bold text-white mb-3">This room has gone quiet</h1>
        <p className="text-purple-200/75 mb-8 max-w-sm">
          The page doesn&apos;t exist — or the session or channel you&apos;re looking for has moved on.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link href="/" className="btn-primary px-6 py-3 text-sm">
            Back to home
          </Link>
          <Link href="/discover" className="btn-ghost px-6 py-3 text-sm">
            Find a live session
          </Link>
        </div>
      </div>
    </div>
  );
}
