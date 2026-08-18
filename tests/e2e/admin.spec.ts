import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

async function expectNoUnnamedControls(page: Page): Promise<void> {
  const unnamed = await page
    .locator("button, a[href], input, select, textarea")
    .evaluateAll((elements) =>
      elements
        .filter((element) => {
          const control = element as HTMLElement & { labels?: NodeListOf<HTMLLabelElement> };
          return !(
            control.getAttribute("aria-label")?.trim() ||
            control.getAttribute("aria-labelledby")?.trim() ||
            control.getAttribute("title")?.trim() ||
            control.textContent?.trim() ||
            control.labels?.length
          );
        })
        .map((element) => element.outerHTML.slice(0, 180)),
    );
  expect(unnamed).toEqual([]);
}

test("renders every required admin route with named controls", async ({ page }) => {
  const routes = [
    ["/", "Overview"],
    ["/apps", "Apps"],
    ["/users", "Users"],
    ["/connections", "Connections"],
    ["/catalog", "Data catalog"],
    ["/activity", "Activity"],
    ["/settings", "Settings"],
  ] as const;

  for (const [route, heading] of routes) {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
    await expectNoUnnamedControls(page);
  }
});

test("invites and governs a user with keyboard-accessible modal behavior", async ({ page }) => {
  const email = `e2e-${Date.now()}@example.test`;
  await page.goto("/users");

  const inviteButton = page.getByRole("button", { name: "Invite user" });
  await inviteButton.click();
  const dialog = page.getByRole("dialog", { name: "Invite a user" });
  const emailField = dialog.getByLabel("Work email");
  await expect(emailField).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Send invite" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(inviteButton).toBeFocused();

  await inviteButton.click();
  await dialog.getByLabel("Work email").fill(email);
  await dialog.getByLabel("Role").selectOption("member");
  await dialog.getByRole("button", { name: "Send invite" }).click();

  const row = page.getByRole("row", { name: new RegExp(email) });
  await expect(row).toContainText("invited");
  const role = row.getByRole("combobox", { name: `Role for ${email}` });
  await role.selectOption("builder");
  await expect(role).toHaveValue("builder");
  await role.selectOption("admin");
  await expect(role).toHaveValue("admin");

  await row.getByRole("button", { name: `Deactivate ${email}` }).click();
  await expect(row).toContainText("deactivated");
  await row.getByRole("button", { name: `Reactivate ${email}` }).click();
  await expect(row).toContainText("active");
});

test("persists branding feedback and restores the original values", async ({ page }) => {
  await page.goto("/settings");
  const displayName = page.getByLabel("Display name");
  const guidance = page.getByLabel("Design guidance");
  const originalName = await displayName.inputValue();
  const originalGuidance = await guidance.inputValue();

  await displayName.fill(`Toolflow browser verification ${Date.now()}`);
  await guidance.fill("Use concise labels and explicit operational states.");
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/v1/branding") &&
        response.request().method() === "PATCH" &&
        response.ok(),
    ),
    page.getByRole("button", { name: "Save settings" }).click(),
  ]);
  await expect(page.getByRole("status")).toHaveText("Branding saved.");

  await displayName.fill(originalName);
  await guidance.fill(originalGuidance);
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/v1/branding") &&
        response.request().method() === "PATCH" &&
        response.ok(),
    ),
    page.getByRole("button", { name: "Save settings" }).click(),
  ]);
  await expect(displayName).toHaveValue(originalName);
  await expect(guidance).toHaveValue(originalGuidance);
});

test("filters and exports the append-only activity trail", async ({ page }) => {
  await page.goto("/activity");
  await page.getByLabel("Outcome").selectOption("succeeded");
  await page.getByLabel("Actor type").fill("user");
  await page.getByLabel("Exact action").fill("membership.updated");
  await expect(page.getByLabel("Exact action")).toHaveValue("membership.updated");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("toolflow-audit.csv");
});
