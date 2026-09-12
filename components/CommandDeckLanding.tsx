'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

// The Command Deck — public SaaS landing page for JobBidder. This is a React
// port of /root/job-bidder-landing/a-command-deck.html (the direction Shalom
// chose), rendered at the app root so pitchr.com.ng/ serves it. The CTA buttons
// route into the real app (login / pricing-anchor); the console ticks with
// mock activity the same way the static mockup did.

const CONSOLE_CYCLE: [string, string][] = [
  ['DevOps Engineer', 'Vantiva'],
  ['Data Platform Eng', 'Cobalt'],
  ['Analytics Engineer', 'OrbitWorks'],
  ['ETL Developer', 'DataBridge'],
];

export default function CommandDeckLanding() {
  const [tick, setTick] = useState(0);

  // Replicate the static page's console tick: prepend a new "submitted" line
  // every 3s (advance a counter; render the last 5 rows). Respects reduced
  // motion by just advancing state but the rows are rendered regardless.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 3000);
    return () => clearInterval(id);
  }, []);

  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const nowLabel = `${hh}:${mm}`;
  const [cycleRole, cycleCo] = CONSOLE_CYCLE[tick % CONSOLE_CYCLE.length];
  const liveRows: { t: string; r: string; c: string }[] = [
    { t: nowLabel, r: cycleRole, c: cycleCo },
    { t: sub(nowLabel, 5), r: 'Data Engineer', c: 'Finastra' },
    { t: sub(nowLabel, 12), r: 'Analytics Engineer', c: 'Ziff Davis' },
    { t: sub(nowLabel, 19), r: 'Data Architect', c: 'GovCIO' },
    { t: sub(nowLabel, 26), r: 'BI Engineer', c: 'Mercury' },
  ];

  return (
    <div className="jb-land-wrap">
      {/* skip link */}
      <a href="#main" className="jb-skip">Skip to content</a>

      {/* nav */}
      <nav className="jb-nav">
        <div className="jb-nav-in">
          <a href="#main" className="jb-logo"><span className="jb-mark" /> JobBidder</a>
          <div className="jb-nav-links">
            <a href="#how">How it works</a>
            <a href="#features">Capabilities</a>
            <a href="#pricing">Pricing</a>
          </div>
          <Link href="/login" className="jb-cta">Sign in</Link>
        </div>
      </nav>

      {/* hero */}
      <header className="jb-hero jb-wrap" id="main">
        <div className="jb-hero-grid">
          <div>
            <h1>Your applications, handled by a team that <span className="jb-a">never sleeps.</span></h1>
            <p className="jb-sub">JobBidder finds verified remote roles, writes a resume to match each one, and submits while you build.</p>
            <div className="jb-hero-cta">
              <Link href="/login" className="jb-btn jb-btn-solid">Start a campaign</Link>
              <a href="#how" className="jb-btn jb-btn-ghost">See how it works</a>
            </div>
          </div>
          <div className="jb-console" aria-label="Live application activity">
            <div className="jb-con-head">
              <span className="jb-lights"><span className="on" /><span /><span /></span>
              <span className="jb-con-name">jobbidder · activity</span>
            </div>
            <div className="jb-con-body">
              {liveRows.map((row, i) => (
                <div key={i} className={i === 0 ? 'jb-log jb-live' : 'jb-log'}>
                  <span className="jb-t">{row.t}</span>
                  <span className="jb-r">{row.r}</span>
                  <span className="jb-c">{row.c}</span>
                  <span className="jb-st">submitted</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* metric band */}
      <div className="jb-band">
        <div className="jb-wrap jb-band-in">
          <div><div className="jb-big-n">4,200+ <small>apps / week</small></div><div className="jb-big-l">across all active campaigns</div></div>
          <div className="jb-feat-r"><div className="jb-big-n">Verified</div><div className="jb-big-l">every role, against the posting</div></div>
          <div className="jb-feat-r"><div className="jb-big-n">Tailored</div><div className="jb-big-l">a fresh resume per job</div></div>
          <div className="jb-feat-r"><div className="jb-big-n">Tracked</div><div className="jb-big-l">in a history you can read</div></div>
        </div>
      </div>

      {/* how */}
      <section id="how" className="jb-section">
        <div className="jb-wrap">
          <h2>Three moves, on repeat, <em>quietly.</em></h2>
          <div className="jb-pline">
            <div className="jb-p"><div className="jb-no">01.</div><div><h3>Point it at a role</h3><p>A target title, a stack, a level. We keep the queue to genuinely remote, on-fit roles and nothing else.</p></div></div>
            <div className="jb-p"><div className="jb-no">02.</div><div><h3>We tailor and submit</h3><p>Each job gets a resume written from your real experience, formatted for the posting, checked for keywords.</p></div></div>
            <div className="jb-p"><div className="jb-no">03.</div><div><h3>You read the history</h3><p>Every send logged with proof and a clean weekly view. You always know where your search stands.</p></div></div>
          </div>
        </div>
      </section>

      {/* features */}
      <section id="features" className="jb-section">
        <div className="jb-wrap">
          <h2>Built like a hiring ops room, <em>not a job board.</em></h2>
          <div className="jb-bento">
            <div className="jb-cell jb-c-1"><h3><span className="jb-g" />Resume Lab</h3><p>Design presets, per-role bullet counts, live preview, and an education section that survives the export.</p></div>
            <div className="jb-cell jb-c-2"><h3><span className="jb-g" />Verified-remote badges</h3><p>Every role is checked against the actual posting. On-site and auto-apply traps are filtered before they reach you.</p></div>
            <div className="jb-cell jb-c-3"><h3><span className="jb-g" />ATS-aware tailoring</h3><p>Keyword alignment computed per description, so tailored resumes clear filters and reach a human.</p>
              <div className="jb-tint-code"><b>match(role, resume)</b><br />→ 0.92 fit<br /><b>skip</b> on-site · easy-apply</div>
            </div>
            <div className="jb-cell jb-c-4"><h3><span className="jb-g" />Client history</h3><p>A weekly read-out of every application, tailored resume, and outcome: for the person funding the search.</p></div>
            <div className="jb-cell jb-c-5"><h3><span className="jb-g" />Pause is free</h3><p>Stop or resume a campaign without a penalty. No lock-in, no annual contract, no surprise fees.</p></div>
          </div>
        </div>
      </section>

      {/* agents */}
      <section id="agents" className="jb-section">
        <div className="jb-wrap">
          <h2>Specialists, <em>not a single bot.</em></h2>
          <div className="jb-alist">
            <div className="jb-ag"><div className="jb-mono">Sc</div><div><h3>The Scout</h3><p>Finds and verifies remote roles that fit your stack, dropping the noise before it hits your queue.</p></div></div>
            <div className="jb-ag"><div className="jb-mono">Sr</div><div><h3>The Scribe</h3><p>Writes a personalized resume per job: real experience, exact bullet counts, clean design.</p></div></div>
            <div className="jb-ag"><div className="jb-mono">Rg</div><div><h3>The Registrar</h3><p>Tracks every send, proof, and reply into one history the client actually reads.</p></div></div>
          </div>
        </div>
      </section>

      {/* pricing */}
      <section id="pricing" className="jb-section">
        <div className="jb-wrap">
          <h2>One target, one campaign, <em>no per-lead surprise.</em></h2>
          <div className="jb-tiers">
            <div className="jb-tier"><div className="jb-who">Solo</div><div className="jb-price">$180 <small>/mo</small></div><ul><li>1 role target</li><li>40 applications / wk</li><li>Resume Lab + tailoring</li><li>Client history</li></ul><a className="jb-btn" href="#pricing">Solo</a></div>
            <div className="jb-tier jb-growth"><div className="jb-who">Growth</div><div className="jb-price">$349 <small>/mo</small></div><ul><li>3 role targets</li><li>100 applications / wk</li><li>2 agent personas</li><li>Weekly written report</li><li>Pause anytime</li></ul><a className="jb-btn" href="#pricing">Growth</a></div>
            <div className="jb-tier"><div className="jb-who">Team</div><div className="jb-price">Custom</div><ul><li>Unlimited targets</li><li>Multi-client management</li><li>Dedicated account ops</li><li>SLA priority</li></ul><a className="jb-btn" href="#pricing">Talk to us</a></div>
          </div>
        </div>
      </section>

      {/* closing */}
      <div className="jb-closing jb-wrap">
        <h2>First application out within 24 hours.</h2>
        <p>Try a month, read the history, and decide with the numbers in front of you.</p>
        <Link href="/login" className="jb-btn jb-btn-solid">Start a campaign →</Link>
      </div>

      {/* footer */}
      <footer className="jb-foot">
        <div className="jb-wrap jb-foot-in">
          <span>© 2026 JobBidder</span>
          <span><a href="#how">How it works</a> · <a href="#pricing">Pricing</a></span>
        </div>
      </footer>
    </div>
  );
}

// Subtract minutes from an "HH:MM" label (for the console's fake timestamps).
function sub(hhmm: string, mins: number): string {
  const [h0, m0] = hhmm.split(':').map(Number);
  const total = (h0 * 60 + m0 - mins + 1440) % 1440;
  const h = String(Math.floor(total / 60)).padStart(2, '0');
  const m = String(total % 60).padStart(2, '0');
  return `${h}:${m}`;
}