import type { ReactNode } from "react";

export const metadata = {
  title: "NiveshBook",
  description: "NiveshBook — investment tracking",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
