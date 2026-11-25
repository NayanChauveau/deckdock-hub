'use client'
import { createContext, useContext } from 'react'

/**
 * The public identity of the site for client components. They never import the site
 * configuration (it also holds deploy paths, which do not belong in a browser bundle): a server
 * layout passes the identity down through this provider.
 */
export interface SiteIdentity {
  displayName: string
}

const SiteIdentityContext = createContext<SiteIdentity>({ displayName: '' })

export function SiteIdentityProvider({
  identity,
  children,
}: {
  identity: SiteIdentity
  children: React.ReactNode
}) {
  return <SiteIdentityContext value={identity}>{children}</SiteIdentityContext>
}

export function useSiteIdentity(): SiteIdentity {
  return useContext(SiteIdentityContext)
}
