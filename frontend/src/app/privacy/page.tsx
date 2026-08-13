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
        <p className="text-purple-200/75 text-sm mb-10">Effective: August 12, 2026</p>

        <div className="space-y-8 text-purple-200/80 leading-relaxed">
          <p>
            GuestSpeak (&quot;we&quot;, &quot;our&quot;, &quot;us&quot;) is committed to protecting your privacy. This policy explains what information we collect, how we use it, and your rights around it. If you have questions, contact us at <a href="mailto:guestspeak@protonmail.com" className="text-brand-orange hover:underline">guestspeak@protonmail.com</a>.
          </p>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">1. Information we collect</h2>
            <p className="mb-3"><span className="text-white font-medium">Account information.</span> When you register, we collect your email address, username, and a hashed version of your password. We never store your password in plain text.</p>
            <p className="mb-3"><span className="text-white font-medium">Guest sessions.</span> If you join without an account, we assign a temporary guest token stored in your browser. This token identifies your participation within a session but is not linked to your identity.</p>
            <p className="mb-3"><span className="text-white font-medium">Content you submit.</span> Questions and echoes you add are stored and associated with your account or guest token.</p>
            <p className="mb-3"><span className="text-white font-medium">Usage data and IP addresses.</span> We record your IP address when you create a guest session or join a Q&amp;A session. Your IP address is stored in our database linked to your account or guest token and is used to enforce platform bans, detect abuse, and prevent credit farming. We also collect standard server logs (timestamp, HTTP method) for security and debugging. We do not use third-party analytics services.</p>
            <p><span className="text-white font-medium">Notification subscriptions.</span> If you turn on notifications, your browser gives us a subscription: a delivery address at your browser vendor&apos;s push service, plus two keys used to encrypt each message so the push service cannot read it. We store one of these per browser or device you enable it on. It contains no name, email, or location. You can turn notifications off at any time in Settings, which removes it; we also delete it automatically once the push service reports it is no longer valid.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">2. How we use your information</h2>
            <p className="mb-3">We use your information solely to provide and improve GuestSpeak. Specifically:</p>
            <ul className="list-disc list-inside space-y-1 text-purple-200/90">
              <li>To authenticate you and maintain your session</li>
              <li>To display your questions and echoes in sessions you participate in</li>
              <li>To enforce session credit limits and regeneration</li>
              <li>To investigate abuse reports or violations of our Terms of Service</li>
              <li>To enforce platform bans across accounts and devices using your IP address</li>
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
            <h2 className="text-xl font-semibold text-white mb-3">4. Data retention and account deletion</h2>
            <p className="mb-3">Guest tokens expire after the session ends. Session content (questions, echoes) is retained unless removed by the host or by us following a moderation action.</p>
            <p className="mb-3">You can delete your account yourself at any time from Settings. We are specific about what that does, because it is not a blanket erasure:</p>
            <ul className="list-disc list-inside space-y-1 text-purple-200/90 mb-3">
              <li>Your email, username, password, join-code prefix and stored IP address are permanently erased, and your notification subscriptions are deleted</li>
              <li>You can no longer sign in, and your username is released for anyone else to use</li>
              <li>Questions you asked remain in the sessions they were asked in, but are no longer attributed to you — your name is removed from them</li>
              <li>Sessions you hosted remain, so that questions asked by other people are not destroyed along with your account</li>
            </ul>
            <p>We keep the empty account record itself so that other people&apos;s content stays intact and so that any moderation action against you remains enforceable. It holds no personal information about you.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">5. Third-party services</h2>
            <p className="mb-3">We use Supabase to host our database. Your data is stored on servers in Canada. We use Resend for transactional email (e.g., password resets). These services process data on our behalf under their own privacy policies.</p>
            <p>If you enable notifications, messages are delivered through the push service run by your browser vendor — Apple, Google or Mozilla, depending on your browser. They receive the delivery address and the encrypted message, which they relay without being able to read it.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">6. Your rights</h2>
            <p className="mb-3">You can delete your account yourself from Settings, without asking us — see section 4 for exactly what that removes.</p>
            <p>For anything else, including access to or correction of your data, email <a href="mailto:guestspeak@protonmail.com" className="text-brand-orange hover:underline">guestspeak@protonmail.com</a>. We will respond within 30 days.</p>
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
