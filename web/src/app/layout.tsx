import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import RouteShell from "@/components/layout/RouteShell";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "NRW Management",
  description: "Web application for Non-Revenue Water management",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning className={`${inter.className} antialiased`}>
        <RouteShell>{children}</RouteShell>
      </body>
    </html>
  );
}

