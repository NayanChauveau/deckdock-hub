'use client'
import { useState } from 'react'
import { Button } from '@/core/ui/button'

/**
 * Copies `value` to the clipboard and says whether it worked, in a polite live region. Without a
 * clipboard (an insecure origin), it asks for a manual copy instead.
 */
export function CopyButton({
  value,
  label,
  copied,
  failed,
}: {
  value: string
  label: string
  copied: string
  failed: string
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  async function copy() {
    try {
      if (!('clipboard' in navigator)) throw new Error('No clipboard')
      await navigator.clipboard.writeText(value)
      setState('copied')
    } catch {
      setState('failed')
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="outline" onClick={() => void copy()}>
        {label}
      </Button>
      <span role="status" aria-live="polite" className="text-muted-foreground">
        {state === 'copied' ? copied : state === 'failed' ? failed : ''}
      </span>
    </div>
  )
}
