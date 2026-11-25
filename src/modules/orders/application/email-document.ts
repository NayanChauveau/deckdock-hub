/**
 * An order email as content: what it says, in which order, with which links. Built by the use
 * cases (notifications.ts) and by selling modules (OrderExtension.emailFor); rendered to HTML and
 * plain text by the email adapter (adapters/email/layout.ts), never here.
 */
export interface EmailLink {
  label: string
  url: string
}
export interface EmailSection {
  heading?: string
  rows?: (readonly [string, string])[]
  /** The last row is the total: shown in bold above a rule. */
  totalRow?: boolean
  lines?: string[]
}
export interface EmailDocument {
  locale: 'fr' | 'en'
  /** Short text shown by mail clients next to the subject. */
  preheader: string
  eyebrow: string
  title: string
  greeting?: string
  intro: string
  sections: EmailSection[]
  action?: EmailLink & { note?: string }
  notes: { text: string; link?: EmailLink }[]
  closing?: string
  signature: EmailLink
}

/** The site as an email names it: signature and header. */
export interface EmailBrand {
  name: string
  domain: string
}
