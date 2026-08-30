import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';

export const metadata: Metadata = {
  title: 'Job Bidder',
  description: 'Multi-tenant job-bidding agency platform',
};

// Apply the saved accent before first paint (no color flash). Default is GREEN
// (globals.css :root); a saved choice of any other color sets the matching
// data-accent attribute so the theme applies without flashing the wrong hue.
// Keep this list in sync with the ACCENTS array in lib/accent.ts.
const accentScript = `
try {
  var _a = localStorage.getItem('jobbidder.accent');
  var _valid = ['red','blue','purple','orange','cyan'];
  if (_valid.indexOf(_a) !== -1) document.documentElement.setAttribute('data-accent', _a);
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${GeistSans.variable} ${GeistMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: accentScript }} />
      </head>
      <body className="app-bg bg-navy-950 text-navy-100 antialiased">
        {children}
      </body>
    </html>
  );
}
