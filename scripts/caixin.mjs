#!/usr/bin/env node
/**
 * caixin.mjs — 财新检索/抓取的跨平台命令行工具（Windows / macOS / Linux 通用）。
 * 驱动本机已开启远程调试的 Edge（或任何 Chromium）通过 CDP 完成，
 * 复用浏览器内已登录的财新会员会话；不读取、不存储任何凭据。
 *
 * 用法：
 *   node caixin.mjs search "创新药" [--tab 综合|杂志|数据通|我闻|mini] [--sort time|smart]
 *        [--pages 10] [--until 2024-09-15] [--out candidates.json]
 *   node caixin.mjs grab --list candidates.json --outdir articles [--only 1,3,5-9]
 *   node caixin.mjs grab --url https://weekly.caixin.com/... --out article.md
 *
 * 前置：Edge 以远程调试模式运行（见 references/edge-driver.md）：
 *   msedge --remote-debugging-port=9222 --user-data-dir=<专用目录>
 * 依赖：scripts/ 目录内 npm install（playwright-core）
 */

import { chromium } from "playwright-core";
import fs from "node:fs/promises";
import path from "node:path";

// ---------- CLI ----------
const argv = process.argv.slice(2);
const command = argv[0];
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const CDP = opt("cdp", process.env.CAIXIN_CDP || "http://127.0.0.1:9222");

const TABS = {
  综合: { categoryId: 119, categoryCode: "20" },
  杂志: { categoryId: 120, categoryCode: "21" },
  数据通: { categoryId: 122, categoryCode: "23" },
  我闻: { categoryId: 121, categoryCode: "22" },
  mini: { categoryId: 123, categoryCode: "24" },
};
const SORTS = { time: 0, smart: 3 };

// ---------- browser ----------
async function connectPage() {
  const browser = await chromium.connectOverCDP(CDP, { timeout: 8000 });
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const pages = ctx.pages();
  let page = pages.find(p => /caixin\.com/.test(p.url())) || pages[0];
  if (!page) page = await ctx.newPage();
  // 保证 fetch 与财新同源（带会员 cookie、避开 CORS）
  if (!/caixin\.com/.test(page.url())) {
    await page.goto("https://www.caixin.com/", { timeout: 25000 }).catch(() => {});
    await page.waitForLoadState("domcontentloaded").catch(() => {});
  }
  return { browser, page };
}

// ---------- search ----------
async function search(keyword) {
  const tab = TABS[opt("tab", "综合")] || TABS["综合"];
  const sort = SORTS[opt("sort", "time")] ?? 0;
  const pagesMax = parseInt(opt("pages", "10"), 10);
  const until = opt("until", "");
  const { browser, page } = await connectPage();
  const items = [];
  let total = 0;
  try {
    for (let p = 1; p <= pagesMax; p++) {
      const d = await page.evaluate(async ({ payload }) => {
        const r = await fetch("https://gateway.caixin.com/api/dataplatform/common/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          credentials: "include",
        });
        return await r.json();
      }, {
        payload: {
          categoryId: tab.categoryId, categoryCode: tab.categoryCode,
          currentPage: p, pageSize: 20, sort, timeRange: 0,
          keyword, sysType: "PC_SEARCH",
        },
      });
      if (d.code !== 0 || !d.data?.articleList?.length) break;
      total = d.data.totalRecords ?? total;
      let stop = false;
      for (const a of d.data.articleList) {
        const date = new Date(a.time).toISOString().slice(0, 10);
        if (until && date < until) { stop = true; break; }
        items.push({
          title: (a.titleNoFont || a.title || "").trim(),
          url: a.url, date,
          channel: a.mediaName || "",
          summary: (a.summary || "").slice(0, 120),
        });
      }
      if (stop) { console.error(`已到时间窗下限 ${until}，停止翻页`); break; }
      await page.waitForTimeout(350);
    }
  } finally {
    const seen = new Set();
    const unique = items.filter(x => !seen.has(x.url) && seen.add(x.url));
    const result = { keyword, tab: opt("tab", "综合"), totalRecords: total, count: unique.length, items: unique };
    const out = opt("out");
    if (out) {
      await fs.writeFile(out, JSON.stringify(result, null, 1), "utf8");
      console.log(`已写入 ${out}`);
    } else {
      console.log(JSON.stringify(result, null, 1));
    }
    console.error(`关键词"${keyword}" 命中 ${total} 条，提取 ${unique.length} 条（${opt("tab", "综合")}标签）`);
    await browser.close();
  }
}

// ---------- grab ----------
async function grab() {
  const extract = async (page, url) => {
    for (const t of ["下一页余下全文", "余下全文", "展开全文"]) {
      try {
        await page.locator(`text=${t}`).first().click({ timeout: 2500 });
        await page.waitForTimeout(1400);
      } catch {}
    }
    return page.evaluate(() => {
      const strip = (t) => t
        .replace(/请务必在总结开头增加这段话[\s\S]*?校验。/g, "")
        .replace(/（本文系[\s\S]*?）|本文仅代表作者观点|责任编辑：[^\n]*/g, "")
        .replace(/推荐阅读[\s\S]*$/, "")
        .trim();
      const paras = [...document.querySelectorAll(".content p")].map(p => p.innerText.trim()).filter(t => t.length > 1);
      let end = paras.length;
      while (end > 3 && !/[。！？”]"?.?$/.test(paras[end - 1])) end--;
      const contentText = paras.join("\n\n");
      return {
        title: document.querySelector("h1")?.innerText.trim() || "",
        text: strip(contentText),
        gated: /订阅后继续阅读|本文共计\d+字/.test(contentText),
      };
    });
  };

  const jobs = [];
  const listFile = opt("list");
  if (listFile) {
    const data = JSON.parse(await fs.readFile(listFile, "utf8"));
    let picks = (opt("only") || "").split(",").flatMap(s => {
      const m = s.trim().match(/^(\d+)-(\d+)$/);
      if (m) { const out = []; for (let i = +m[1]; i <= +m[2]; i++) out.push(i); return out; }
      return s.trim() ? [+s] : [];
    });
    data.items.forEach((it, i) => { if (!picks.length || picks.includes(i + 1)) jobs.push(it); });
  }
  const singleUrl = opt("url");
  if (singleUrl) jobs.push({ url: singleUrl, title: "", date: "" });

  const outdir = opt("outdir");
  if (outdir) await fs.mkdir(outdir, { recursive: true });
  const minChars = parseInt(opt("min", "500"), 10);
  const { browser, page } = await connectPage();
  let ok = 0;
  try {
    for (let i = 0; i < jobs.length; i++) {
      const j = jobs[i];
      try {
        await page.goto(j.url, { timeout: 25000 });
        await page.waitForLoadState("domcontentloaded").catch(() => {});
        await page.waitForTimeout(1500);
        const art = await extract(page, j.url);
        const date = (j.url.match(/(\d{4}-\d{2}-\d{2})\//) || ["", j.date || ""])[1];
        if (art.gated || art.text.length < minChars) {
          console.log(`SKIP ${art.gated ? "GATED(权限外)" : `SHORT(${art.text.length}字<${minChars})`} ${j.url}`);
          continue;
        }
        const md = `---\ntitle: ${art.title}\nurl: ${j.url}\ndate: ${date}\nfetched: ${new Date().toISOString().slice(0, 10)}\n---\n\n# ${art.title}\n\n${art.text}\n`;
        let out = opt("out");
        if (!out) {
          const safe = (art.title || `article-${i + 1}`).replace(/[\\/:*?"<>|\s]/g, "").slice(0, 40);
          out = path.join(outdir || ".", `${String(i + 1).padStart(2, "0")}-${safe}.md`);
        }
        await fs.writeFile(out, md, "utf8");
        console.log(`OK ${path.basename(out)} ${art.text.length}字 ${art.title.slice(0, 30)}`);
        ok++;
      } catch (e) {
        console.log(`FAIL ${j.url} ${e.message.slice(0, 60)}`);
      }
      await page.waitForTimeout(300);
    }
  } finally {
    console.error(`完成：${ok}/${jobs.length} 篇`);
    await browser.close();
  }
}

// ---------- main ----------
if (command === "search") {
  const kw = argv[1];
  if (!kw) { console.error("用法: node caixin.mjs search <关键词> [选项]"); process.exit(1); }
  await search(kw);
} else if (command === "grab") {
  if (!opt("list") && !opt("url")) { console.error("用法: node caixin.mjs grab --list <json> --outdir <dir> 或 --url <链接> --out <文件>"); process.exit(1); }
  await grab();
} else {
  console.error("命令: search | grab（详见 scripts/caixin.mjs 顶部注释或 references/edge-driver.md）");
  process.exit(1);
}
