import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { SessionProvider } from "@/components/SessionProvider";
import { Sidebar } from "@/components/Sidebar";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "HDPM-OS",
  description: "The operating system for High Desert Property Management",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${GeistSans.className} antialiased`}>
        <SessionProvider>
          <AppShell>
            {children}
          </AppShell>
        </SessionProvider>
      </body>
    </html>
  );
}
