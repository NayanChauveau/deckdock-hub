'use client'
import { useParams } from 'next/navigation'
import { Button } from '@/core/ui/button'
import { messages } from '@/site/messages'
import { useSiteIdentity } from '@/core/ui/site-identity'
import { SiteFrame } from '@/site/SiteChrome'

// A client component: it cannot read the session, so its header has no account entry.
export default function ErrorPage({
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  const { locale } = useParams<{ locale: string }>()
  const language = locale === 'en' ? 'en' : 'fr'
  const t = messages[language]
  const { displayName } = useSiteIdentity()
  return (
    <SiteFrame locale={language} viewer={null}>
      <div className="state-screen">
        <p className="eyebrow">{displayName}</p>
        <h1>{t.errorTitle}</h1>
        <p>{t.errorText}</p>
        <Button type="button" variant="outline" onClick={retry}>
          {t.retry} <span aria-hidden="true">↗</span>
        </Button>
      </div>
    </SiteFrame>
  )
}
