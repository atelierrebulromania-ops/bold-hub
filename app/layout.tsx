import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BoldHub · Atelier Rebul",
  description: "Spațiul operațional pentru comenzile și stocul Atelier Rebul.",
  icons: { icon: "/icon.png", apple: "/icon.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ro" suppressHydrationWarning>
      {/* Windows renders bold Arial much heavier than macOS: mark it before the first paint (see globals.css). */}
      <head><script dangerouslySetInnerHTML={{ __html: "if(/Windows/.test(navigator.userAgent))document.documentElement.classList.add('on-windows')" }} /></head>
      {/* Browser extensions (e.g. Grammarly) add attributes to <body> before React loads. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
