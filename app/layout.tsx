import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';

export const metadata: Metadata = {
  title: 'Job Bidder',
  description: 'Multi-tenant job-bidding agency platform',
};

// Apply the saved accent before first paint (no color flash). Default is RED
// (globals.css :root); only a saved 'green' choice adds the green override attr.
const accentScript = `
try {
  var a = localStorage.getItem('jobbidder.accent');
  if (a === 'green') document.documentElement.setAttribute('data-accent', 'green');
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
