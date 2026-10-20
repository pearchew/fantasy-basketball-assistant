import type { Metadata } from "next";
import { Geist, Geist_Mono, Press_Start_2P } from "next/font/google";
import { CourtBackground } from "@/components/CourtBackground";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const pixel = Press_Start_2P({
  variable: "--font-pixel",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Fantasy Team Injury Tracker",
  description: "NBA injury news and who benefits, for my fantasy teams",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${pixel.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <CourtBackground />
        <div className="border-y-4 border-[#c2410c] bg-black/70 px-4 py-5 sm:py-6">
          <h1 className="arcade-title text-center font-pixel text-xl leading-snug text-white sm:text-3xl md:text-4xl">
            Fantasy Team Injury Tracker
          </h1>
        </div>
        {children}
      </body>
    </html>
  );
}
