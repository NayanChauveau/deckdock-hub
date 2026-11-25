import Link from 'next/link'
import { accountMessages } from '../messages'
import { accountMetadata, accountPage, type AccountPageProps } from './page-shell'

export const generateMetadata = accountMetadata('deleted')

/** Where the confirmation link of a deletion lands, once the account is gone. */
export default async function DeletedPage(props: AccountPageProps) {
  return accountPage(props, (locale) => {
    const t = accountMessages[locale].deleted
    return (
      <main className="commerce-page flex flex-col gap-8">
        <h1>{t.title}</h1>
        <p>{t.body}</p>
        <p>
          <Link href={`/${locale}`} className="text-link">
            {t.back}
          </Link>
        </p>
      </main>
    )
  })
}
