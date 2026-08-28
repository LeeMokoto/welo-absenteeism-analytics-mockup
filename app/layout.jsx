import "./globals.css";

export const metadata = {
  title: "Welo Sick Leave Intelligence",
  description:
    "Sick leave intelligence oriented at care pathways and workforce planning. Synthetic sample data only.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
