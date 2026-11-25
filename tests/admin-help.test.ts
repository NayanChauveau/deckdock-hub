import assert from 'node:assert/strict'
import test from 'node:test'
import type { Field } from 'payload'
import { withHelp } from '../src/core/payload/fields/help'

const adminOf = (field: Field) => (field as { admin?: Record<string, unknown> }).admin

void test('withHelp puts the ⓘ label on the field and keeps its other admin settings', () => {
  const field = withHelp(
    {
      name: 'seoImage',
      type: 'upload',
      relationTo: 'media',
      admin: { description: 'Short', components: { Description: '/x#X' } },
    },
    'Shown when the link is shared.',
  )
  assert.equal(field.name, 'seoImage')
  assert.deepEqual(adminOf(field), {
    description: 'Short',
    components: {
      Description: '/x#X',
      Label: {
        path: '/core/admin/components/HelpLabel#HelpLabel',
        clientProps: { help: 'Shown when the link is shared.' },
      },
    },
  })
})

void test('withHelp works on a field without admin settings', () => {
  assert.deepEqual(adminOf(withHelp({ name: 'title', type: 'text' }, 'Main heading.')), {
    components: {
      Label: {
        path: '/core/admin/components/HelpLabel#HelpLabel',
        clientProps: { help: 'Main heading.' },
      },
    },
  })
})
