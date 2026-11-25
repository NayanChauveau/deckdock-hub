'use client'
import { useEffect, useState } from 'react'
import type { Ref } from 'react'
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/core/ui/combobox'
import { Field, FieldError, FieldLabel } from '@/core/ui/field'
import {
  addressDetailsResponseSchema,
  addressSuggestionsSchema,
} from '@/modules/addresses/contracts'
import type { AddressDetails, AddressSuggestion } from '@/modules/addresses/contracts'
import { addressMessages } from '../messages'
import type { Locale } from '@/core/i18n/locales'

interface Props {
  id: string
  name: string
  value: string
  country: string
  locale: Locale
  disabled: boolean
  inputRef: Ref<HTMLInputElement>
  onBlur: () => void
  onChange: (value: string) => void
  /**
   * Called with the picked address; the field already shows `details.address` (the typed line
   * when the place has no house number). An empty postal code or city means "unknown": keep
   * what the customer typed there.
   */
  onSelect: (details: AddressDetails) => void
  error: string
}
interface Result {
  query: string
  country: string
  items: AddressSuggestion[]
  failed: boolean
}

export function AddressField({
  id,
  name,
  value,
  country,
  locale,
  disabled,
  inputRef,
  onBlur,
  onChange,
  onSelect,
  error,
}: Props) {
  const t = addressMessages[locale].addressSearch
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const [accepted, setAccepted] = useState('')
  const [selected, setSelected] = useState<AddressSuggestion | null>(null)
  const [session, setSession] = useState(() => crypto.randomUUID())
  const [result, setResult] = useState<Result | null>(null)
  const eligible = focused && !disabled && value.trim().length >= 3 && value !== accepted
  const current = result?.query === value && result.country === country ? result : null
  const items = eligible ? (current?.items ?? []) : []
  useEffect(() => {
    if (!eligible) return
    const controller = new AbortController()
    let active = true
    const timer = setTimeout(() => {
      async function search() {
        try {
          const response = await fetch('/api/addresses', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: value, country, locale, session }),
            signal: controller.signal,
            cache: 'no-store',
          })
          if (!response.ok) throw new Error('unavailable')
          const data: unknown = await response.json()
          const suggestions = addressSuggestionsSchema.parse(data).suggestions
          if (active) setResult({ query: value, country, items: suggestions, failed: false })
        } catch {
          if (active) setResult({ query: value, country, items: [], failed: true })
        }
      }
      void search()
    }, 400)
    return () => {
      active = false
      clearTimeout(timer)
      controller.abort()
    }
  }, [value, country, locale, eligible, session])
  async function pick(item: AddressSuggestion, picked: string, typed: string) {
    try {
      const response = await fetch('/api/addresses/details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, country, locale, session: picked }),
        cache: 'no-store',
      })
      if (!response.ok) return
      const { address } = addressDetailsResponseSchema.parse(await response.json())
      if (address?.country === country) {
        // A place with no house number would replace "12 rue de la Paix" by "Rue de la Paix".
        const street = address.address.trim() ? address.address : typed
        setAccepted(street)
        onChange(street)
        onSelect({ ...address, address: street })
      }
    } catch {
      // Search is a convenience: the customer keeps what they typed.
    } finally {
      // A session ends with the pick, whatever the outcome.
      setSession(crypto.randomUUID())
      setSelected(null)
    }
  }
  return (
    <Field className="full-width" data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={id}>{addressMessages[locale].address}</FieldLabel>
      <Combobox<AddressSuggestion>
        items={items}
        value={selected}
        inputValue={value}
        filter={null}
        itemToStringLabel={(item) => item.label}
        open={open && items.length > 0}
        onOpenChange={setOpen}
        disabled={disabled}
        onInputValueChange={(text, details) => {
          // The popup also emits input-clear when it unmounts without a selection.
          // Only an explicit edit may change the customer's free-form address.
          if (details.reason === 'input-change' || details.reason === 'clear-press') {
            setAccepted('')
            onChange(text)
            setOpen(true)
          } else details.cancel()
        }}
        onValueChange={(item) => {
          setSelected(item)
          if (!item) return
          setOpen(false)
          // The typed text stays as it is unless the details come back for this country.
          setAccepted(value)
          const picked = session
          void pick(item, picked, value)
        }}
      >
        <ComboboxInput
          id={id}
          name={name}
          ref={inputRef}
          disabled={disabled}
          maxLength={200}
          required
          showTrigger={false}
          autoComplete="off"
          className="h-11"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          onFocus={() => {
            setFocused(true)
            setOpen(true)
          }}
          onBlur={() => {
            setFocused(false)
            onBlur()
          }}
        />
        <ComboboxContent>
          <ComboboxList>
            {(item: AddressSuggestion) => (
              <ComboboxItem key={item.id} value={item}>
                {item.label}
              </ComboboxItem>
            )}
          </ComboboxList>
          <p className="text-muted-foreground px-3 py-1.5 text-right text-xs">{t.poweredBy}</p>
        </ComboboxContent>
      </Combobox>
      <span className="sr-only" role="status">
        {eligible
          ? !current
            ? t.loading
            : current.failed
              ? t.unavailable
              : !items.length
                ? t.empty
                : t.choose
          : ''}
      </span>
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </Field>
  )
}
