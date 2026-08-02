import Link from 'next/link';
import Footer from '@/components/Footer';

export const metadata = { title: 'Privacy Policy — GuestSpeak' };

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-brand-bg flex flex-col">
      <header className="px-6 py-5 border-b border-brand-border/40">
        <Link href="/" className="font-display font-bold text-xl tracking-tight">
          Guest<span className="text-brand-orange">Speak</span>
        </Link>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-16">
        <h1 className="text-4xl font-bold text-white mb-3">Privacy Policy</h1>
        <p className="text-purple-200/50 text-sm mb-10">Effective: August 1, 2026</p>

        <div className="space-y-8 text-purple-200/80 leading-relaxed">
          <p>
            GuestSpeak (&quot;we&quot;, &quot;our&quot;, &quot;us&quot;) is committed to protecting your privacy. This policy explains what information we collect, how we use it, and your rights around it. If you have questions, contact us at <a href="mailto:guestspeak@protonmail.com" className="text-brand-orange hover:underline">guestspeak@protonmail.com</a>.
          </p>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">1. Information we collect</h2>
            <p className="mb-3"><span className="text-white font-medium">Account information.</span> When you register, we collect your email address, username, and a hashed version of your password. We never store your password in plain text.</p>
            <p className="mb-3"><span className="text-white font-medium">Guest sessions.</span> If you join without an account, we assign a temporary guest token stored in your browser. This token identifies your participation within a session but is not linked to your identity.</p>
            <p className="mb-3"><span className="text-white font-medium">Content you submit.</span> Questions and echoes you add are stored and associated with your account or guest token.</p>
            <p><span className="text-white font-medium">Usage data.</span> We collect basic server logs (IP address, timestamp, HTTP method) for security and debugging. We do not use third-party analytics services.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">2. How we use your information</h2>
            <p className="mb-3">We use your information solely to provide and improve GuestSpeak. Specifically:</p>
            <ul className="list-disc list-inside space-y-1 text-purple-200/70">
              <li>To authenticate you and maintain your session</li>
              <li>To display your questions and echoes in sessions you participate in</li>
              <li>To enforce session credit limits and regeneration</li>
              <li>To investigate abuse reports or violations of our Terms of Service</li>
            </ul>
            <p className="mt-3">We do not sell your data. We do not share it with advertisers or data brokers.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">3. Anonymity</h2>
            <p>
              Registered users may post questions anonymously within a session. When you do, your real identity is hidden from other participants and from the session host — you appear only as &quot;Anon1&quot;, &quot;Anon2&quot;, etc. Your identity remains on file with GuestSpeak and may be revealed to platform administrators in cases of abuse or legal requirement.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">4. Data retention</h2>
            <p>Account data is retained until you request deletion. Guest tokens expire after the session ends. Session content (questions, echoes) is retained unless removed by the host or by us following a moderation action.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">5. Third-party services</h2>
            <p>We use Supabase to host our database. Your data is stored on servers in Canada. We use Resend for transactional email (e.g., password resets). These services process data on our behalf under their own privacy policies.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">6. Your rights</h2>
            <p>You may request access to, correction of, or deletion of your personal data at any time by emailing <a href="mailto:guestspeak@protonmail.com" className="text-brand-orange hover:underline">guestspeak@protonmail.com</a>. We will respond within 30 days.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">7. Changes to this policy</h2>
            <p>We may update this policy. If we make material changes, we will update the effective date above. Continued use of GuestSpeak after changes constitutes acceptance of the updated policy.</p>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
