/**
 * Order emails rendered twice from their document (application/email-document.ts): HTML for mail
 * clients and plain text as the fallback part. The layout uses tables and inline styles only, the
 * one dialect every mail client (Gmail, Outlook, Apple Mail) renders consistently. Colours and fonts
 * are presentation: they live here, with the markup.
 */
import type { EmailBrand, EmailDocument, EmailSection } from '../../application/email-document'

const colors = {
  page: '#f6f3ed',
  card: '#fffdf8',
  text: '#292d29',
  muted: '#555e50',
  border: '#d8d7ce',
  button: '#34492f',
  buttonText: '#ffffff',
  accent: '#7e302d',
}
const serif = "Georgia, 'Times New Roman', serif"
const sans = 'Arial, Helvetica, sans-serif'

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function renderEmailText(doc: EmailDocument) {
  const colon = doc.locale === 'fr' ? ' : ' : ': '
  const blocks: string[] = []
  if (doc.greeting) blocks.push(doc.greeting)
  blocks.push(doc.intro)
  for (const section of doc.sections) {
    const lines = [
      ...(section.heading ? [section.heading + colon.trimEnd()] : []),
      ...(section.rows ?? []).map(([label, value]) => `${label}${colon}${value}`),
      ...(section.lines ?? []),
    ]
    if (lines.length) blocks.push(lines.join('\n'))
  }
  if (doc.action)
    blocks.push(
      `${doc.action.label}${colon.trimEnd()}\n${doc.action.url}${doc.action.note ? `\n${doc.action.note}` : ''}`,
    )
  for (const note of doc.notes)
    blocks.push(note.link ? `${note.text}\n${note.link.url}` : note.text)
  if (doc.closing) blocks.push(doc.closing)
  blocks.push(`${doc.signature.label}\n${doc.signature.url}`)
  return blocks.join('\n\n')
}

const paragraph = (text: string, style = '') =>
  `<p style="margin:0 0 16px;font-family:${sans};font-size:15px;line-height:24px;color:${colors.text};${style}">${escapeHtml(text)}</p>`

function sectionHtml(section: EmailSection) {
  const heading = section.heading
    ? `<p style="margin:0 0 8px;font-family:${sans};font-size:12px;line-height:16px;letter-spacing:1px;text-transform:uppercase;color:${colors.muted};">${escapeHtml(section.heading)}</p>`
    : ''
  const rows = section.rows ?? []
  const table = rows.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows
        .map(([label, value], index) => {
          const total = section.totalRow && index === rows.length - 1
          const border = total
            ? `border-top:1px solid ${colors.text};`
            : `border-bottom:1px solid ${colors.border};`
          const weight = total ? 'font-weight:bold;' : ''
          const cell = `padding:10px 0;font-family:${sans};font-size:15px;line-height:22px;color:${colors.text};${border}${weight}`
          return `<tr><td style="${cell}">${escapeHtml(label)}</td><td align="right" style="${cell}text-align:right;">${escapeHtml(value)}</td></tr>`
        })
        .join('')}</table>`
    : ''
  const lines = section.lines?.length
    ? `<p style="margin:0;font-family:${sans};font-size:15px;line-height:24px;color:${colors.text};">${section.lines.map(escapeHtml).join('<br>')}</p>`
    : ''
  return `<tr><td style="padding:0 0 24px;">${heading}${table}${lines}</td></tr>`
}

/** Who sends the order emails: the site's display name and domain. */

export function renderEmailHtml(doc: EmailDocument, brand: EmailBrand) {
  const action = doc.action
    ? `<tr><td style="padding:8px 0 28px;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:6px;background:${colors.button};">
<a href="${escapeHtml(doc.action.url)}" style="display:inline-block;padding:14px 26px;font-family:${sans};font-size:15px;font-weight:bold;color:${colors.buttonText};text-decoration:none;border-radius:6px;">${escapeHtml(doc.action.label)}</a>
</td></tr></table>${doc.action.note ? `<p style="margin:10px 0 0;font-family:${sans};font-size:13px;line-height:20px;color:${colors.muted};">${escapeHtml(doc.action.note)}</p>` : ''}
</td></tr>`
    : ''
  const notes = doc.notes
    .map(
      (note) =>
        `<p style="margin:0 0 10px;font-family:${sans};font-size:13px;line-height:20px;color:${colors.muted};">${escapeHtml(note.text)}${
          note.link
            ? ` <a href="${escapeHtml(note.link.url)}" style="color:${colors.muted};text-decoration:underline;">${escapeHtml(note.link.label)}</a>`
            : ''
        }</p>`,
    )
    .join('')
  return `<!doctype html>
<html lang="${doc.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(doc.title)}</title></head>
<body style="margin:0;padding:0;background:${colors.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(doc.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${colors.page};"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
<tr><td style="padding:0 4px 20px;font-family:${serif};font-size:22px;line-height:28px;color:${colors.text};">${escapeHtml(brand.name)}<span style="display:block;font-family:${sans};font-size:11px;line-height:16px;letter-spacing:2px;text-transform:uppercase;color:${colors.muted};">${escapeHtml(doc.eyebrow)}</span></td></tr>
<tr><td style="background:${colors.card};border:1px solid ${colors.border};border-radius:8px;padding:36px 32px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding:0 0 20px;"><h1 style="margin:0;font-family:${serif};font-size:28px;line-height:34px;font-weight:normal;color:${colors.text};">${escapeHtml(doc.title)}</h1></td></tr>
<tr><td>${doc.greeting ? paragraph(doc.greeting) : ''}${paragraph(doc.intro, 'margin-bottom:24px;')}</td></tr>
${doc.sections.map(sectionHtml).join('\n')}
${action}
${notes ? `<tr><td style="padding:0 0 16px;border-top:1px solid ${colors.border};padding-top:20px;">${notes}</td></tr>` : ''}
</table></td></tr>
<tr><td style="padding:24px 4px 0;font-family:${sans};font-size:13px;line-height:20px;color:${colors.muted};">${doc.closing ? `${escapeHtml(doc.closing)}<br>` : ''}<a href="${escapeHtml(doc.signature.url)}" style="color:${colors.accent};text-decoration:none;font-family:${serif};font-size:15px;">${escapeHtml(doc.signature.label)}</a></td></tr>
</table></td></tr></table>
</body></html>`
}
