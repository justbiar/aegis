import type { Metadata } from 'next'
import { Inter, Instrument_Serif, Fragment_Mono } from 'next/font/google'
import { SessionProvider } from 'next-auth/react'
import './globals.css'

// Subframe design system: Inter for everything functional (headings included),
// a single Instrument Serif accent word/phrase as editorial punctuation, and
// Fragment Mono for code-like / technical labels (hex, hashes, tags).
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
})
const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-serif',
  display: 'swap',
})
const fragmentMono = Fragment_Mono({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-mono-ui',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Aegis',
  description: 'Whitehat rescue for exposed on-chain funds on Starknet, via the STRK20 shielded pool',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${instrumentSerif.variable} ${fragmentMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        {/* Set the theme before paint so there's no light/dark flash. Reads the
            saved choice, falling back to the OS preference. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':matchMedia('(prefers-color-scheme:dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();",
          }}
        />
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  )
}
