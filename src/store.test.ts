import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CAPACITY,
  ENDPOINT,
  StockError,
  addOrder,
  emptyStore,
  parseStore,
  remaining,
  reserve,
  setServed,
  type Order,
  type Store,
} from "./store";

const order = (quantity = 1, id = "order-1"): Order => ({
  id,
  clientId: "browser-1",
  name: "Grace",
  verse: "ಪ್ರೀತಿಯಲ್ಲಿ ಎಲ್ಲವನ್ನೂ ಮಾಡಿರಿ. — 1 Corinthians 16:14",
  quantity,
  createdAt: 100,
  served: false,
});
function mockDatabase(initial: Store | null = null) {
  let database = initial;
  let version = 0;
  const fetcher = vi.fn(async (url: string, options: RequestInit = {}) => {
    expect(url).toBe(ENDPOINT);
    if (options.method === "PUT") {
      if (
        (options.headers as Record<string, string>)["If-Match"] !==
        `"${version}"`
      )
        return new Response(JSON.stringify(database), { status: 412 });
      database = JSON.parse(options.body as string);
      version++;
      return new Response(JSON.stringify(database));
    }
    return new Response(JSON.stringify(database), {
      headers: { ETag: `"${version}"` },
    });
  });
  vi.stubGlobal("fetch", fetcher);
  return { fetcher, read: () => database };
}
afterEach(() => vi.unstubAllGlobals());

describe("stock and data safety", () => {
  it("starts with exactly 30 scoops and no orders", () => {
    expect(remaining(parseStore(null))).toBe(CAPACITY);
    expect(parseStore(null).orders).toEqual({});
  });
  it("reserves the selected quantity and preserves multilingual verses", () => {
    const next = addOrder(emptyStore(), order(3));
    expect(remaining(next)).toBe(27);
    expect(next.orders["order-1"].verse).toContain("ಪ್ರೀತಿಯಲ್ಲಿ");
  });
  it("allows repeat requests as new reservations", () => {
    const first = addOrder(emptyStore(), order());
    expect(remaining(addOrder(first, order(2, "order-2")))).toBe(27);
  });
  it("is idempotent when retrying an uncertain submission", () => {
    const first = addOrder(emptyStore(), order(2));
    expect(addOrder(first, order(2))).toBe(first);
    expect(remaining(first)).toBe(28);
  });
  it("rejects excess quantities and sold-out submissions", () => {
    const full = addOrder(emptyStore(), order(30));
    expect(() => addOrder(full, order(1, "order-2"))).toThrow(StockError);
    const nearlyFull = addOrder(emptyStore(), order(29));
    expect(() => addOrder(nearlyFull, order(2, "order-2"))).toThrow(
      "Only 1 ice cream is left",
    );
  });
  it.each([0, -1, 1.5, 31])("rejects invalid quantity %s", (quantity) => {
    expect(() => addOrder(emptyStore(), order(quantity))).toThrow();
  });
  it("rejects whitespace-only required fields", () => {
    expect(() => addOrder(emptyStore(), { ...order(), name: "  " })).toThrow();
    expect(() => addOrder(emptyStore(), { ...order(), verse: "  " })).toThrow();
  });
  it("refuses to overwrite unrelated or malformed data", () => {
    expect(() => parseStore({ existing: "do not overwrite" })).toThrow(
      "unexpected format",
    );
    expect(() =>
      parseStore({ version: 1, capacity: 30, orders: { wrong: order() } }),
    ).toThrow("unexpected format");
    expect(() => parseStore({ version: 1, capacity: 30, orders: [] })).toThrow(
      "unexpected format",
    );
  });
});

describe("Firebase atomic transactions", () => {
  it("creates only the dedicated node on first reservation", async () => {
    const mock = mockDatabase();
    const next = await reserve(order());
    expect(remaining(next)).toBe(29);
    expect(mock.read()?.orders["order-1"]).toEqual(order());
    expect(mock.fetcher).toHaveBeenCalledTimes(2);
  });
  it("prevents two customers from both buying the last scoop", async () => {
    const initial = addOrder(emptyStore(), order(29, "previous-order"));
    const mock = mockDatabase(initial);
    const results = await Promise.allSettled([
      reserve(order(1, "last-a")),
      reserve(order(1, "last-b")),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(remaining(mock.read()!)).toBe(0);
    expect(Object.keys(mock.read()!.orders)).toHaveLength(2);
  });
  it("marks served and waiting without putting scoops back in stock", async () => {
    mockDatabase(addOrder(emptyStore(), order(3)));
    let next = await setServed("order-1", true);
    expect(next.orders["order-1"].served).toBe(true);
    expect(next.orders["order-1"].servedAt).toBeTypeOf("number");
    expect(remaining(next)).toBe(27);
    next = await setServed("order-1", false);
    expect(next.orders["order-1"].served).toBe(false);
    expect(remaining(next)).toBe(27);
  });
  it("handles permissions failures without writing", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response('{"error":"Permission denied"}', { status: 401 }),
      );
    vi.stubGlobal("fetch", fetcher);
    await expect(reserve(order())).rejects.toThrow(
      "Database access is unavailable",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("never writes if the database does not supply an ETag", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("null"));
    vi.stubGlobal("fetch", fetcher);
    await expect(reserve(order())).rejects.toThrow("safely check stock");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
