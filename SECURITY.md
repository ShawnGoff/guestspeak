# Security

GuestSpeak holds accounts, email addresses, and the questions people ask —
including questions they chose to ask anonymously. If you find a way to reach
any of that, I want to hear about it.

## Reporting

**Email [mrshawngoff@gmail.com](mailto:mrshawngoff@gmail.com)** with "GuestSpeak
security" in the subject.

Please do not open a public issue, a pull request, or a discussion for anything
that touches user accounts or data. A public report is readable by everyone,
including before there is a fix.

Useful to include, if you have it:

- what you did, specifically enough that I can reproduce it
- what you got that you should not have
- whether you reached any real user's data, and roughly how much

## What to expect

This is a one-person project, so: a reply within a few days, an honest answer
about whether and when it will be fixed, and credit in the fix if you want it.
No bounty — there is no budget for one, and I would rather say so than imply
otherwise.

## Scope

In scope: [guestspeak.app](https://guestspeak.app), `api.guestspeak.app`, and
this repository.

Particularly interesting, because they are where the real risk sits:

- **Anonymity leaks.** A question posted anonymously must not be traceable to
  its author through the API, a timing difference, or arithmetic on counts in a
  small session.
- **Session access.** For an unlisted session the join code *is* the access
  control. Reading or posting to one without the code is a vulnerability.
- **Moderator permissions.** Each is granted individually. Acting beyond what
  was granted — hiding, muting, removing, approving — counts.
- **Guest tokens.** A guest's token should let them do what that guest can do,
  and nothing a registered account can.

Out of scope: rate limits on endpoints that do not change state, missing
security headers with no demonstrated impact, reports from automated scanners
with no working proof, and anything requiring physical access to a user's
unlocked device.

## Please do not

Run load or denial-of-service tests against production, access or modify data
belonging to anyone but yourself, or disrupt a live session. Sessions are live
events with real audiences in them — if you need a session to test against,
create your own.
