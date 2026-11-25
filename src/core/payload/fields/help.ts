import type { Field } from 'payload'

const HELP_LABEL = '/core/admin/components/HelpLabel#HelpLabel'

/**
 * Adds an ⓘ next to the field label, opening a short explanation of what the field is for and
 * where it shows up. The field description, under the input, stays for the essential.
 */
export function withHelp<F extends Field>(field: F, help: string): F {
  const admin = (field as { admin?: { components?: Record<string, unknown> } }).admin ?? {}
  return {
    ...field,
    admin: {
      ...admin,
      components: { ...admin.components, Label: { path: HELP_LABEL, clientProps: { help } } },
    },
  }
}
