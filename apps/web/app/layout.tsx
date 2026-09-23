import type { ReactNode } from "react";
import "@niveshbook/ui/src/styles/tokens.css";
import { Toaster } from "@niveshbook/ui";
import { getClientConfig } from "@/lib/client-config";

const { appName } = getClientConfig().branding;

export const metadata = {
  title: appName,
  description: `${appName} — sign in to your workspace`,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
