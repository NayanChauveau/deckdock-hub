'use client'
import { useParams } from 'next/navigation'
import { Button } from '@/core/ui/button'
import { messages } from '@/site/messages'
import { useSiteIdentity } from '@/core/ui/site-identity'
export default function ErrorPage({
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  const { locale } = useParams<{ locale: string }>()
  const t = messages[locale === 'en' ? 'en' : 'fr']
  const { displayName } = useSiteIdentity()
  return (
    <main className="state-screen">
      <p className="eyebrow">{displayName}</p>
      <h1>{t.errorTitle}</h1>
      <p>{t.errorText}</p>
      <Button type="button" variant="outline" onClick={retry}>
        {t.retry} <span aria-hidden="true">↗</span>
      </Button>
    </main>
  )
}
