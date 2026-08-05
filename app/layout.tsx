import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Job Bidder',
  description: 'Multi-tenant job-bidding agency platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-navy-950 text-navy-100 antialiased">{children}</body>
    </html>
  );
}
