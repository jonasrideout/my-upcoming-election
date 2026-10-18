import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "My Ballot",
  description: "See what's on your ballot.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
