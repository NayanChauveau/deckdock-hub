'use client'

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronDownIcon, MenuIcon, XIcon } from 'lucide-react'

/** A full navigation: nothing of the signed-in page stays in the client router's cache. */
const leave = (url: string) => {
  window.location.assign(url)
}

/**
 * A disclosure: a button (`aria-expanded`) and the panel it shows. Escape closes it and gives the
 * focus back to the button; a link followed from the panel closes it too. Server and client both
 * render it closed, so hydration never differs.
 */
function useDisclosure() {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const id = useId()
  const close = (focus: boolean) => {
    setOpen(false)
    if (focus) button.current?.focus()
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && open) {
      event.stopPropagation()
      close(true)
    }
  }
  const onClick = (event: { target: EventTarget }) => {
    if (event.target instanceof Element && event.target.closest('a')) close(false)
  }
  return { open, setOpen, button, id, close, onKeyDown, onClick }
}

/** The header's links in a column, under 768 px: the menu button and its panel. */
export function MobileMenu({ label, children }: { label: string; children: ReactNode }) {
  const { open, setOpen, button, id, onKeyDown, onClick } = useDisclosure()
  const Icon = open ? XIcon : MenuIcon
  return (
    <div className="mobile-menu" onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className="menu-button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        onClick={() => {
          setOpen(!open)
        }}
      >
        <Icon aria-hidden="true" size={20} />
      </button>
      <div id={id} className="mobile-panel" hidden={!open} onClick={onClick}>
        {children}
      </div>
    </div>
  )
}

/**
 * The signed-in visitor's menu, named after their handle (or « Compte »). A click outside closes it.
 * The accessible name starts with the visible label (WCAG 2.5.3), then says what the button opens.
 */
export function AccountMenu({
  label,
  description,
  children,
}: {
  label: string
  description: string
  children: ReactNode
}) {
  const { open, setOpen, button, id, close, onKeyDown, onClick } = useDisclosure()
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => {
      document.removeEventListener('pointerdown', outside)
    }
  })
  return (
    <div className="account-menu" ref={root} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className="account-button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setOpen(!open)
        }}
      >
        <span className="account-name">{label}</span>
        <span className="sr-only"> – {description}</span>
        <ChevronDownIcon aria-hidden="true" size={16} />
      </button>
      <div id={id} className="account-dropdown" hidden={!open} onClick={onClick}>
        {children}
      </div>
    </div>
  )
}

/**
 * Signs the visitor out through Better Auth's own route (the accounts module's `/api/auth`), then
 * leaves for the homepage with a full navigation.
 */
export function SignOutButton({
  href,
  label,
  failed: failedText,
  navigate = leave,
}: {
  href: string
  label: string
  failed: string
  navigate?: ((url: string) => void) | undefined
}) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  async function signOut() {
    setBusy(true)
    setFailed(false)
    try {
      const response = await fetch('/api/auth/sign-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
      navigate(href)
    } catch {
      setFailed(true)
      setBusy(false)
    }
  }
  return (
    <>
      <button
        type="button"
        className="menu-item"
        disabled={busy}
        onClick={() => {
          void signOut()
        }}
      >
        {label}
      </button>
      {failed && (
        <p className="menu-error" role="alert">
          {failedText}
        </p>
      )}
    </>
  )
}
