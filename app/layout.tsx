import "@excalidraw/excalidraw/index.css";
import "./styles.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Draw",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
