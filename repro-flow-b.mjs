import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const name = `مادة اختبار فريدة ${Date.now().toString(36)}`;

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage();

const log = (...a) => console.log("[REPRO]", ...a);

try {
  await page.goto(`${BASE}/ar/contribute`, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  log("Clicking إضافة ملخص");
  await page.getByRole("button", { name: "إضافة ملخص" }).first().click();

  log("Clicking إضافة مادة جديدة");
  await page.getByText("إضافة مادة جديدة", { exact: true }).click();

  await page.getByPlaceholder("مثال: أنظمة التشغيل").fill(name);
  await page.getByPlaceholder("مثال: تقسيم الشبكات — ورقة مراجعة").fill("ملخص الاختبار");
  await page.getByPlaceholder("الصق أو اكتب الملخص هنا…").fill("هذا نص ملخص تجريبي.");

  log("Clicking نشر");
  await page.getByRole("button", { name: "نشر" }).click();

  await page.waitForTimeout(600);

  const store = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("sc.content.store.v1") ?? "[]").map(
      (s) => ({ id: s.id, title: s.title, n: s.summaries?.length ?? 0 })
    )
  );
  log("localStorage store after publish:", JSON.stringify(store));

  const inWorkspace = await page.getByRole("heading", { name }).count();
  log(`Workspace heading count for "${name}": ${inWorkspace}`);

  log("Hard-navigating to /ar/resources");
  await page.goto(`${BASE}/ar/resources`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  const cards = await page.evaluate(() =>
    Array.from(document.querySelectorAll("h3")).map((h) => h.textContent?.trim())
  );
  log("All h3 texts on /ar/resources:");
  for (const c of cards) log("  -", c);
  const matches = cards.filter((c) => c?.includes(name)).length;
  log(`Cards containing "${name}": ${matches}`);
} catch (err) {
  log("ERROR:", err.message);
  await page.screenshot({ path: "repro-error.png", fullPage: true });
}

await browser.close();
