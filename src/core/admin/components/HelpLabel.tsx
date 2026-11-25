'use client'

import { FieldLabel } from '@payloadcms/ui'
import type { FieldLabelClientProps } from 'payload'
import { useEffect, useId, useRef, useState } from 'react'

/**
 * A field label followed by an ⓘ button: hovering, focusing or tapping it shows the help text.
 * A tap keeps it open until a second tap, Escape or a click elsewhere.
 */
export function HelpLabel({
  help,
  field,
  label,
  required,
  localized,
  ...props
}: FieldLabelClientProps & { help: string }) {
  // A custom Label receives the field itself: its label, required and localized come from there.
  const own = (field ?? {}) as Pick<FieldLabelClientProps, 'label' | 'required' | 'localized'>
  const shown = Object.fromEntries(
    Object.entries({
      label: label ?? own.label,
      required: required ?? own.required,
      localized: localized ?? own.localized,
    }).filter(([, value]) => value !== undefined),
  ) as Pick<FieldLabelClientProps, 'label' | 'required' | 'localized'>
  const id = useId()
  const root = useRef<HTMLSpanElement>(null)
  const [hovered, setHovered] = useState(false)
  const [pinned, setPinned] = useState(false)
  const open = hovered || pinned

  useEffect(() => {
    if (!pinned) return
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setPinned(false)
    }
    document.addEventListener('pointerdown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
    }
  }, [pinned])

  return (
    <span
      ref={root}
      style={{ display: 'flex', alignItems: 'baseline', gap: 6, position: 'relative' }}
      onMouseLeave={() => {
        setHovered(false)
      }}
    >
      {/* Payload pushes the label's right margin to auto: its own box keeps the ⓘ beside it. */}
      <span style={{ display: 'flex' }}>
        <FieldLabel {...props} {...shown} />
      </span>
      <button
        type="button"
        aria-label="À quoi sert ce champ ?"
        aria-expanded={open}
        aria-controls={id}
        onMouseEnter={() => {
          setHovered(true)
        }}
        onFocus={() => {
          setHovered(true)
        }}
        onBlur={() => {
          setHovered(false)
        }}
        onClick={() => {
          setPinned((value) => !value)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          setPinned(false)
          setHovered(false)
        }}
        style={{
          width: 18,
          height: 18,
          flex: 'none',
          padding: 0,
          border: '1px solid var(--theme-elevation-400)',
          borderRadius: '50%',
          background: open ? 'var(--theme-elevation-150)' : 'transparent',
          color: 'var(--theme-elevation-800)',
          font: 'italic 600 11px/16px Georgia, serif',
          cursor: 'help',
        }}
      >
        i
      </button>
      <span
        id={id}
        role="note"
        hidden={!open}
        style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          zIndex: 20,
          width: 'min(420px, 90vw)',
          marginTop: 4,
          padding: '10px 12px',
          background: 'var(--theme-elevation-100)',
          border: '1px solid var(--theme-elevation-250)',
          borderRadius: 4,
          boxShadow: '0 6px 18px rgb(0 0 0 / 18%)',
          color: 'var(--theme-elevation-900)',
          fontSize: 13,
          lineHeight: 1.45,
          whiteSpace: 'pre-line',
        }}
      >
        {help}
      </span>
    </span>
  )
}
