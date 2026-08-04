import Link from 'next/link';
import Footer from '@/components/Footer';

export const metadata = { title: 'About — GuestSpeak' };

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-brand-bg flex flex-col">
      <header className="px-6 py-5 border-b border-brand-border/40">
        <Link href="/" className="font-display font-bold text-xl tracking-tight">
          Guest<span className="text-brand-orange">Speak</span>
        </Link>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-16">
        <h1 className="text-4xl font-bold text-white mb-3">About GuestSpeak</h1>
        <p className="text-brand-orange text-sm font-semibold uppercase tracking-widest mb-10">Live Q&A for rooms with something to say</p>

        <div className="space-y-8 text-purple-200/80 leading-relaxed">
          <p>
            GuestSpeak is a live audience Q&A platform built for conferences, panels, town halls, classrooms — any room where the audience has something to say.
          </p>

          <p>
            Instead of a chaotic open-floor format or an ignored suggestion box, GuestSpeak gives every attendee a voice — and lets the crowd surface the best questions naturally. Attendees submit questions and add <span className="text-brand-orange font-medium">Echoes</span> to ones they want answered. The most-echoed questions rise to the top so hosts can prioritize what the room actually cares about.
          </p>

          <h2 className="text-xl font-semibold text-white pt-4">How it works</h2>
          <p>
            Hosts create a session and share a join code or link. Guests join in seconds — nothing to download, no account needed. Each attendee gets a small number of credits to spend on questions and Echoes, which keeps participation thoughtful rather than spammy. Credits replenish over time, so the room keeps its voice from the first question to the last.
          </p>

          <h2 className="text-xl font-semibold text-white pt-4">Built for real rooms</h2>
          <p>
            GuestSpeak works equally well in-person and online. Hosts can embed a live stream so remote attendees watch and participate on the same page as in-person guests. Sessions can be public (discoverable) or unlisted (join-code only). Hosts control the pace — pinning top questions, marking questions answered, and closing submissions when the time is right.
          </p>

          <h2 className="text-xl font-semibold text-white pt-4">Privacy by design</h2>
          <p>
            Signed-in users can post questions anonymously — shown only as Anon1, Anon2, and so on. The host sees the label, not the person. We built it this way because the best questions at work events are often the ones people are afraid to put their name on.
          </p>

          <div className="pt-6 border-t border-brand-border/40">
            <p>Questions or feedback? Reach us at <a href="mailto:guestspeak@protonmail.com" className="text-brand-orange hover:underline">guestspeak@protonmail.com</a></p>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
