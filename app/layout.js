import './globals.css';

export const metadata = { title: 'LopyMarket', description: 'Suspicious Polymarket wallets and paper copy-trading' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta httpEquiv="refresh" content="30" />
      </head>
      <body>{children}</body>
    </html>
  );
}
