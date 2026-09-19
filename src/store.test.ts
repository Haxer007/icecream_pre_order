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
  increaseSlots,
  deleteOrder,
  OrderDeletedError,
  readPending,
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

describe("admin inventory and deletion", () => {
  it("reads the original 30-slot schema without a migration", () => {
    const existing = addOrder(emptyStore(), order(2));
    expect(parseStore(existing)).toEqual(existing);
    expect(remaining(parseStore(existing))).toBe(28);
  });
  it("adds slots without resetting existing reservations", async () => {
    const existing = addOrder(emptyStore(), order(3));
    mockDatabase(existing);
    const next = await increaseSlots({ id: "more-1", quantity: 10 });
    expect(next.capacity).toBe(40);
    expect(remaining(next)).toBe(37);
    expect(next.orders).toEqual(existing.orders);
    expect(parseStore(next)).toEqual(next);
  });
  it("initializes a new database when the admin adds the first slots", async () => {
    mockDatabase();
    const next = await increaseSlots({ id: "more-1", quantity: 5 });
    expect(next.capacity).toBe(35);
    expect(remaining(next)).toBe(35);
  });
  it("applies an uncertain slot addition only once", async () => {
    mockDatabase();
    const addition = { id: "more-1", quantity: 5 };
    await increaseSlots(addition);
    const retry = await increaseSlots(addition);
    expect(retry.capacity).toBe(35);
    expect(retry.slotAdditions).toEqual({ "more-1": 5 });
  });
  it.each([0, -1, 1.5, 1001, NaN])(
    "rejects invalid slot addition %s",
    async (quantity) => {
      const db = mockDatabase();
      await expect(increaseSlots({ id: "more-1", quantity })).rejects.toThrow(
        "whole number",
      );
      expect(db.fetcher).not.toHaveBeenCalled();
    },
  );
  it("supports reservations above 30 after stock is increased", async () => {
    mockDatabase();
    const expanded = await increaseSlots({ id: "more-1", quantity: 10 });
    const next = addOrder(expanded, order(35));
    expect(remaining(next)).toBe(5);
    expect(parseStore(next).orders["order-1"].quantity).toBe(35);
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify(order(35)) });
    expect(readPending()?.quantity).toBe(35);
  });
  it("deletes a waiting order and releases its quantity exactly once", async () => {
    mockDatabase(addOrder(emptyStore(), order(3)));
    const deleted = await deleteOrder("order-1");
    expect(deleted.orders).toEqual({});
    expect(remaining(deleted)).toBe(30);
    expect(remaining(await deleteOrder("order-1"))).toBe(30);
    expect(JSON.stringify(deleted)).not.toContain("Grace");
    expect(() => addOrder(deleted, order(3))).toThrow(OrderDeletedError);
  });
  it("keeps served quantities consumed when the order is deleted", async () => {
    mockDatabase(addOrder(emptyStore(), { ...order(3), served: true }));
    const deleted = await deleteOrder("order-1");
    expect(deleted.orders).toEqual({});
    expect(deleted.deletedServedQuantity).toBe(3);
    expect(remaining(deleted)).toBe(27);
    expect((await deleteOrder("order-1")).deletedServedQuantity).toBe(3);
    expect(remaining(await increaseSlots({ id: "more-1", quantity: 5 }))).toBe(
      32,
    );
  });
  it("safely handles simultaneous restocks, new orders, and deletion", async () => {
    const db = mockDatabase(addOrder(emptyStore(), order(2, "old")));
    await Promise.all([
      increaseSlots({ id: "more-1", quantity: 5 }),
      increaseSlots({ id: "more-2", quantity: 3 }),
      reserve(order(4, "new")),
      deleteOrder("old"),
    ]);
    expect(db.read()!.capacity).toBe(38);
    expect(remaining(db.read()!)).toBe(34);
    expect(Object.keys(db.read()!.orders)).toEqual(["new"]);
    expect(db.read()!.deletedOrderIds).toEqual({ old: true });
  });
  it("rejects malformed inventory history before writing", () => {
    expect(() => parseStore({ ...emptyStore(), capacity: -1 })).toThrow();
    expect(() =>
      parseStore({ ...emptyStore(), deletedServedQuantity: -1 }),
    ).toThrow();
    expect(() =>
      parseStore({ ...emptyStore(), deletedOrderIds: { old: "yes" } }),
    ).toThrow();
    expect(() =>
      parseStore({ ...emptyStore(), slotAdditions: { more: 0 } }),
    ).toThrow();
  });
});
