import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Draaqutz | Home-Based Barber in Singapore",
  description:
    "Draaqutz is a home-based barber service in Singapore, with flexible Telegram bookings, clean fades, taper fades, haircuts, products, and loyalty rewards."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
