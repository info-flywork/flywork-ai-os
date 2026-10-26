import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Flywork Panel",
  description: "Flywork iç operasyon paneli",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr" className={inter.variable}>
      <body className="min-h-screen bg-[#f5f7fb] font-sans text-slate-900">{children}</body>
    </html>
  );
}
