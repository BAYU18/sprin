import './globals.css';

export const metadata = {
  title: 'PrintServer Pro – Enterprise Edition',
  description: 'Enterprise Centralized Print Management System',
  manifest: '/manifest.json',
  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg',
  }
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
        <script dangerouslySetInnerHTML={{ __html: `
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', function() {
              navigator.serviceWorker.register('/sw.js').then(function(reg) {
                reg.update();
              }).catch(function(err) {
                console.log('SW registration failed: ', err);
              });
            });
          }
        ` }} />
      </body>
    </html>
  );
}