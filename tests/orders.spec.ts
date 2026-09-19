import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import type { Store } from "../src/store";

// All browser tests intercept this exact URL. No test writes reach Firebase.
const endpoint =
  "https://church-calender-prayers-default-rtdb.firebaseio.com/church/icecreamPreorders_v1.json";
async function mockDatabase(
  context: BrowserContext,
  initial: Store | null = null,
) {
  let data = initial;
  let version = 0;
  let loseNextWrite = false;
  await context.addInitScript(() => {
    const sources: EventTarget[] = [];
    (window as any).__emitRealtime = () =>
      sources.forEach((source) => source.dispatchEvent(new Event("put")));
    (window as any).EventSource = class extends EventTarget {
      constructor() {
        super();
        sources.push(this);
      }
      close() {
        const i = sources.indexOf(this);
        if (i >= 0) sources.splice(i, 1);
      }
    };
  });
  await context.route(endpoint, async (route) => {
    const request = route.request();
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "ETag",
      ETag: `"${version}"`,
    };
    if (request.method() === "OPTIONS")
      return route.fulfill({
        status: 204,
        headers: {
          ...headers,
          "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
          "Access-Control-Allow-Headers": "*",
        },
      });
    if (request.method() === "PUT") {
      if (request.headers()["if-match"] !== `"${version}"`)
        return route.fulfill({ status: 412, json: data, headers });
      data = request.postDataJSON();
      version++;
      if (loseNextWrite) {
        loseNextWrite = false;
        return route.abort("failed");
      }
    }
    await route.fulfill({ json: data, headers });
  });
  return {
    read: () => data,
    loseWriteResponse: () => {
      loseNextWrite = true;
    },
    update: (next: Store) => {
      data = next;
      version++;
    },
  };
}
async function order(
  page: Page,
  name = "Grace",
  verse = "Let all that you do be done in love. — 1 Corinthians 16:14",
) {
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("A Bible verse you love").fill(verse);
  await page.getByRole("button", { name: "Reserve my ice cream" }).click();
  await expect(
    page.getByRole("heading", { name: "You're on the list!" }),
  ).toBeVisible();
}
async function unlock(page: Page) {
  await page.goto("/#admin");
  await page.getByLabel("Team password").fill("JesusSavedMe");
  await page.getByRole("button", { name: "Open serving dashboard" }).click();
}

test("reserves multiple scoops, caches locally, supports another request and persists on refresh", async ({
  page,
  context,
}) => {
  const db = await mockDatabase(context);
  await page.goto("/");
  await expect(page.getByText("30 of 30 ice creams left")).toBeVisible();
  await page.getByRole("button", { name: "One more ice cream" }).click();
  await order(page, "Grace", "ದೇವರು ಪ್ರೀತಿಯಾಗಿದ್ದಾನೆ. — 1 John 4:8");
  expect(Object.values(db.read()!.orders)[0].quantity).toBe(2);
  await expect(page.getByText("28 of 30 ice creams left")).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("scoops-scripture:cache:v1")!).orders,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "Reserve a little more" }).click();
  await order(page);
  await expect(page.getByText("27 of 30 ice creams left")).toBeVisible();
  await page.reload();
  await expect(page.locator(".my-order")).toHaveCount(2);
  await expect(page.getByText("27 of 30 ice creams left")).toBeVisible();
});

test("protects admin UI and lets the serving team inspect verses, search, serve and undo", async ({
  page,
  context,
}) => {
  const db = await mockDatabase(context);
  await page.goto("/");
  await order(
    page,
    "Mary",
    "Taste and see that the Lord is good. — Psalm 34:8",
  );
  await page.goto("/#admin");
  await page.getByLabel("Team password").fill("wrong");
  await page.getByRole("button", { name: "Open serving dashboard" }).click();
  await expect(page.getByRole("alert")).toContainText("doesn’t match");
  await page.getByLabel("Team password").fill("JesusSavedMe");
  await page.getByRole("button", { name: "Open serving dashboard" }).click();
  await expect(page.locator(".admin-order blockquote")).toContainText(
    "Psalm 34:8",
  );
  await page
    .getByRole("button", { name: "Mark as served", exact: true })
    .click();
  await expect(page.locator(".admin-order")).toHaveCount(0);
  await page.getByRole("button", { name: "Served 1", exact: true }).click();
  await expect(page.locator(".admin-order")).toHaveCount(1);
  expect(Object.values(db.read()!.orders)[0].served).toBe(true);
  await page.getByRole("button", { name: "Mark as waiting" }).click();
  await page.getByRole("button", { name: "Waiting 1", exact: true }).click();
  await page
    .getByLabel("Search by name, Bible verse or reservation code")
    .fill("nonexistent");
  await expect(page.getByText("No matching reservations")).toBeVisible();
  await page
    .getByRole("button", { name: "Clear search", exact: true })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Mary" })).toBeVisible();
  expect(Object.values(db.read()!.orders)[0].served).toBe(false);
  await page.getByRole("button", { name: "Lock dashboard" }).click();
  await expect(page.getByLabel("Team password")).toBeVisible();
});

test("recovers a lost confirmation across reload without reserving twice", async ({
  page,
  context,
}) => {
  const db = await mockDatabase(context);
  await page.goto("/");
  await page.getByLabel("Your name").fill("Peter");
  await page
    .getByLabel("A Bible verse you love")
    .fill("Jesus wept. — John 11:35");
  db.loseWriteResponse();
  await page.getByRole("button", { name: "Reserve my ice cream" }).click();
  await expect(
    page.getByRole("button", { name: "Retry reservation" }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Retry reservation" }).click();
  await expect(
    page.getByRole("heading", { name: "You're on the list!" }),
  ).toBeVisible();
  expect(Object.keys(db.read()!.orders)).toHaveLength(1);
  await expect(page.getByText("29 of 30 ice creams left")).toBeVisible();
});

test("updates stock on realtime events and blocks sold-out orders", async ({
  page,
  context,
}) => {
  const db = await mockDatabase(context);
  await page.goto("/");
  await expect(page.getByText("30 of 30 ice creams left")).toBeVisible();
  db.update({
    version: 1,
    capacity: 30,
    orders: {
      bulk: {
        id: "bulk",
        clientId: "another-phone",
        name: "Church group",
        verse: "Psalm 34:8",
        quantity: 30,
        createdAt: Date.now(),
        served: false,
      },
    },
  });
  await page.evaluate(() => (window as any).__emitRealtime());
  await expect(page.getByText("0 of 30 ice creams left")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "All scooped up!" }),
  ).toBeDisabled();
  await expect(page.getByLabel("Your name")).toBeDisabled();
});

test("does not accept unconfirmed offline orders", async ({
  page,
  context,
}) => {
  await mockDatabase(context);
  await page.goto("/");
  await expect(page.getByText("30 of 30 ice creams left")).toBeVisible();
  await context.route(endpoint, (route) => route.abort());
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("button", { name: "Reserve my ice cream" }),
  ).toBeDisabled();
  await expect(page.locator(".notice.warning")).toContainText(
    "only confirmed online",
  );
});

test("rejects whitespace-only submissions and renders user content as text", async ({
  page,
  context,
}) => {
  await mockDatabase(context);
  await page.goto("/");
  await page.getByLabel("Your name").fill("   ");
  await page.getByLabel("A Bible verse you love").fill("   ");
  await page.getByRole("button", { name: "Reserve my ice cream" }).click();
  await expect(page.getByRole("alert")).toContainText("not just spaces");
  await order(
    page,
    "<script>window.bad=true</script>",
    "<img src=x onerror=alert(1)>",
  );
  await unlock(page);
  await expect(page.locator(".admin-order blockquote")).toHaveText(
    "<img src=x onerror=alert(1)>",
  );
  expect(await page.evaluate(() => (window as any).bad)).toBeUndefined();
});

test("mobile layout fits the viewport and the form is usable", async ({
  page,
  context,
}) => {
  await mockDatabase(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText("30 of 30 ice creams left")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await order(page, "Anna");
  await unlock(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page
    .getByRole("button", { name: "Mark as served", exact: true })
    .click();
  await expect(page.getByText("All caught up. How sweet!")).toBeVisible();
});

test("admin can add slots and customers see the expanded total", async ({
  page,
  context,
}) => {
  const db = await mockDatabase(context);
  await page.goto("/");
  await order(page);
  await unlock(page);
  await page.getByLabel("Slots to add").fill("10");
  await page.getByRole("button", { name: "Add slots", exact: true }).click();
  await expect(
    page.getByText("10 slots added. 39 available out of 40 total."),
  ).toBeVisible();
  expect(db.read()!.capacity).toBe(40);
  expect(Object.keys(db.read()!.orders)).toHaveLength(1);
  await page.goto("/");
  await expect(page.getByText("39 of 40 ice creams left")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add slots", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("39 of 40 ice creams left")).toBeVisible();
});

test("admin can retry a lost restock confirmation after reload without adding twice", async ({
  page,
  context,
}) => {
  const db = await mockDatabase(context);
  await unlock(page);
  await page.getByLabel("Slots to add").fill("7");
  db.loseWriteResponse();
  await page.getByRole("button", { name: "Add slots", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Retry adding slots" }),
  ).toBeEnabled();
  await page.reload();
  await page.getByLabel("Team password").fill("JesusSavedMe");
  await page.getByRole("button", { name: "Open serving dashboard" }).click();
  await expect(page.getByLabel("Slots to add")).toHaveValue("7");
  await page.getByRole("button", { name: "Retry adding slots" }).click();
  await expect(
    page.getByText("7 slots added. 37 available out of 37 total."),
  ).toBeVisible();
  expect(db.read()!.capacity).toBe(37);
});

test("deleting a waiting order requires confirmation and returns its slots", async ({
  page,
  context,
}) => {
  const db = await mockDatabase(context);
  await page.goto("/");
  await page.getByRole("button", { name: "One more ice cream" }).click();
  await order(page, "Martha");
  await unlock(page);
  await page.getByRole("button", { name: "Delete order for Martha" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "2 slots will become available",
  );
  await page.getByRole("button", { name: "Keep order" }).click();
  expect(Object.keys(db.read()!.orders)).toHaveLength(1);
  await page.getByRole("button", { name: "Delete order for Martha" }).click();
  await page.getByRole("button", { name: "Delete order", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator(".admin-order")).toHaveCount(0);
  expect(db.read()!.orders).toEqual({});
  await page.goto("/");
  await expect(page.getByText("30 of 30 ice creams left")).toBeVisible();
  await expect(page.locator(".my-order")).toHaveCount(0);
});

test("deleting a served order keeps consumed scoops out of stock", async ({
  page,
  context,
}) => {
  const db = await mockDatabase(context);
  await page.goto("/");
  await order(page, "Martha");
  await unlock(page);
  await page
    .getByRole("button", { name: "Mark as served", exact: true })
    .click();
  await page.getByRole("button", { name: "Served 1", exact: true }).click();
  await page.getByRole("button", { name: "Delete order for Martha" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "No slots will be returned.",
  );
  await page.getByRole("button", { name: "Delete order", exact: true }).click();
  await expect(page.locator(".admin-order")).toHaveCount(0);
  expect(db.read()!.deletedServedQuantity).toBe(1);
  await expect(
    page.locator(".admin-stats > div").nth(2).locator("strong"),
  ).toHaveText("1");
  await page.goto("/");
  await expect(page.getByText("29 of 30 ice creams left")).toBeVisible();
});

test("live restocking reopens a sold-out form and deletion removes a guest confirmation", async ({
  page,
  context,
}) => {
  const db = await mockDatabase(context, {
    version: 1,
    capacity: 30,
    orders: {
      full: {
        id: "full",
        clientId: "other",
        name: "Group",
        verse: "Psalm 34:8",
        quantity: 30,
        createdAt: 100,
        served: false,
      },
    },
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "All scooped up!" }),
  ).toBeDisabled();
  const adminPage = await context.newPage();
  await unlock(adminPage);
  await adminPage.getByLabel("Slots to add").fill("2");
  await adminPage
    .getByRole("button", { name: "Add slots", exact: true })
    .click();
  await expect(
    adminPage.getByText("2 slots added. 2 available out of 32 total."),
  ).toBeVisible();
  await page.evaluate(() => (window as any).__emitRealtime());
  await expect(page.getByText("2 of 32 ice creams left")).toBeVisible();
  await order(page, "Anna");
  await adminPage.evaluate(() => (window as any).__emitRealtime());
  await adminPage
    .getByRole("button", { name: "Delete order for Anna" })
    .click();
  await adminPage
    .getByRole("button", { name: "Delete order", exact: true })
    .click();
  await expect(adminPage.getByRole("dialog")).not.toBeVisible();
  await page.evaluate(() => (window as any).__emitRealtime());
  await expect(
    page.getByRole("heading", { name: "You're on the list!" }),
  ).not.toBeVisible();
  await expect(
    page.getByText("Your reservation was deleted by the serving team.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByText("2 of 32 ice creams left")).toBeVisible();
  expect(Object.keys(db.read()!.orders)).toEqual(["full"]);
});

test("inventory and deletion controls fit on mobile and are disabled offline", async ({
  page,
  context,
}) => {
  await mockDatabase(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await order(page, "Anna");
  await unlock(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.getByRole("button", { name: "Delete order for Anna" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.getByRole("button", { name: "Keep order" }).click();
  await context.route(endpoint, (route) => route.abort());
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("button", { name: "Add slots", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Delete order for Anna" }),
  ).toBeDisabled();
});
