import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const browser = await chromium.launch({ channel: "msedge", headless: true });

const log = (...a) => console.log("[PROBE]", ...a);

async function run(lang, labels) {
  const page = await browser.newPage();
  const name = `ProbeMat ${lang} ${Date.now().toString(36)}`;
  try {
    await page.goto(`${BASE}/${lang}/contribute`, { waitUntil: "networkidle" });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "networkidle" });

    // --- Create material via Add Summary -> New Material ---
    await page.getByRole("button", { name: labels.addSummary }).first().click();
    await page.getByText(labels.addNew, { exact: true }).click();
    await page.getByPlaceholder(labels.namePlaceholder).fill(name);
    await page.getByPlaceholder(labels.titlePlaceholder).fill("First summary");
    await page.getByPlaceholder(labels.contentPlaceholder).fill("Body text one.");
    // add a second video
    await page.getByRole("button", { name: labels.addVideo }).click();
    const videoInputs = page.locator('input[dir="ltr"]');
    await videoInputs.nth(0).fill("https://www.youtube.com/watch?v=alpha");
    await videoInputs.nth(1).fill("https://www.youtube.com/watch?v=beta");
    await page.getByRole("button", { name: labels.publish }).click();
    await page.waitForTimeout(500);

    const storeAfterFirst = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("sc.content.store.v1") ?? "[]")
    );
    const created = storeAfterFirst.find((s) => s.title === name);
    log(`[${lang}] created subject:`, created ? { id: created.id, n: created.summaries.length, vids: created.summaries[0]?.videos } : "NOT FOUND");

    // --- Second summary on same material via selector ---
    await page.getByRole("button", { name: labels.addSummary }).first().click();
    const selectorShows = await page.getByText(name, { exact: true }).count();
    log(`[${lang}] new material visible in selector after creation: ${selectorShows > 0}`);
    // select it (radio by label text) then publish second summary
    await page.locator(`label:has-text("${name}") input`).first().click();
    await page.getByPlaceholder(labels.titlePlaceholder).fill("Second summary");
    await page.getByPlaceholder(labels.contentPlaceholder).fill("Body text two.");
    await page.getByRole("button", { name: labels.publish }).click();
    await page.waitForTimeout(500);

    const storeAfterSecond = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("sc.content.store.v1") ?? "[]")
    );
    const after = storeAfterSecond.find((s) => s.title === name);
    log(`[${lang}] after second summary:`, after ? { id: after.id, n: after.summaries.length } : "NOT FOUND");

    // --- Hard reload resources, count cards for this material ---
    await page.goto(`${BASE}/${lang}/resources`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    const titles = await page.evaluate(() =>
      Array.from(document.querySelectorAll("main h3")).map((h) => h.textContent?.trim())
    );
    const cards = titles.filter((t) => t?.includes(name));
    log(`[${lang}] /resources cards named "${name}": ${cards.length} (titles=${JSON.stringify(cards)})`);

    // --- Detail page works ---
    const detail = `${BASE}/${lang}/resources/${after.id}`;
    await page.goto(detail, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    const detailTitle = await page.locator("h1").first().textContent();
    const summaryCountOnDetail = await page.getByText("Second summary").count();
    const videoLinks = await page.locator('main a[href*="youtube.com"]').count();
    log(`[${lang}] detail page title: "${detailTitle}" | second summary present: ${summaryCountOnDetail > 0} | youtube links: ${videoLinks}`);
  } catch (err) {
    log(`[${lang}] ERROR:`, err.message);
  }
  await page.close();
}

const ar = {
  addSummary: "إضافة ملخص",
  addNew: "إضافة مادة جديدة",
  namePlaceholder: "مثال: أنظمة التشغيل",
  titlePlaceholder: "مثال: تقسيم الشبكات — ورقة مراجعة",
  contentPlaceholder: "الصق أو اكتب الملخص هنا…",
  addVideo: "إضافة فيديو آخر",
  publish: "نشر",
};
const en = {
  addSummary: "Add summary",
  addNew: "Add new subject",
  namePlaceholder: "e.g. Operating Systems",
  titlePlaceholder: "e.g. Subnetting — Cheat Sheet",
  contentPlaceholder: "Paste or write the summary here…",
  addVideo: "Add another video",
  publish: "Publish",
};

await run("ar", ar);
await run("en", en);
await browser.close();
