/** Leaves headroom under the 64 KiB frame for the response envelope. */
export const PAGE_BYTES = 40_000;

/** The items from `start` that fit one host frame, always at least one; `tooLarge` stands in for an item over a frame. */
export function page<T>(items: T[], start: number, tooLarge?: (item: T) => T): { items: T[]; more: boolean } {
  const taken: T[] = [];
  let bytes = 0;
  let index = start;
  for (; index < items.length; index++) {
    let item = items[index];
    let size = Buffer.byteLength(JSON.stringify(item));
    if (size > PAGE_BYTES && tooLarge) {
      item = tooLarge(item);
      size = Buffer.byteLength(JSON.stringify(item));
    }
    if (taken.length > 0 && bytes + size > PAGE_BYTES) break;
    taken.push(item);
    bytes += size;
  }
  return { items: taken, more: index < items.length };
}
