export function compactSessionId(id: string): string {
  if (id.length <= 13) {
    return id
  }
  return `${id.slice(0, 8)}…${id.slice(-4)}`
}
