export async function executeWithFreshSandboxRecovery<T>(input: {
  attempt(attempt: 1 | 2): Promise<T>;
  recycle(reason: string): Promise<void>;
  isRepairable(error: unknown): boolean;
  isInfrastructureFailure(error: unknown): boolean;
  recoveryReason(error: unknown): string;
  terminalError(error: unknown): unknown;
}): Promise<T> {
  try {
    return await input.attempt(1);
  } catch (error) {
    if (input.isRepairable(error)) throw error;
    if (!input.isInfrastructureFailure(error)) throw input.terminalError(error);
    await input.recycle(input.recoveryReason(error));
  }

  try {
    return await input.attempt(2);
  } catch (error) {
    if (input.isRepairable(error)) throw error;
    throw input.terminalError(error);
  }
}
