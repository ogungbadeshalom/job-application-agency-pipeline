import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';

export const metadata: Metadata = {
  title: 'Job Bidder',
  description: 'Multi-tenant job-bidding agency platform',
};

// Apply the saved accent (green default / red) before first paint so there's no
// flash of the wrong color. Matches the ThemeToggle's localStorage key.
const accentScript = `
try {
  var a = localStorage.getItem('jobbidder.accent');
  if (a === 'red') document.documentElement.setAttribute('data-accent', 'red');
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
