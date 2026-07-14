/** Serialize the short browser-local mutation windows shared by view navigation
 * and relay commits. Artifact module preparation deliberately stays outside
 * this gate because trusted modules may take an unbounded time to evaluate. */
export class AsyncMutationGate {
  private tail: Promise<void> = Promise.resolve();

  runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.catch(() => undefined).then(operation);
    const nextTail = result.then(() => undefined, () => undefined);
    this.tail = nextTail;
    return result;
  }
}
