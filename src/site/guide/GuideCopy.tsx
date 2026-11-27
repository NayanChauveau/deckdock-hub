'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * The Copy buttons of a guide page's code blocks. The page is rendered on the server as HTML
 * (render.ts), each block with a hidden `[data-guide-copy]` button: this shows them once the
 * script runs, and copies the block's code on click (delegated, like CopyButton in the decks
 * module: the clipboard, else a request to copy by hand). The outcome is said in the button and
 * in a polite live region.
 */
export function GuideCopy({
  labels,
  children,
}: {
  labels: { copy: string; copied: string; failed: string }
  children: ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState('')

  useEffect(() => {
    const element = root.current
    if (!element) return
    const buttons = [...element.querySelectorAll<HTMLButtonElement>('[data-guide-copy]')]
    for (const button of buttons) button.hidden = false
    const timers = new Set<ReturnType<typeof setTimeout>>()
    async function onClick(event: MouseEvent) {
      const button = (event.target as Element | null)?.closest<HTMLButtonElement>(
        '[data-guide-copy]',
      )
      const code = button?.parentElement?.querySelector('code')?.textContent
      if (!button || typeof code !== 'string') return
      let copied = false
      try {
        if (!('clipboard' in navigator)) throw new Error('No clipboard')
        await navigator.clipboard.writeText(code)
        copied = true
      } catch {
        copied = false
      }
      button.textContent = copied ? labels.copied : labels.failed
      setStatus(copied ? labels.copied : labels.failed)
      const timer = setTimeout(
        () => {
          button.textContent = labels.copy
          timers.delete(timer)
        },
        copied ? 2000 : 5000,
      )
      timers.add(timer)
    }
    const listener = (event: MouseEvent) => void onClick(event)
    element.addEventListener('click', listener)
    return () => {
      element.removeEventListener('click', listener)
      for (const timer of timers) clearTimeout(timer)
    }
  }, [labels])

  return (
    <div ref={root}>
      {children}
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
    </div>
  )
}
