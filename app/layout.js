import { GeistSans } from 'geist/font/sans';
import '@fontsource-variable/bricolage-grotesque/wdth.css';
import './globals.css';

export const metadata = {
  title: 'LopyMarket',
  description: 'Spotting suspiciously well-informed Polymarket wallets, and paper-trading behind them.',
};

export const viewport = {
  themeColor: '#0A1424',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={GeistSans.variable}>
      <body>{children}</body>
    </html>
  );
}
