import { expect, test } from "@playwright/test";

test("login, navegacao e layout responsivo do dashboard", async ({ page }) => {
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

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
