import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./harbor-public.css";

export const metadata: Metadata = {
  title: "Harborline",
  description:
    "Cash-aware investing for freelancers, powered by the True Markets Gateway.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
