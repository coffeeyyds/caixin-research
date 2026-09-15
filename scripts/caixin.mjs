#!/usr/bin/env node
/**
 * caixin.mjs — 财新检索/抓取的跨平台命令行工具（Windows / macOS / Linux 通用）。
 * 驱动本机已开启远程调试的 Edge（或任何 Chromium）通过 CDP 完成，
 * 复用浏览器内已登录的财新会员会话；不读取、不存储任何凭据。
 *
 * 用法：
 *   node caixin.mjs search "创新药" [--tab 综合|杂志|数据通|我闻|mini] [--sort time|smart]
 *        [--pages 10] [--until 2024-09-15] [--out candidates.json]
 *   node caixin.mjs grab --list candidates.json --outdir articles [--only 1,3,5-9] [--min 500]
 *   node caixin.mjs grab --url https://weekly.caixin.com/... --out article.md
 *
 * 注意：--until 截断仅在 --sort time（时间倒序）下生效；smart 排序为乱序，
 *       旧文会被逐条跳过但不会提前停止翻页。
 * 前置：Edge 以远程调试模式运行（见 references/edge-driver.md）：
 *   msedge --remote-debugging-port=9222 --user-data-dir=<专用目录>
 * 依赖：Node.js ≥ 20；scripts/ 目录内 npm install（playwright-core）
 */

import { chromium } from "playwright-core";
import fs from "node:fs/promises";
import path from "node:path";

// ---------- CLI ----------
const argv = process.argv.slice(2);
const command = argv[0];
const die = (msg) => { console.error(`错误：${msg}`); process.exit(1); };
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  if (!v || v.startsWith("--")) die(`--${name} 缺少参数值`);
  return v;
};
const intOpt = (name, fallback) => {
  const raw = opt(name, String(fallback));
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) die(`--${name} 需为正整数（收到 "${raw}"）`);
  return n;
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
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP, { timeout: 8000 });
  } catch {
    console.error(`无法连接 ${CDP}：请确认 Edge 已按 references/edge-driver.md 以远程调试模式启动（--cdp 可指定端口）`);
    process.exit(1);
  }
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const pages = ctx.pages();
  let page = pages.find(p => /caixin\.com/.test(p.url())) || pages[0];
  if (!page) page = await ctx.newPage();
  // 先停在财新域再发 fetch：gateway.caixin.com 与 www.caixin.com 为跨子域，
  // 依赖网关接口的 CORS 放行，同时带上会员 Cookie
  if (!/caixin\.com/.test(page.url())) {
    await page.goto("https://www.caixin.com/", { timeout: 25000 }).catch(() => {});
    await page.waitForLoadState("domcontentloaded").catch(() => {});
  }
  return { browser, page };
}

// ---------- search ----------
async function search(keyword) {
  const tabName = opt("tab", "综合");
  if (!TABS[tabName]) console.error(`警告：未知 --tab "${tabName}"，回退为 综合`);
  const tab = TABS[tabName] || TABS["综合"];
  const sortName = opt("sort", "time");
  // SORTS.time === 0，不能用 !SORTS[sortName] 判断（0 会被当成假）
  if (!(sortName in SORTS)) console.error(`警告：未知 --sort "${sortName}"，回退为 time`);
  const sort = sortName in SORTS ? SORTS[sortName] : 0;
  const pagesMax = intOpt("pages", 10);
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
      if (d.code !== 0) {
        console.error(`搜索接口返回异常：code=${d.code} ${d.msg || ""}（第 ${p} 页）`);
        break;
      }
      const list = d.data?.articleList || [];
      if (!list.length) break;
      total = d.data.totalRecords ?? total;
      let stop = false;
      for (const a of list) {
        // 财新按北京时间发布；+8h 防止凌晨文章被记成前一天（UTC）
        const date = new Date(a.time + 8 * 3600e3).toISOString().slice(0, 10);
        if (until && date < until) {
          if (sort === 0) { stop = true; break; } // 时间倒序才可安全停止
          continue; // smart 乱序：跳过旧文，继续翻页
        }
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
    const result = { keyword, tab: tabName, sort: sortName, totalRecords: total, count: unique.length, items: unique };
    const out = opt("out");
    if (out) {
      await fs.writeFile(out, JSON.stringify(result, null, 1), "utf8");
      console.log(`已写入 ${out}`);
    } else {
      console.log(JSON.stringify(result, null, 1));
    }
    console.error(`关键词"${keyword}" 命中 ${total} 条，提取 ${unique.length} 条（${tabName}标签）`);
    await browser.close();
  }
}

// ---------- grab ----------
async function grab() {
  const listFile = opt("list");
  const singleOut = opt("out");
  const singleUrl = opt("url");
  if (listFile && singleOut) die("--list（批量）与 --out（单篇输出文件）互斥：批量模式请用 --outdir");
  if (!listFile && !singleUrl) die("需要 --list <json> --outdir <dir> 或 --url <链接> --out <文件>");

  const jobs = [];
  if (listFile) {
    let data;
    try {
      data = JSON.parse(await fs.readFile(listFile, "utf8"));
    } catch (e) {
      die(`无法解析 --list 文件：${e.message}`);
    }
    if (!Array.isArray(data.items)) die(`--list 文件里没有 items 数组（应为 search --out 的输出）`);
    const onlyRaw = opt("only");
    let picks = null;
    if (onlyRaw) {
      picks = onlyRaw.split(",").flatMap(s => {
        const m = s.trim().match(/^(\d+)-(\d+)$/);
        if (m) { const out = []; for (let i = +m[1]; i <= +m[2]; i++) out.push(i); return out; }
        const n = parseInt(s, 10);
        return Number.isFinite(n) ? [n] : [];
      });
      if (!picks.length) die(`--only "${onlyRaw}" 未解析出任何序号（示例：1,3,5-9）`);
    }
    data.items.forEach((it, i) => {
      if (!picks || picks.includes(i + 1)) jobs.push({ ...it, idx: i + 1 });
    });
    if (!jobs.length) die(`--only 选中的序号均超出候选范围（候选共 ${data.items.length} 条）`);
  } else {
    jobs.push({ url: singleUrl, title: "", date: "", idx: 1 });
  }

  const outdir = opt("outdir");
  if (outdir) await fs.mkdir(outdir, { recursive: true });
  const minChars = intOpt("min", 500);

  const extract = async (page) => {
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
      // 跳过 AI 摘要水印段落（p.aitt），避免数据通页被整页清成 0 字
      const paras = [...document.querySelectorAll(".content p")]
        .filter(p => !p.classList.contains("aitt"))
        .map(p => p.innerText.trim())
        .filter(t => t.length > 1);
      let end = paras.length;
      while (end > 3 && !/[。！？”]"?.?$/.test(paras[end - 1])) end--;
      const contentText = paras.slice(0, end).join("\n\n");
      const pageText = document.body?.innerText || "";
      // 付费墙文案常在按钮/浮层（尤其数据通），不在 .content p 内；需对整页兜底检测
      const gated = /订阅后继续阅读|本文共计\d+字/.test(contentText)
        || /订阅后继续阅读|本文共计\d+字/.test(pageText);
      return {
        title: document.querySelector("h1")?.innerText.trim() || "",
        text: strip(contentText),
        gated,
      };
    });
  };

  const { browser, page } = await connectPage();
  let ok = 0;
  try {
    for (const j of jobs) {
      try {
        await page.goto(j.url, { timeout: 25000 });
        await page.waitForLoadState("domcontentloaded").catch(() => {});
        await page.waitForTimeout(1500);
        const art = await extract(page);
        const date = (j.url.match(/(\d{4}-\d{2}-\d{2})\//) || ["", j.date || ""])[1];
        if (art.gated || art.text.length < minChars) {
          console.log(`SKIP ${art.gated ? "GATED(权限外)" : `SHORT(${art.text.length}字<${minChars})`} ${j.url}`);
          continue;
        }
        const md = `---\ntitle: ${JSON.stringify(art.title)}\nurl: ${j.url}\ndate: ${date}\nfetched: ${new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)}\n---\n\n# ${art.title}\n\n${art.text}\n`;
        let out = singleOut;
        if (!out) {
          const safe = (art.title || `article-${j.idx}`).replace(/[\\/:*?"<>|\s]/g, "").slice(0, 40);
          out = path.join(outdir || ".", `${String(j.idx).padStart(2, "0")}-${safe}.md`);
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
    if (jobs.length && ok === 0) process.exitCode = 1;
  }
}

// ---------- main ----------
if (command === "search") {
  const kw = argv[1];
  if (!kw || kw.startsWith("--")) die("用法: node caixin.mjs search <关键词> [选项]");
  await search(kw);
} else if (command === "grab") {
  await grab();
} else {
  console.error("命令: search | grab（详见 scripts/caixin.mjs 顶部注释或 references/edge-driver.md）");
  process.exit(1);
}
