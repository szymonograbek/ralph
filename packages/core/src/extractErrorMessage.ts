/** Type-safe error-to-string narrowing. Handles Error, {message}, {_tag}, and fallback. */
export const extractErrorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message
  if (typeof err === "object" && err !== null) {
    if ("message" in err && typeof (err as Record<string, unknown>).message === "string")
      return (err as Record<string, unknown>).message as string
    if ("_tag" in err)
      return String((err as Record<string, unknown>)._tag)
  }
  return String(err)
}
