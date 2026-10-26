

import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-inter" });

export const metadata = {
  title: "Flywork Panel",
  description: "Flywork iç operasyon paneli",
};

export default function RootLayout({ children }) {
  return (
    <html lang="tr" className={inter.variable}>
      <body className="min-h-screen bg-[#f5f7fb] font-sans text-slate-900">{children}</body>
    </html>
  );
}
