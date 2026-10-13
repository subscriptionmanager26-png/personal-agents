/** Vercel rejects request bodies over 4.5 MB, so uploads stay under that. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_ATTACHMENTS = 5;
export const ACCEPTED_EXTENSIONS = [".pdf", ".csv", ".xlsx", ".xls"];
export const ACCEPTED_FILE_TYPES = ACCEPTED_EXTENSIONS.join(",");

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
