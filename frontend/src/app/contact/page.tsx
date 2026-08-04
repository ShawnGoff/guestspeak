import Link from 'next/link';
import Footer from '@/components/Footer';

export const metadata = { title: 'Contact — GuestSpeak' };

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-brand-bg flex flex-col">
      <header className="px-6 py-5 border-b border-brand-border/40">
        <Link href="/" className="font-display font-bold text-xl tracking-tight">
          Guest<span className="text-brand-orange">Speak</span>
        </Link>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-16">
        <h1 className="text-4xl font-bold text-white mb-3">Contact</h1>
        <p className="text-purple-200/85 text-lg mb-12">We&apos;re a small team. Reach us directly.</p>

        <div className="space-y-6">
          <a
            href="mailto:guestspeak@protonmail.com"
            className="flex items-center gap-4 p-5 bg-brand-card border border-brand-border rounded-2xl hover:border-brand-orange/40 transition-colors group"
          >
            <div className="w-10 h-10 rounded-xl bg-brand-orange/15 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-brand-orange" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
            </div>
            <div>
              <p className="text-white font-medium group-hover:text-brand-orange transition-colors">guestspeak@protonmail.com</p>
              <p className="text-purple-200/75 text-sm mt-0.5">General inquiries, feedback, support</p>
            </div>
          </a>

          <div className="p-5 bg-brand-card border border-brand-border rounded-2xl">
            <p className="text-white font-medium mb-1">Privacy &amp; data requests</p>
            <p className="text-purple-200/85 text-sm">
              To request access to, correction of, or deletion of your personal data, email us at the address above with the subject line &quot;Data Request&quot;. We respond within 30 days.
            </p>
          </div>

          <div className="p-5 bg-brand-card border border-brand-border rounded-2xl">
            <p className="text-white font-medium mb-1">Report abuse</p>
            <p className="text-purple-200/85 text-sm">
              If you&apos;ve encountered harassment, hate speech, or other abuse on GuestSpeak, email us with the session details. We take all reports seriously.
            </p>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
