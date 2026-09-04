const TIMEOUT_ERROR = 'timeout';

export async function runWithTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(TIMEOUT_ERROR));
    }, timeoutMs);
  });

  let operationPromise: Promise<T>;
  try {
    operationPromise = operation(controller.signal);
  } catch (error) {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    throw error;
  }

  operationPromise = operationPromise.finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });

  operationPromise.catch(() => undefined);

  try {
    return await Promise.race([operationPromise, timeoutPromise]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
