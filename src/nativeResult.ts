/** Shared native-plugin result helpers — keep wrappers thin and consistent. */

export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function wrapOk(
  run: () => Promise<void>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await run()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errMsg(err) }
  }
}
