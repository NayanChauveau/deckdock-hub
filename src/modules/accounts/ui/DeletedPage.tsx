import Link from 'next/link'
import { accountMessages } from '../messages'
import { AccountCard } from './AccountCard'
import { accountMetadata, accountPage, type AccountPageProps } from './page-shell'

export const generateMetadata = accountMetadata('deleted')

/** Where the confirmation link of a deletion lands, once the account is gone. */
export default async function DeletedPage(props: AccountPageProps) {
  return accountPage(props, (locale) => {
    const t = accountMessages[locale].deleted
    return (
      <AccountCard title={t.title} lead={t.body}>
        <p className="text-center text-sm">
          <Link
            href={`/${locale}`}
            className="font-medium text-brand underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {t.back}
          </Link>
        </p>
      </AccountCard>
    )
  })
}
