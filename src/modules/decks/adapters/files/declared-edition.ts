/** A malformed text: the scan stops, and the edition is unknown. */
class Malformed extends Error {}

/**
 * `deck.edition` of a deck.json text, read without building the document: a single forward scan
 * that only decodes the top-level keys, the keys of `deck` and the edition string. The checker
 * reads the file first, and the hub parses it only once the checker has accepted it, so that two
 * copies of a large document are never held at once. `undefined` when the text is not a JSON
 * object, `deck` is not an object, or it has no string `edition` (the last key wins, as in
 * JSON.parse and Python's json).
 */
export function declaredEdition(text: string): string | undefined {
  let i = 0
  const n = text.length
  const spaces = () => {
    for (;;) {
      const code = text.charCodeAt(i)
      if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) i++
      else return
    }
  }
  /** Moves past a string starting at `i`; returns where its closing quote is. */
  const skipString = (): number => {
    const start = i
    i++
    while (i < n) {
      const code = text.charCodeAt(i)
      if (code === 0x5c) i += 2
      else if (code === 0x22) return i++
      else i++
    }
    throw new Malformed(`unterminated string at ${start}`)
  }
  const readString = (): string => {
    const start = i
    const end = skipString()
    const value: unknown = JSON.parse(text.slice(start, end + 1))
    if (typeof value !== 'string') throw new Malformed('not a string')
    return value
  }
  const skipValue = () => {
    spaces()
    const char = text[i]
    if (char === '"') {
      skipString()
      return
    }
    if (char === '{' || char === '[') {
      let depth = 0
      while (i < n) {
        const c = text[i]
        if (c === '"') {
          skipString()
          continue
        }
        if (c === '{' || c === '[') depth++
        else if (c === '}' || c === ']') {
          depth--
          if (depth === 0) {
            i++
            return
          }
        }
        i++
      }
      throw new Malformed('unterminated container')
    }
    // A number, true, false or null: up to the next delimiter.
    const start = i
    while (i < n && !',}] \t\n\r'.includes(text[i] ?? '')) i++
    if (i === start) throw new Malformed(`no value at ${start}`)
  }
  /** The members of the object at `i`; `visit` consumes each value. */
  const members = (visit: (key: string) => void) => {
    if (text[i] !== '{') throw new Malformed('not an object')
    i++
    spaces()
    if (text[i] === '}') {
      i++
      return
    }
    for (;;) {
      spaces()
      if (text[i] !== '"') throw new Malformed('no key')
      const key = readString()
      spaces()
      if (text[i] !== ':') throw new Malformed('no colon')
      i++
      spaces()
      visit(key)
      spaces()
      if (text[i] === ',') i++
      else if (text[i] === '}') {
        i++
        return
      } else throw new Malformed('no separator')
    }
  }

  try {
    let edition: string | undefined
    spaces()
    members((key) => {
      if (key !== 'deck') {
        skipValue()
        return
      }
      edition = undefined
      if (text[i] !== '{') {
        skipValue()
        return
      }
      members((inner) => {
        if (inner === 'edition' && text[i] === '"') edition = readString()
        else {
          if (inner === 'edition') edition = undefined
          skipValue()
        }
      })
    })
    return edition
  } catch (error) {
    if (error instanceof Malformed || error instanceof SyntaxError) return undefined
    throw error
  }
}
