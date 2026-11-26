'use client'
import { useState } from 'react'
import { Button } from '@/core/ui/button'

/**
 * A read-only value in a monospace field with a Copy button; the outcome is announced in a polite
 * live region. Without a clipboard (an insecure origin) it asks for a manual copy instead. The
 * texts are the caller's (translated); the English ones are only defaults.
 */
export function CopyField({
  label,
  value,
  testId,
  copy = 'Copy',
  copied = 'Copied',
  failed = 'Copy it by hand',
}: {
  label: string
  value: string
  testId?: string
  copy?: string
  copied?: string
  failed?: string
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  async function onCopy() {
    try {
      if (!('clipboard' in navigator)) throw new Error('No clipboard')
      await navigator.clipboard.writeText(value)
      setState('copied')
    } catch {
      setState('failed')
    }
  }
  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-muted px-3 py-2">
        <code
          data-testid={testId}
          className="min-w-0 flex-1 select-all break-all font-mono text-sm"
        >
          {value}
        </code>
        <Button type="button" variant="outline" size="sm" onClick={() => void onCopy()}>
          {copy}
        </Button>
      </div>
      <span role="status" aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
        {state === 'copied' ? copied : state === 'failed' ? failed : ''}
      </span>
    </div>
  )
}
