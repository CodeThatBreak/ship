import "server-only";

export class RequestBodyTooLargeError extends Error {
  override readonly name = "RequestBodyTooLargeError";

  constructor(maxBytes: number) {
    super(`payload too large (${maxBytes} byte cap)`);
  }
}

/**
 * Read a UTF-8 request body up to `maxBytes`. Rejects on oversized
 * `Content-Length` before streaming, and aborts mid-read if the stream exceeds
 * the cap (byte-accurate, not JS string length).
 */
export const readCappedUtf8Body = async (req: Request, maxBytes: number): Promise<string> => {
  const contentLength = req.headers.get("content-length");
  if (contentLength) {
    const len = Number(contentLength);
    if (!Number.isFinite(len) || len < 0) {
      throw new Error("invalid Content-Length");
    }
    if (len > maxBytes) {
      throw new RequestBodyTooLargeError(maxBytes);
    }
  }

  const stream = req.body;
  if (!stream) return "";

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        throw new RequestBodyTooLargeError(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks).toString("utf8");
};
