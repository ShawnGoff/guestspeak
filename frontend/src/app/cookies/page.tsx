import Link from 'next/link';
import Footer from '@/components/Footer';

export const metadata = { title: 'Cookie Policy — GuestSpeak' };

export default function CookiesPage() {
  return (
    <div className="min-h-screen bg-brand-bg flex flex-col">
      <header className="px-6 py-5 border-b border-brand-border/40">
        <Link href="/" className="font-display font-bold text-xl tracking-tight">
          Guest<span className="text-brand-orange">Speak</span>
        </Link>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-16">
        <h1 className="text-4xl font-bold text-white mb-3">Cookie Policy</h1>
        <p className="text-purple-200/50 text-sm mb-10">Effective: August 1, 2026</p>

        <div className="space-y-8 text-purple-200/80 leading-relaxed">
          <p>
            This policy explains how GuestSpeak uses cookies and similar storage mechanisms. The short version: we use as few as possible, and none for advertising.
          </p>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">What we use</h2>
            <p className="mb-4">GuestSpeak stores one item in your browser:</p>
            <div className="border border-brand-border/50 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-brand-border/50 bg-brand-card">
                    <th className="text-left px-4 py-3 text-white font-semibold">Name</th>
                    <th className="text-left px-4 py-3 text-white font-semibold">Purpose</th>
                    <th className="text-left px-4 py-3 text-white font-semibold">Expires</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="px-4 py-3 font-mono text-brand-orange">gs_token</td>
                    <td className="px-4 py-3">Keeps you logged in between visits (JWT authentication token)</td>
                    <td className="px-4 py-3">30 days</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">What we don&apos;t use</h2>
            <ul className="list-disc list-inside space-y-1 text-purple-200/70">
              <li>Advertising or targeting cookies</li>
              <li>Third-party analytics (no Google Analytics, no Mixpanel)</li>
              <li>Social media tracking pixels</li>
              <li>Cross-site tracking of any kind</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">How to opt out</h2>
            <p>You can clear or block cookies in your browser settings at any time. If you clear the authentication token, you will be signed out. Guest participants do not need to accept any cookies to use GuestSpeak — the guest token is stored in <code className="text-brand-orange text-xs bg-brand-card px-1.5 py-0.5 rounded">localStorage</code>, not a cookie, and is cleared when you close the browser or when the session ends.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Questions</h2>
            <p>Contact us at <a href="mailto:guestspeak@protonmail.com" className="text-brand-orange hover:underline">guestspeak@protonmail.com</a>.</p>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
