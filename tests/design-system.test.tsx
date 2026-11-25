import './support/dom'
import assert from 'node:assert/strict'
import Link from 'next/link'
import { afterEach, test } from 'node:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react/pure'
import { Button } from '../src/core/ui/button'
import { TextField } from '../src/core/ui/forms/TextField'
import { Notice } from '../src/core/ui/feedback/Notice'
import { cn } from '../src/core/ui/utils'

afterEach(cleanup)

void test('shared button forwards native disabled behavior and renders a link without a nested button', () => {
  let clicks = 0
  const view = render(
    <Button
      type="button"
      disabled
      onClick={() => {
        clicks++
      }}
    >
      Payer
    </Button>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Payer' }))
  assert.equal(clicks, 0)
  view.rerender(
    <Button asChild>
      <Link href="/fr/commande">Commander</Link>
    </Button>,
  )
  assert.equal(screen.queryByRole('button'), null)
  assert.equal(screen.getByRole('link', { name: 'Commander' }).getAttribute('href'), '/fr/commande')
})

void test('text field associates label, descriptions and validation errors while preserving native attributes', () => {
  const view = render(
    <TextField
      id="email"
      name="email"
      type="email"
      label="Email"
      description="Votre adresse personnelle"
      aria-describedby="external-help"
      required
    />,
  )
  const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Email' })
  assert.equal(input.required, true)
  assert.equal(input.name, 'email')
  assert.equal(input.getAttribute('aria-describedby'), 'external-help email-description')
  view.rerender(
    <TextField id="email" name="email" label="Email" error="Adresse invalide" disabled />,
  )
  assert.equal(screen.getByRole('alert').id, 'email-error')
  assert.equal(input.getAttribute('aria-invalid'), 'true')
  assert.equal(input.getAttribute('aria-describedby'), 'email-error')
  assert.equal(input.disabled, true)
  view.rerender(<TextField id="email" label="Email" />)
  assert.equal(input.getAttribute('aria-invalid'), null)
  assert.equal(input.getAttribute('aria-describedby'), null)
  assert.equal(screen.queryByRole('alert'), null)
})

void test('notice exposes information as status and errors as alerts', () => {
  const view = render(<Notice>Paiement en attente</Notice>)
  assert.equal(screen.getByRole('status').textContent, 'Paiement en attente')
  view.rerender(<Notice tone="error">Échec du paiement</Notice>)
  assert.equal(screen.getByRole('alert').textContent, 'Échec du paiement')
  assert.equal(screen.queryByRole('status'), null)
})

void test('class overrides resolve conflicting utilities predictably', () => {
  const result = cn('px-2 bg-primary', false, undefined, 'px-4 bg-secondary').split(' ')
  assert.ok(result.includes('px-4'))
  assert.ok(result.includes('bg-secondary'))
  assert.ok(!result.includes('px-2'))
  assert.ok(!result.includes('bg-primary'))
})
