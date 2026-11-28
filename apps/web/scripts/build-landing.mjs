import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const src = join(root, "landing");
const out = join(root, "public");
const variants = ["a", "b", "c"];
const outputs = ["index.html", ...variants, "css", "js", "img", "svg"];

const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "https://hafsa.asos-it.uz").replace(/\/$/, "");
const botUsername = (process.env.NEXT_PUBLIC_BOT_USERNAME || "hafsaustozabot").replace(/^@/, "");
const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://hafsauztoza.vercel.app").replace(/\/$/, "");
const isLocalHost = (url) => {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".trycloudflare.com");
  } catch {
    return false;
  }
};
const isLocalTarget = isLocalHost(appUrl) || isLocalHost(apiUrl);
const envPixelId = process.env.NEXT_PUBLIC_FB_PIXEL_ID;
const pixelId =
  envPixelId && envPixelId !== "2585302615300650"
    ? envPixelId
    : isLocalTarget
      ? ""
      : "2638835023297944";
const clarityId = process.env.NEXT_PUBLIC_CLARITY_ID ?? (isLocalTarget ? "" : "z3mqc8x0cm");

async function minifyCss(file) {
  const { code } = await transform(await readFile(join(src, "css", file), "utf8"), {
    loader: "css",
    minify: true,
    target: ["chrome100", "safari15"],
  });
  return code.trim();
}

async function minifyJs(file, define) {
  const { code } = await transform(await readFile(join(src, "js", file), "utf8"), {
    loader: "js",
    minify: true,
    target: ["chrome100", "safari15"],
    define,
  });
  return code;
}

await Promise.all(outputs.map((name) => rm(join(out, name), { recursive: true, force: true })));
await Promise.all(["css", "js", "img", "svg", ...variants].map((dir) => mkdir(join(out, dir), { recursive: true })));

const criticalCss = await minifyCss("critical.css");
const variantsCss = await minifyCss("variants.css");

function buildHtml(template, cssPlaceholder, css) {
  let result = template
    .replace(cssPlaceholder, () => css)
    .replaceAll("%%APP_URL%%", appUrl)
    .replaceAll("%%BOT_USERNAME%%", botUsername);
  if (!pixelId) result = result.replace(/<script src="\.?\/js\/pixel\.js" defer><\/script>\n?/, "");
  return result.replace(/>\s*\n\s*</g, "><").replace(/\n/g, "");
}

const html = buildHtml(await readFile(join(src, "index.html"), "utf8"), "%%CRITICAL_CSS%%", criticalCss);
const pages = [{ label: "index.html", html, requireMainCss: true }];

await writeFile(join(out, "index.html"), html);
for (const variant of variants) {
  const variantHtml = buildHtml(await readFile(join(src, `${variant}.html`), "utf8"), "%%VARIANTS_CSS%%", variantsCss);
  await writeFile(join(out, variant, "index.html"), variantHtml);
  pages.push({ label: `${variant}/index.html`, html: variantHtml, requireMainCss: false });
}
await writeFile(join(out, "css", "main.css"), await minifyCss("main.css"));
await writeFile(
  join(out, "js", "main.js"),
  await minifyJs("main.js", {
    __API_URL__: JSON.stringify(apiUrl),
    __BOT_USERNAME__: JSON.stringify(botUsername),
    __CLARITY_ID__: JSON.stringify(clarityId),
  }),
);
if (pixelId) {
  await writeFile(join(out, "js", "pixel.js"), await minifyJs("pixel.js", { __FB_PIXEL_ID__: JSON.stringify(pixelId) }));
}
for (const dir of ["img", "svg"]) {
  for (const file of await readdir(join(src, dir))) {
    await copyFile(join(src, dir, file), join(out, dir, file));
  }
}

const imageLimit = 10 * 1024;
const violations = [];
const check = (ok, rule) => ok || violations.push(rule);

for (const { label, html: pageHtml, requireMainCss } of pages) {
  check(/^<!doctype html><html\b[^>]*\blang="uz"[^>]*>/.test(pageHtml), `${label}: html must declare lang`);
  check(/<head>.*<style>.+<\/style>.*<\/head>/.test(pageHtml), `${label}: critical CSS must be inlined in <style>`);
  if (requireMainCss || pageHtml.includes("main.css")) {
    check(
      pageHtml.includes(
        `<link rel="stylesheet" href="./css/main.css" media="print" onload="this.media='all'"><noscript><link rel="stylesheet" href="./css/main.css"></noscript>`,
      ),
      `${label}: main.css must load with the media=print swap and a noscript fallback`,
    );
  }
  for (const img of pageHtml.match(/<img [^>]*>/g) ?? []) {
    check(img.includes('loading="lazy"') && img.includes('decoding="async"'), `${label}: img needs loading=lazy decoding=async: ${img}`);
    for (const imgSrc of img.match(/\.?\/img\/[^\s",]+/g) ?? []) check(imgSrc.endsWith(".avif"), `${label}: image must be AVIF: ${imgSrc}`);
  }
  for (const script of pageHtml.match(/<script[^>]*>/g) ?? []) check(/ defer[ >]/.test(script), `${label}: script needs defer: ${script}`);
  check(!/<script(?![^>]*\bsrc=)[^>]*>/.test(pageHtml), `${label}: inline scripts are not allowed`);
  if (pixelId) {
    check(
      /<script src="\.?\/js\/pixel\.js" defer><\/script><\/body><\/html>$/.test(pageHtml),
      `${label}: Meta Pixel must be the last element`,
    );
  }
}
for (const file of await readdir(join(out, "img"))) {
  const { size } = await stat(join(out, "img", file));
  check(size <= imageLimit, `img/${file} is ${size} B, limit ${imageLimit} B`);
}

if (violations.length) {
  console.error(`Landing breaks the launch rules:\n- ${violations.join("\n- ")}`);
  process.exit(1);
}

console.log(`Landing built for ${appUrl} (pixel ${pixelId ? "on" : "off"}, clarity ${clarityId ? "on" : "off"})`);
