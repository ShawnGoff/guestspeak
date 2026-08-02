import Link from 'next/link';
import Footer from '@/components/Footer';

export const metadata = { title: 'Terms of Service — GuestSpeak' };

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-brand-bg flex flex-col">
      <header className="px-6 py-5 border-b border-brand-border/40">
        <Link href="/" className="font-display font-bold text-xl tracking-tight">
          Guest<span className="text-brand-orange">Speak</span>
        </Link>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-16">
        <h1 className="text-4xl font-bold text-white mb-3">Terms of Service</h1>
        <p className="text-purple-200/50 text-sm mb-10">Effective: August 1, 2026</p>

        <div className="space-y-8 text-purple-200/80 leading-relaxed">
          <p>
            By using GuestSpeak you agree to these terms. If you do not agree, do not use the service. Questions? Contact us at <a href="mailto:guestspeak@protonmail.com" className="text-brand-orange hover:underline">guestspeak@protonmail.com</a>.
          </p>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">1. Use of the service</h2>
            <p className="mb-3">GuestSpeak is a live Q&A platform for events. You may use it for lawful purposes only. You agree not to:</p>
            <ul className="list-disc list-inside space-y-1 text-purple-200/70">
              <li>Submit content that is hateful, discriminatory, or harassing</li>
              <li>Post slurs, threats, or content that targets individuals</li>
              <li>Spam sessions with duplicate or irrelevant questions</li>
              <li>Attempt to manipulate echo counts or credits through automated means</li>
              <li>Use the platform to collect personal data about other participants</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">2. Your content</h2>
            <p>You retain ownership of the questions and content you submit. By submitting content, you grant GuestSpeak a non-exclusive, royalty-free license to display that content within the session and to store it as part of the session record. Hosts may delete questions from their sessions at any time.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">3. Host responsibilities</h2>
            <p>Session hosts are responsible for the events they create and for moderating their sessions appropriately. Hosts must not use GuestSpeak to collect personal information from participants beyond what the platform provides, or to discriminate against participants on any protected basis.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">4. Credits</h2>
            <p>Credits are a participation mechanism, not a currency. Credits have no monetary value, cannot be transferred, and cannot be redeemed for cash. We reserve the right to modify the credit system at any time.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">5. Account termination</h2>
            <p>We may suspend or terminate your account at any time if we determine, in our sole discretion, that you have violated these terms or engaged in abusive behavior. You may close your account at any time by contacting us.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">6. Disclaimer of warranties</h2>
            <p>GuestSpeak is provided &quot;as is&quot; without warranties of any kind, express or implied. We do not guarantee uptime, accuracy, or fitness for any particular purpose. Use the service at your own risk.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">7. Limitation of liability</h2>
            <p>To the fullest extent permitted by law, GuestSpeak shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the service. Our total liability for any claim shall not exceed the amount you paid us in the twelve months prior to the claim.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">8. Governing law</h2>
            <p>These terms are governed by the laws of the United States. Any disputes shall be resolved in the courts of competent jurisdiction in the United States.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">9. Changes</h2>
            <p>We may update these terms. Continued use of GuestSpeak after changes constitutes acceptance. We will update the effective date above when we do.</p>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
