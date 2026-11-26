import './support/dom'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react/pure'
import { CopyField } from '../src/modules/decks/ui/components/CopyField'
import { DeckIcon, initialColor, INITIAL_COLORS } from '../src/modules/decks/ui/components/DeckIcon'
import { StatusBadge } from '../src/modules/decks/ui/components/StatusBadge'

afterEach(() => {
  cleanup()
})

void test('initialColor is stable and spreads ids over the 8 tokens', () => {
  assert.equal(INITIAL_COLORS, 8)
  assert.equal(initialColor('verbs'), initialColor('verbs'))
  const ids = Array.from({ length: 64 }, (_, i) => `deck-${i}`)
  const colors = new Set(ids.map(initialColor))
  assert.ok(colors.size >= 6, `only ${colors.size} colours used`)
  for (const color of colors) assert.match(color, /^var\(--initial-[1-8]\)$/)
})

void test('DeckIcon shows the emoji when there is one, else the first letter of the name', () => {
  const { container, rerender } = render(<DeckIcon icon="📘" name="Verbs" deckId="verbs" />)
  assert.equal(container.textContent, '📘')
  rerender(<DeckIcon icon={null} name="écologie" deckId="eco" />)
  assert.equal(container.textContent, 'É')
  // The emoji of a name is a grapheme too, and an empty icon counts as none.
  rerender(<DeckIcon icon="" name="👩‍🔬 Science" deckId="sci" />)
  assert.equal(container.textContent, '👩‍🔬')
  rerender(<DeckIcon name="  " deckId="x" />)
  assert.equal(container.textContent, '?')
  // Decorative: the name is always next to it.
  assert.equal(container.firstElementChild?.getAttribute('aria-hidden'), 'true')
})

void test('the initial sits on the colour taken from the deck id', () => {
  const { container } = render(<DeckIcon name="Verbs" deckId="verbs" size="lg" />)
  const tile = container.firstElementChild as HTMLElement
  assert.ok(tile.getAttribute('style')?.includes(initialColor('verbs')))
})

void test('CopyField shows the value in mono, copies it and says so politely', async () => {
  const copied: string[] = []
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        copied.push(text)
      },
    },
  })
  render(
    <CopyField
      label="Address"
      value="https://hub.test/d/a/b/en/"
      testId="addr"
      copy="Copy"
      copied="Copied"
      failed="Copy by hand"
    />,
  )
  assert.equal(screen.getByTestId('addr').textContent, 'https://hub.test/d/a/b/en/')
  fireEvent.click(screen.getByRole('button', { name: /Copy/ }))
  await waitFor(() => {
    assert.equal(screen.getByRole('status').textContent, 'Copied')
  })
  assert.deepEqual(copied, ['https://hub.test/d/a/b/en/'])
  assert.equal(screen.getByRole('status').getAttribute('aria-live'), 'polite')
})

void test('StatusBadge names each status', () => {
  for (const [status, label] of [
    ['approved', 'Approved'],
    ['pending', 'Pending'],
    ['hidden', 'Hidden'],
  ] as const) {
    const { container, unmount } = render(<StatusBadge status={status} label={label} />)
    assert.equal(container.textContent, label)
    unmount()
  }
})

void test('StatusBadge shows the reason of a hidden deck, and only of a hidden one', () => {
  const hidden = render(
    <StatusBadge
      status="hidden"
      label="Masqué"
      reason="Contenu en double"
      reasonLabel="Motif :"
      testId="s"
    />,
  )
  assert.equal(screen.getByTestId('s').textContent, 'Masqué')
  assert.ok(hidden.container.textContent.includes('Motif : Contenu en double'))
  hidden.unmount()
  const approved = render(<StatusBadge status="approved" label="Publié" reason="ignored" />)
  assert.equal(approved.container.textContent, 'Publié')
})
