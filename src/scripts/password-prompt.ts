import { emitKeypressEvents } from 'node:readline'
import { stdin, stdout } from 'node:process'

export function password(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    stdout.write(prompt)
    emitKeypressEvents(stdin)
    stdin.setRawMode(true)
    stdin.resume()
    let value = ''
    const finish = () => {
      stdin.off('keypress', onKey)
      stdin.setRawMode(false)
      stdin.pause()
      stdout.write('\n')
    }
    const onKey = (
      text: string | undefined,
      key: { name?: string; ctrl?: boolean; meta?: boolean },
    ) => {
      if (key.ctrl && key.name === 'c') {
        finish()
        reject(new Error('Opération annulée.'))
        return
      }
      if (key.name === 'return' || key.name === 'enter') {
        finish()
        resolve(value)
        return
      }
      if (key.name === 'backspace') {
        value = value.slice(0, -1)
        return
      }
      if (text && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(text)) value += text
    }
    stdin.on('keypress', onKey)
  })
}
