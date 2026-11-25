/** Business failures of an order carry a semantic code, never a transport status. */
export class OrderError extends Error {
  constructor(
    public readonly code: string,
    message = code,
  ) {
    super(message)
    this.name = 'OrderError'
  }
}
