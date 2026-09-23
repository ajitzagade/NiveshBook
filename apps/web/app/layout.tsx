import type { ReactNode } from "react";
import "@niveshbook/ui/src/styles/tokens.css";

export const metadata = {
  title: "NiveshBook",
  description: "NiveshBook — sign in to your workspace",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
