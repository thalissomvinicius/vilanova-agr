import { expect, test } from "@playwright/test";

test("login, navegacao e layout responsivo do dashboard", async ({ page }) => {
  test.setTimeout(90_000);
  await page.route(/(?:arcgisonline|cartocdn)/, (route) => route.abort());
  await page.goto("/");
  await page.getByLabel("Matrícula").fill("2170");
  await page.getByLabel("Senha", { exact: true }).fill("teste-local");
  await page.getByRole("button", { name: "Acessar dashboard" }).click();

  await expect(page.getByRole("heading", { name: "Dashboard Subprodutos" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Geral" })).toHaveAttribute("aria-selected", "true");

  for (const tab of ["Coletas", "Conciliação", "Análise"]) {
    await page.getByRole("tab", { name: tab }).click();
    await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
  }

  await expect(page.locator(".operations-map-status strong")).toHaveText(/Mapa operacional/);
  await expect(page.locator(".operations-map-loading")).toBeHidden({ timeout: 30_000 });
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await expect(page.locator(".operations-map-error")).toHaveCount(0);
  await expect(page.locator(".operations-map-shell")).toHaveAttribute("data-map-status", "ready");
  await expect(page.getByRole("button", { name: "Limpo", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Fé em Deus", exact: true }).click();
  await expect(page.locator(".operations-map-shell")).toHaveAttribute("data-farm-scope", "fe-em-deus");
  await expect(page.locator(".operations-map-shell")).toHaveAttribute("data-visible-parcels", "35");
  await page.getByRole("button", { name: "Vila Nova", exact: true }).click();
  await expect(page.locator(".operations-map-shell")).toHaveAttribute("data-farm-scope", "vila-nova");
  await expect(page.locator(".operations-map-shell")).toHaveAttribute("data-visible-parcels", "83");

  await page.getByRole("tab", { name: "Coletas" }).click();
  await expect(page.getByLabel("Ordenar coletas")).toBeVisible();
  await expect(page.getByLabel("Controles da tabela")).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
