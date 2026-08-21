import type { Metadata } from 'next'
import { Inter, Space_Mono, Space_Grotesk } from 'next/font/google'
import { SessionProvider } from 'next-auth/react'
import './globals.css'

// Clean neutral grotesque for everything (matches the Uniswap reference); a mono
// only for hex addresses / hashes.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
})
const spaceMono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-mono-ui',
  display: 'swap',
})
// A wider, editorial grotesque used only for large headlines — the rest of
// the UI stays on the body font so this reads as a deliberate accent, not a
// full typeface swap.
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
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
      className={`${inter.variable} ${spaceMono.variable} ${spaceGrotesk.variable}`}
      suppressHydrationWarning
    >
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  )
}
