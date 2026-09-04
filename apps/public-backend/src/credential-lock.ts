export type CredentialLock = <T>(
  publicId: string,
  operation: () => Promise<T>
) => Promise<T>;

export function createCredentialLock(): CredentialLock {
  const locks = new Map<string, Promise<void>>();
  return async <T>(publicId: string, operation: () => Promise<T>): Promise<T> => {
    const previous = locks.get(publicId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    locks.set(publicId, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (locks.get(publicId) === current) locks.delete(publicId);
    }
  };
}
