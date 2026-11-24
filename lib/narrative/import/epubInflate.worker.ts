import { Inflate } from 'fflate';

interface StartMessage {
  type: 'start';
  maxOutputBytes: number;
  compressedBytes: number;
  maxCompressionRatio: number;
  outputChunkBytes: number;
  maxOutputBurstBytes: number;
}
interface ChunkMessage { type: 'chunk'; sequence: number; bytes: ArrayBuffer; final: boolean }
type WorkerInput = StartMessage | ChunkMessage;
interface InflateWorkerScope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const workerScope = self as unknown as InflateWorkerScope;
let inflate: Inflate | undefined;
let outputBytes = 0;
let outputLimit = 0;
let compressedBytes = 0;
let compressionRatioLimit = 0;
let outputChunkBytes = 0;
let maxOutputBurstBytes = 0;
let failed = false;

function fail(message: string): void {
  if (failed) return;
  failed = true;
  workerScope.postMessage({ type: 'error', message });
}

workerScope.onmessage = (event: MessageEvent) => {
  const message = event.data as WorkerInput;
  if (message.type === 'start') {
    if (inflate || failed) { fail('EPUB inflate worker received an invalid start request.'); return; }
    outputLimit = message.maxOutputBytes;
    compressedBytes = message.compressedBytes;
    compressionRatioLimit = message.maxCompressionRatio;
    outputChunkBytes = message.outputChunkBytes;
    maxOutputBurstBytes = message.maxOutputBurstBytes;
    inflate = new Inflate({}, (chunk, final) => {
      if (failed) return;
      if (chunk.byteLength > maxOutputBurstBytes) {
        fail('EPUB DEFLATE output burst exceeded its analyzed per-input transient bound.');
        throw new Error('EPUB DEFLATE output burst bound exceeded.');
      }
      if (outputBytes + chunk.byteLength > outputLimit || (outputBytes + chunk.byteLength) / compressedBytes > compressionRatioLimit) {
        fail('EPUB DEFLATE output exceeded its actual member or compression-ratio limit.');
        throw new Error('EPUB DEFLATE output limit exceeded.');
      }
      outputBytes += chunk.byteLength;
      for (let offset = 0; offset < chunk.byteLength; offset += outputChunkBytes) {
        const part = chunk.subarray(offset, Math.min(chunk.byteLength, offset + outputChunkBytes)).slice();
        workerScope.postMessage({ type: 'data', bytes: part.buffer }, [part.buffer]);
      }
      if (final) workerScope.postMessage({ type: 'done', outputBytes });
    });
    return;
  }
  if (message.type !== 'chunk' || !inflate || failed) { fail('EPUB inflate worker received an invalid input chunk.'); return; }
  try {
    inflate.push(new Uint8Array(message.bytes), message.final);
    workerScope.postMessage({ type: 'ack', sequence: message.sequence });
  } catch (error) {
    fail(error instanceof Error ? `EPUB DEFLATE failed: ${error.message}` : 'EPUB DEFLATE failed.');
  }
};

workerScope.postMessage({ type: 'ready' });
