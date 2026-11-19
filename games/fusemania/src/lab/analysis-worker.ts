/** A request owns its worker until it replies, fails, or the caller cancels. */
export function analyseInWorker<Reply, Result>(options: {
  create: () => Worker;
  signal: AbortSignal;
  request: object;
  transfer: Transferable[];
  read: (reply: Reply) => Result | undefined;
  failure: (event: ErrorEvent) => string;
}): Promise<Result> {
  return new Promise((resolve, reject) => {
    const { create, signal, request, transfer, read, failure } = options;
    signal.throwIfAborted();
    const worker = create();
    const close = () => {
      signal.removeEventListener("abort", abort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    };
    const fail = (error: unknown) => {
      close();
      reject(error);
    };
    const abort = () => fail(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<Reply>) => {
      try {
        const result = read(data);
        if (result === undefined) return;
        close();
        resolve(result);
      } catch (error) {
        fail(error);
      }
    };
    worker.onerror = (event) => fail(new Error(failure(event)));
    try {
      worker.postMessage(request, transfer);
    } catch (error) {
      fail(error);
    }
  });
}
