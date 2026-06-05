import './globals.css';

export const metadata = {
  title: 'PrintServer Pro – Enterprise Edition',
  description: 'Enterprise Centralized Print Management System',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}