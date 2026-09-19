export const DATABASE_URL =
  "https://church-calender-prayers-default-rtdb.firebaseio.com";
export const DATA_PATH = "church/icecreamPreorders_v1";
export const ENDPOINT = `${DATABASE_URL}/${DATA_PATH}.json`;
export const CAPACITY = 30;
const CACHE_KEY = "scoops-scripture:cache:v1";
const CLIENT_KEY = "scoops-scripture:client:v1";
const PENDING_KEY = "scoops-scripture:pending:v1";
const PENDING_SLOTS_KEY = "scoops-scripture:pending-slots:v1";

export type Order = {
  id: string;
  clientId: string;
  name: string;
  verse: string;
  quantity: number;
  createdAt: number;
  served: boolean;
  servedAt?: number | null;
};
export type Store = {
  version: 1;
  capacity: number;
  orders: Record<string, Order>;
  deletedOrderIds?: Record<string, true>;
  deletedServedQuantity?: number;
  slotAdditions?: Record<string, number>;
};
export type SlotAddition = { id: string; quantity: number };
export const emptyStore = (): Store => ({
  version: 1,
  capacity: 30,
  orders: {},
});

export function parseStore(value: unknown): Store {
  if (value === null) return emptyStore();
  const data = value as Store;
  if (
    !data ||
    data.version !== 1 ||
    !Number.isSafeInteger(data.capacity) ||
    data.capacity < 1 ||
    (data.orders != null &&
      (typeof data.orders !== "object" || Array.isArray(data.orders)))
  ) {
    throw new Error(
      "The order database has an unexpected format. Please contact the serving team.",
    );
  }
  if (
    (data.deletedServedQuantity != null &&
      (!Number.isSafeInteger(data.deletedServedQuantity) ||
        data.deletedServedQuantity < 0 ||
        data.deletedServedQuantity > data.capacity)) ||
    (data.deletedOrderIds != null &&
      (typeof data.deletedOrderIds !== "object" ||
        Array.isArray(data.deletedOrderIds) ||
        Object.values(data.deletedOrderIds).some((value) => value !== true))) ||
    (data.slotAdditions != null &&
      (typeof data.slotAdditions !== "object" ||
        Array.isArray(data.slotAdditions) ||
        Object.values(data.slotAdditions).some(
          (value) => !Number.isSafeInteger(value) || value < 1,
        )))
  )
    throw new Error(
      "The inventory history has an unexpected format. Please contact the serving team.",
    );
  const orders = data.orders || {};
  for (const [key, order] of Object.entries(orders)) {
    if (
      !order ||
      order.id !== key ||
      typeof order.clientId !== "string" ||
      typeof order.name !== "string" ||
      typeof order.verse !== "string" ||
      !Number.isSafeInteger(order.quantity) ||
      order.quantity < 1 ||
      order.quantity > data.capacity ||
      typeof order.createdAt !== "number" ||
      typeof order.served !== "boolean"
    ) {
      throw new Error(
        "An order has an unexpected format. Please contact the serving team.",
      );
    }
  }
  return { ...data, orders };
}

export function remaining(data: Store): number {
  return Math.max(
    0,
    data.capacity -
      (data.deletedServedQuantity || 0) -
      Object.values(data.orders).reduce(
        (sum, order) => sum + order.quantity,
        0,
      ),
  );
}

export function safeSave(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Firebase remains the source of truth if storage is unavailable. */
  }
}
export function readCache(): Store | null {
  try {
    const value = localStorage.getItem(CACHE_KEY);
    return value ? parseStore(JSON.parse(value)) : null;
  } catch {
    return null;
  }
}
export function saveCache(data: Store): void {
  safeSave(CACHE_KEY, data);
}
export function clientId(): string {
  try {
    const saved = localStorage.getItem(CLIENT_KEY);
    if (saved) return saved;
    const id = crypto.randomUUID();
    localStorage.setItem(CLIENT_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}
export function readPending(): Order | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const order = JSON.parse(raw) as Order;
    parseStore({
      version: 1,
      capacity: Math.max(CAPACITY, order.quantity),
      orders: { [order.id]: order },
    });
    return order;
  } catch {
    return null;
  }
}
export function savePending(order: Order | null): void {
  if (order) safeSave(PENDING_KEY, order);
  else {
    try {
      localStorage.removeItem(PENDING_KEY);
    } catch {
      /* Storage may be disabled. */
    }
  }
}

async function request(options: RequestInit = {}): Promise<Response> {
  const response = await fetch(ENDPOINT, {
    ...options,
    signal: AbortSignal.timeout(12000),
    cache: "no-store",
  });
  if (!response.ok && response.status !== 412) {
    throw new Error(
      response.status === 401 || response.status === 403
        ? "Database access is unavailable. Please let the serving team know."
        : "Could not connect to the order database. Please try again.",
    );
  }
  return response;
}

export async function loadStore(): Promise<Store> {
  return parseStore(await (await request()).json());
}

// Firebase REST conditional writes are atomic. Every retry reads the latest stock.
// Only this dedicated app node is touched; other church data is never written.
export async function transact(update: (data: Store) => Store): Promise<Store> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const read = await request({ headers: { "X-Firebase-ETag": "true" } });
    const etag = read.headers.get("ETag");
    if (!etag)
      throw new Error("Could not safely check stock. Please try again.");
    const next = update(parseStore(await read.json()));
    const write = await request({
      method: "PUT",
      headers: { "Content-Type": "application/json", "If-Match": etag },
      body: JSON.stringify(next),
    });
    if (write.status !== 412) return next;
    await new Promise((resolve) =>
      setTimeout(resolve, 60 + Math.random() * 150),
    );
  }
  throw new Error(
    "Several people are ordering right now. Please retry your reservation.",
  );
}
export class StockError extends Error {}
export class OrderDeletedError extends Error {}
export class SlotValidationError extends Error {}
export function addOrder(data: Store, order: Order): Store {
  // A retry after a lost network response cannot reserve the same order twice.
  if (data.deletedOrderIds?.[order.id])
    throw new OrderDeletedError(
      "This reservation was deleted by the serving team. Please speak to them or place a new reservation.",
    );
  if (data.orders[order.id]) return data;
  if (
    !order.name.trim() ||
    order.name.length > 80 ||
    !order.verse.trim() ||
    order.verse.length > 1500 ||
    !Number.isSafeInteger(order.quantity) ||
    order.quantity < 1 ||
    order.quantity > data.capacity
  ) {
    throw new Error(
      "Please enter your name, a Bible verse, and a valid quantity.",
    );
  }
  const available = remaining(data);
  if (order.quantity > available)
    throw new StockError(
      available === 0
        ? `All ${data.capacity} ice creams have been reserved or served. Thank you for the love!`
        : `Only ${available} ice cream${available === 1 ? " is" : "s are"} left. Please adjust your quantity.`,
    );
  return { ...data, orders: { ...data.orders, [order.id]: order } };
}
export async function reserve(order: Order): Promise<Store> {
  return transact((data) => addOrder(data, order));
}
export async function setServed(id: string, served: boolean): Promise<Store> {
  return transact((data) => {
    if (!data.orders[id])
      throw new Error("This order could not be found. Refresh and try again.");
    return {
      ...data,
      orders: {
        ...data.orders,
        [id]: {
          ...data.orders[id],
          served,
          servedAt: served ? Date.now() : null,
        },
      },
    };
  });
}

// Keep only an anonymous deletion marker so a guest retry cannot resurrect an order.
export async function deleteOrder(id: string): Promise<Store> {
  return transact((data) => {
    const order = data.orders[id];
    if (!order) return data;
    const orders = { ...data.orders };
    delete orders[id];
    return {
      ...data,
      orders,
      deletedOrderIds: { ...data.deletedOrderIds, [id]: true },
      deletedServedQuantity:
        (data.deletedServedQuantity || 0) + (order.served ? order.quantity : 0),
    };
  });
}

export async function increaseSlots(addition: SlotAddition): Promise<Store> {
  if (
    !addition.id ||
    !Number.isSafeInteger(addition.quantity) ||
    addition.quantity < 1 ||
    addition.quantity > 1000
  ) {
    throw new SlotValidationError(
      "Enter a whole number from 1 to 1,000 slots.",
    );
  }
  return transact((data) => {
    if (data.slotAdditions?.[addition.id]) return data;
    if (!Number.isSafeInteger(data.capacity + addition.quantity))
      throw new SlotValidationError("The total slot count is too large.");
    return {
      ...data,
      capacity: data.capacity + addition.quantity,
      slotAdditions: {
        ...data.slotAdditions,
        [addition.id]: addition.quantity,
      },
    };
  });
}

export function readPendingSlots(): SlotAddition | null {
  try {
    const raw = localStorage.getItem(PENDING_SLOTS_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as SlotAddition;
    return typeof value.id === "string" &&
      value.id &&
      Number.isSafeInteger(value.quantity) &&
      value.quantity >= 1 &&
      value.quantity <= 1000
      ? value
      : null;
  } catch {
    return null;
  }
}
export function savePendingSlots(value: SlotAddition | null): void {
  if (value) safeSave(PENDING_SLOTS_KEY, value);
  else {
    try {
      localStorage.removeItem(PENDING_SLOTS_KEY);
    } catch {
      /* Storage may be unavailable. */
    }
  }
}
