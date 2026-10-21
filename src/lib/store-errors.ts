export class StoreReadError extends Error {
  readonly code: "blob_unavailable" | "store_read_failed";

  constructor(code: StoreReadError["code"], message: string) {
    super(message);
    this.name = "StoreReadError";
    this.code = code;
  }
}

export function isStoreReadError(error: unknown): error is StoreReadError {
  return error instanceof StoreReadError;
}
