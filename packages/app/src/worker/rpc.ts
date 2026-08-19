// Main-thread side of the worker boundary: a tiny promise-based RPC over
// postMessage, matching engineWorker.ts's { id, type, payload } / { id, ok,
// result | error } protocol.

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./engineWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent) => {
      const { id, ok, result, error } = ev.data as { id: number; ok: boolean; result?: unknown; error?: string };
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (ok) entry.resolve(result);
      else entry.reject(new Error(error));
    };
  }
  return worker;
}

export function callWorker<TResult>(type: string, payload: unknown): Promise<TResult> {
  const w = getWorker();
  const id = nextId++;
  return new Promise<TResult>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w.postMessage({ id, type, payload });
  });
}
