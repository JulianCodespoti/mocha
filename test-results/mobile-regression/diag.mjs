import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const URL = 'https://juliancodespoti.github.io/mocha/';
const EVIDENCE = path.resolve('test-results/mobile-regression/evidence');
fs.mkdirSync(EVIDENCE, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

const VIEWPORTS = [
  { name: 'iPhone14Pro', width: 393, height: 852 },
  { name: 'GalaxyS21', width: 360, height: 800 },
];

async function run() {
  for (const vp of VIEWPORTS) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`DEEP-DIVE: ${vp.name} (${vp.width}x${vp.height})`);
    console.log('═'.repeat(60));

    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 3,
      hasTouch: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
    });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
    // Wait for preloader
    await page.waitForFunction(() => {
      const p = document.getElementById('preloader');
      return !p || getComputedStyle(p).display === 'none' || getComputedStyle(p).opacity === '0';
    }, { timeout: 15000 }).catch(() => {});
    await sleep(2000);

    // ── 1. OVERFLOW DIAGNOSIS ──
    console.log('\n── OVERFLOW DIAGNOSIS ──');
    const overflowDiag = await page.evaluate(() => {
      const vpWidth = window.innerWidth;
      const offenders = [];
      const all = document.querySelectorAll('*');
      for (const el of all) {
        const rect = el.getBoundingClientRect();
        if (rect.right > vpWidth + 1) {
          const tag = el.tagName.toLowerCase();
          const id = el.id ? `#${el.id}` : '';
          const cls = el.className?.toString?.().substring(0, 60) || '';
          offenders.push({
            el: `${tag}${id}.${cls}`,
            right: Math.round(rect.right),
            width: Math.round(rect.width),
            overflow: Math.round(rect.right - vpWidth),
          });
        }
      }
      // Sort by overflow amount, show unique parents
      offenders.sort((a, b) => b.overflow - a.overflow);
      // Deduplicate by keeping the outermost offenders
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        innerWidth: vpWidth,
        bodyOverflowX: getComputedStyle(document.body).overflowX,
        htmlOverflowX: getComputedStyle(document.documentElement).overflowX,
        offenders: offenders.slice(0, 15),
      };
    });
    console.log(`  scrollWidth=${overflowDiag.scrollWidth}, clientWidth=${overflowDiag.clientWidth}`);
    console.log(`  body overflow-x: ${overflowDiag.bodyOverflowX}`);
    console.log(`  html overflow-x: ${overflowDiag.htmlOverflowX}`);
    console.log(`  Top offenders (right > ${vp.width}px):`);
    for (const o of overflowDiag.offenders) {
      console.log(`    ${o.el} → right=${o.right}px (overflow=${o.overflow}px)`);
    }

    // ── 2. PROGRESS BAR ──
    console.log('\n── PROGRESS BAR ──');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await sleep(600);
    const progressDiag = await page.evaluate(() => {
      const bar = document.getElementById('scrollProgress');
      if (!bar) return { found: false, allIds: Array.from(document.querySelectorAll('[id*="scroll"], [id*="progress"]')).map(e => e.id) };
      const style = getComputedStyle(bar);
      return {
        found: true,
        id: bar.id,
        className: bar.className,
        width: bar.style.width,
        computedWidth: style.width,
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        height: style.height,
        position: style.position,
        zIndex: style.zIndex,
        rect: bar.getBoundingClientRect(),
      };
    });
    console.log(`  Progress bar:`, JSON.stringify(progressDiag, null, 2));

    // ── 3. TOUCH TARGETS (mobile menu only) ──
    console.log('\n── TOUCH TARGETS (mobile menu only) ──');
    // Open menu
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      const btn = document.getElementById('menuToggle');
      if (btn && btn.getAttribute('aria-expanded') !== 'true') btn.click();
    });
    await sleep(500);
    const mobileMenuLinks = await page.evaluate(() => {
      const menu = document.getElementById('mobileMenu');
      if (!menu) return { found: false };
      const links = menu.querySelectorAll('a');
      return {
        found: true,
        links: Array.from(links).map(a => ({
          text: a.textContent.trim(),
          height: Math.round(a.getBoundingClientRect().height),
          paddingTop: getComputedStyle(a).paddingTop,
          paddingBottom: getComputedStyle(a).paddingBottom,
        })),
      };
    });
    console.log(`  Mobile menu links:`, JSON.stringify(mobileMenuLinks, null, 2));
    
    // Close menu
    await page.evaluate(() => {
      const btn = document.getElementById('menuToggle');
      if (btn && btn.getAttribute('aria-expanded') === 'true') btn.click();
    });
    await sleep(300);

    // ── 4. INTERSTITIAL OPACITY (broader search) ──
    console.log('\n── INTERSTITIAL / QUOTE OPACITY ──');
    // Scroll to middle sections
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.3));
    await sleep(500);
    const opacitySearch = await page.evaluate(() => {
      const results = [];
      // Look for section dividers, quotes, interstitial text between gallery sections
      const sections = document.querySelectorAll('section');
      for (const sec of sections) {
        const texts = sec.querySelectorAll('p, blockquote, em, span, div');
        for (const el of texts) {
          const style = getComputedStyle(el);
          const opacity = parseFloat(style.opacity);
          const color = style.color;
          const text = el.textContent.trim();
          // Look for elements with reduced opacity OR reduced alpha color
          if (text.length > 5 && text.length < 200) {
            const colorMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
            const alpha = colorMatch ? parseFloat(colorMatch[4] || '1') : 1;
            if (opacity < 0.95 || alpha < 0.95) {
              results.push({
                text: text.substring(0, 80),
                opacity,
                colorAlpha: alpha,
                color,
                tag: el.tagName,
                className: (el.className?.toString?.() || '').substring(0, 50),
                sectionId: sec.id,
              });
            }
          }
        }
      }
      // Also check Tailwind opacity classes
      const opacityEls = document.querySelectorAll('[class*="opacity-"]');
      for (const el of opacityEls) {
        const text = el.textContent.trim();
        if (text.length > 5 && text.length < 200) {
          const cls = el.className.toString();
          const opMatch = cls.match(/opacity-(\d+)/);
          results.push({
            text: text.substring(0, 80),
            tailwindOpacity: opMatch ? opMatch[1] : 'unknown',
            computedOpacity: getComputedStyle(el).opacity,
            tag: el.tagName,
            className: cls.substring(0, 60),
          });
        }
      }
      return results;
    });
    console.log(`  Found ${opacitySearch.length} reduced-opacity elements:`);
    for (const el of opacitySearch.slice(0, 10)) {
      console.log(`    [${el.tag}] "${el.text.substring(0, 50)}" opacity=${el.opacity || el.computedOpacity}, alpha=${el.colorAlpha ?? 'N/A'}, class="${el.className}"`);
    }

    await browser.close();
  }
}

run().catch(console.error);
