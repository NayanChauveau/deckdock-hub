import type { ReactNode } from 'react'
import { Alert, AlertDescription } from '@/core/ui/alert'

export function Notice({
  children,
  tone = 'info',
}: {
  children: ReactNode
  tone?: 'info' | 'error'
}) {
  return (
    <Alert
      variant={tone === 'error' ? 'destructive' : 'default'}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  )
}
