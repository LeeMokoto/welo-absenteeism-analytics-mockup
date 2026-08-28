import "./globals.css";

export const metadata = {
  title: "Welo Sick Leave Intelligence",
  description:
    "Sick leave intelligence oriented at care pathways and workforce planning. Synthetic sample data.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        {/* Same typefaces as the absenteeism dashboard: General Sans for text,
            JetBrains Mono for labels and figures. Both have local fallbacks in
            globals.css if the CDNs are unavailable. */}
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=general-sans@500,600,700,400&display=swap"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
