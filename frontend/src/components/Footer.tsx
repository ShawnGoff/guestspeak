import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="border-t border-brand-border/40 py-8 px-4 mt-auto">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <Link href="/" className="font-display font-bold tracking-tight text-lg inline-flex items-center min-h-[44px]">
          Guest<span className="text-brand-orange">Speak</span>
        </Link>
        <p className="text-purple-200/70 text-sm">
          © {new Date().getFullYear()} GuestSpeak. Built for rooms full of questions.
        </p>
        <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-sm text-purple-200/75">
          <Link href="/about"   className="hover:text-purple-200/80 transition-colors inline-flex items-center min-h-[44px] px-1">About</Link>
          <Link href="/privacy" className="hover:text-purple-200/80 transition-colors inline-flex items-center min-h-[44px] px-1">Privacy</Link>
          <Link href="/terms"   className="hover:text-purple-200/80 transition-colors inline-flex items-center min-h-[44px] px-1">Terms</Link>
          <Link href="/cookies" className="hover:text-purple-200/80 transition-colors inline-flex items-center min-h-[44px] px-1">Cookies</Link>
          <Link href="/contact" className="hover:text-purple-200/80 transition-colors inline-flex items-center min-h-[44px] px-1">Contact</Link>
        </nav>
      </div>
    </footer>
  );
}
