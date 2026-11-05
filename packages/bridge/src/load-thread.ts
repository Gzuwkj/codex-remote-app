/** Resolve a desktop owner; ask the existing desktop to open the SAME chat if cold. */
export async function ensureThreadOwner<T>(options: {
  discover: () => Promise<T>;
  open: () => Promise<void>;
  attempts?: number;
  pause?: () => Promise<void>;
}): Promise<T> {
  try { return await options.discover(); }
  catch (error) { if (!(error instanceof Error) || error.message !== "no-client-found") throw error; }
  // A navigation acknowledgement is not proof that the runtime is ready.
  await options.open();
  for (let attempt = 0; attempt < (options.attempts ?? 16); attempt++) {
    try { return await options.discover(); }
    catch (error) { if (!(error instanceof Error) || error.message !== "no-client-found") throw error; }
    await (options.pause?.() ?? new Promise(resolve => setTimeout(resolve, 400)));
  }
  throw Error("DESKTOP_THREAD_LOAD_TIMEOUT");
}
