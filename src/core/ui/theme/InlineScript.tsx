'use client'

/**
 * An inline script that runs only from the server HTML, as Next's guide "Preventing flash before
 * hydration" recommends. A script React creates in the browser (a client navigation re-rendering the
 * root layout, such as the language switch) never runs, and React logs an error for it; here the
 * browser render gets type="text/plain", a data block React leaves alone. The server render has no
 * type, so the HTML keeps a plain `<script nonce="…">` that runs during parsing; suppressHydrationWarning
 * accepts the type mismatch on hydration.
 */
export function InlineScript({ html, nonce }: { html: string; nonce: string | undefined }) {
  return (
    <script
      type={typeof window === 'undefined' ? undefined : 'text/plain'}
      nonce={nonce}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
