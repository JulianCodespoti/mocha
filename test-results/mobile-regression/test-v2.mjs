import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const URL = 'https://juliancodespoti.github.io/mocha/';
const EVIDENCE_DIR = path.resolve('test-results/mobile-regression/evidence');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const VIEWPORTS = [
  { name: 'iPhone14Pro', width: 393, height: 852, dpr: 3 },
  { name: 'GalaxyS21', width: 360, height: 800, dpr: 3 },
];

const results = {};

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForPageReady(page) {
  try {
    await page.waitForFunction(() => {
      const preloader = document.getElementById('preloader');
      if (!preloader) return true;
      const s = getComputedStyle(preloader);
      return s.display === 'none' || s.opacity === '0' || s.visibility === 'hidden' || preloader.style.display === 'none';
    }, { timeout: 15000 });
  } catch { console.log('  [WARN] Preloader may still be visible'); }
  await sleep(2000);
}

for (const vp of VIEWPORTS) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TESTING: ${vp.name} (${vp.width}x${vp.height})`);
  console.log('='.repeat(60));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.dpr,
    hasTouch: true,
    isMobile: false, // Avoid viewport expansion issues
    userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push(err.message));

  const vpResults = {};

  // Navigate
  console.log('\n→ Navigating...');
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await waitForPageReady(page);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, `${vp.name}_initial.png`) });

  // ═══════════════════════════════════════════════════
  // FIX 1: Mobile Nav Overflow
  // ═══════════════════════════════════════════════════
  console.log('\n── FIX 1: Mobile Nav Overflow ──');

  // 1a: No horizontal overflow
  try {
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      innerWidth: window.innerWidth,
      hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }));
    vpResults['fix1_no_overflow'] = {
      pass: !overflow.hasOverflow,
      detail: `scrollWidth=${overflow.scrollWidth}, clientWidth=${overflow.clientWidth}, innerWidth=${overflow.innerWidth}`,
    };
    console.log(`  No overflow: ${!overflow.hasOverflow ? '✅ PASS' : '❌ FAIL'} — ${vpResults['fix1_no_overflow'].detail}`);
  } catch (e) {
    vpResults['fix1_no_overflow'] = { pass: false, detail: e.message };
    console.log(`  No overflow: ❌ FAIL — ${e.message}`);
  }

  // 1b: Hamburger button visible
  try {
    const hamburger = await page.evaluate(() => {
      const btn = document.getElementById('menuToggle')
        || document.querySelector('button[aria-label*="menu" i]')
        || document.querySelector('button[aria-label*="nav" i]');
      if (!btn) return { found: false };
      const rect = btn.getBoundingClientRect();
      const style = getComputedStyle(btn);
      return {
        found: true,
        visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
        inViewport: rect.right <= window.innerWidth && rect.left >= 0,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        ariaLabel: btn.getAttribute('aria-label'),
        id: btn.id,
      };
    });
    vpResults['fix1_hamburger_visible'] = {
      pass: hamburger.found && hamburger.visible && hamburger.inViewport,
      detail: hamburger.found
        ? `pos=(${hamburger.rect.x},${hamburger.rect.y}), size=${hamburger.rect.w}x${hamburger.rect.h}, inViewport=${hamburger.inViewport}, label="${hamburger.ariaLabel}"`
        : 'NOT FOUND',
    };
    console.log(`  Hamburger visible: ${vpResults['fix1_hamburger_visible'].pass ? '✅ PASS' : '❌ FAIL'} — ${vpResults['fix1_hamburger_visible'].detail}`);
  } catch (e) {
    vpResults['fix1_hamburger_visible'] = { pass: false, detail: e.message };
    console.log(`  Hamburger visible: ❌ FAIL — ${e.message}`);
  }

  // 1c: Inline nav hidden on mobile
  try {
    const inlineNav = await page.evaluate(() => {
      // Look for the desktop nav container that should be hidden
      const navContainer = document.querySelector('nav .hidden.sm\\:flex, nav .sm\\:flex');
      if (navContainer) {
        const style = getComputedStyle(navContainer);
        return {
          containerFound: true,
          isHidden: style.display === 'none',
          display: style.display,
        };
      }
      // Fallback: check individual links
      const links = document.querySelectorAll('header nav a[href^="#"]');
      let visibleInHeader = 0;
      links.forEach(a => {
        const rect = a.getBoundingClientRect();
        const style = getComputedStyle(a);
        const parentStyle = getComputedStyle(a.parentElement);
        if (rect.height > 0 && style.display !== 'none' && parentStyle.display !== 'none' && rect.y < 80) {
          visibleInHeader++;
        }
      });
      return { containerFound: false, visibleInHeader };
    });
    const pass = inlineNav.containerFound ? inlineNav.isHidden : (inlineNav.visibleInHeader === 0);
    vpResults['fix1_inline_nav_hidden'] = {
      pass,
      detail: inlineNav.containerFound
        ? `Desktop nav container display=${inlineNav.display}`
        : `${inlineNav.visibleInHeader} visible header links`,
    };
    console.log(`  Inline nav hidden: ${pass ? '✅ PASS' : '❌ FAIL'} — ${vpResults['fix1_inline_nav_hidden'].detail}`);
  } catch (e) {
    vpResults['fix1_inline_nav_hidden'] = { pass: false, detail: e.message };
    console.log(`  Inline nav hidden: ❌ FAIL — ${e.message}`);
  }

  // 1d: Tap hamburger → menu opens with 3 links
  try {
    // Use JS click to avoid pointer interception
    await page.evaluate(() => {
      const btn = document.getElementById('menuToggle') || document.querySelector('button[aria-label*="menu" i]');
      if (btn) btn.click();
    });
    await sleep(600);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, `${vp.name}_menu_open.png`) });

    const menuState = await page.evaluate(() => {
      const allLinks = document.querySelectorAll('a');
      const menuLinks = [];
      for (const a of allLinks) {
        const text = a.textContent.trim().toLowerCase();
        if (['portraits', 'adventures', 'cozy moments', 'cozy'].some(t => text.includes(t))) {
          const rect = a.getBoundingClientRect();
          const style = getComputedStyle(a);
          if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
            menuLinks.push({ text: a.textContent.trim(), h: Math.round(rect.height), w: Math.round(rect.width) });
          }
        }
      }
      return { count: menuLinks.length, links: menuLinks };
    });

    vpResults['fix1_menu_has_3_links'] = {
      pass: menuState.count >= 3,
      detail: `Found ${menuState.count}: ${menuState.links.map(l => `"${l.text}" (${l.w}x${l.h})`).join(', ')}`,
    };
    console.log(`  Menu 3 links: ${menuState.count >= 3 ? '✅ PASS' : '❌ FAIL'} — ${vpResults['fix1_menu_has_3_links'].detail}`);

    // 1e: Hamburger animates to X (check aria-expanded and span transforms)
    const xState = await page.evaluate(() => {
      const btn = document.getElementById('menuToggle') || document.querySelector('button[aria-label*="menu" i]');
      if (!btn) return { found: false };
      const expanded = btn.getAttribute('aria-expanded');
      const spans = btn.querySelectorAll('span');
      let rotated = 0;
      spans.forEach(s => {
        const t = getComputedStyle(s).transform;
        if (t && t !== 'none') rotated++;
      });
      return { found: true, expanded, rotated, spanCount: spans.length };
    });
    vpResults['fix1_hamburger_to_x'] = {
      pass: xState.expanded === 'true' || xState.rotated >= 2,
      detail: `expanded=${xState.expanded}, ${xState.rotated}/${xState.spanCount} spans rotated`,
    };
    console.log(`  Hamburger → X: ${vpResults['fix1_hamburger_to_x'].pass ? '✅ PASS' : '❌ FAIL'} — ${vpResults['fix1_hamburger_to_x'].detail}`);

    // 1f: Tap link → scrolls to section AND closes menu
    if (menuState.count > 0) {
      // Click first visible menu link via JS
      await page.evaluate(() => {
        const links = document.querySelectorAll('a');
        for (const a of links) {
          const text = a.textContent.trim().toLowerCase();
          if (text.includes('portraits')) {
            const rect = a.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) { a.click(); return; }
          }
        }
      });
      await sleep(1500);

      const afterLinkClick = await page.evaluate(() => {
        const scrollY = window.scrollY;
        const btn = document.getElementById('menuToggle') || document.querySelector('button[aria-label*="menu" i]');
        const expanded = btn ? btn.getAttribute('aria-expanded') : 'unknown';
        return { scrollY: Math.round(scrollY), expanded };
      });

      vpResults['fix1_link_scrolls_and_closes'] = {
        pass: afterLinkClick.scrollY > 50 && afterLinkClick.expanded !== 'true',
        detail: `scrollY=${afterLinkClick.scrollY}, expanded=${afterLinkClick.expanded}`,
      };
      console.log(`  Link scrolls & closes: ${vpResults['fix1_link_scrolls_and_closes'].pass ? '✅ PASS' : '❌ FAIL'} — ${vpResults['fix1_link_scrolls_and_closes'].detail}`);
    }
  } catch (e) {
    vpResults['fix1_menu_interaction'] = { pass: false, detail: e.message.substring(0, 100) };
    console.log(`  Menu interaction: ❌ FAIL — ${e.message.substring(0, 100)}`);
  }

  // Scroll back to top
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(500);

  // ═══════════════════════════════════════════════════
  // FIX 2: Touch Targets
  // ═══════════════════════════════════════════════════
  console.log('\n── FIX 2: Touch Targets ──');

  try {
    // Open menu
    await page.evaluate(() => {
      const btn = document.getElementById('menuToggle') || document.querySelector('button[aria-label*="menu" i]');
      if (btn && btn.getAttribute('aria-expanded') !== 'true') btn.click();
    });
    await sleep(500);

    const menuLinkSizes = await page.evaluate(() => {
      const results = [];
      const links = document.querySelectorAll('a');
      for (const a of links) {
        const text = a.textContent.trim().toLowerCase();
        if (['portraits', 'adventures', 'cozy moments', 'cozy'].some(t => text.includes(t))) {
          const rect = a.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            results.push({ text: a.textContent.trim(), height: rect.height });
          }
        }
      }
      return results;
    });

    const allAbove44 = menuLinkSizes.length > 0 && menuLinkSizes.every(l => l.height >= 44);
    vpResults['fix2_menu_links_44px'] = {
      pass: allAbove44,
      detail: menuLinkSizes.map(l => `"${l.text}":${Math.round(l.height)}px`).join(', ') || 'No links found',
    };
    console.log(`  Menu links ≥44px: ${allAbove44 ? '✅ PASS' : '❌ FAIL'} — ${vpResults['fix2_menu_links_44px'].detail}`);

    // Close menu
    await page.evaluate(() => {
      const btn = document.getElementById('menuToggle') || document.querySelector('button[aria-label*="menu" i]');
      if (btn && btn.getAttribute('aria-expanded') === 'true') btn.click();
    });
    await sleep(300);
  } catch (e) {
    vpResults['fix2_menu_links_44px'] = { pass: false, detail: e.message.substring(0, 80) };
    console.log(`  Menu links ≥44px: ❌ FAIL — ${e.message.substring(0, 80)}`);
  }

  // Footer links
  try {
    await page.evaluate(() => {
      const footer = document.querySelector('footer');
      if (footer) footer.scrollIntoView({ behavior: 'instant' });
    });
    await sleep(800);

    const footerLinks = await page.evaluate(() => {
      const footer = document.querySelector('footer');
      if (!footer) return [];
      return Array.from(footer.querySelectorAll('a')).map(a => ({
        text: a.textContent.trim().substring(0, 25),
        height: a.getBoundingClientRect().height,
      })).filter(l => l.height > 0);
    });

    const allFooterOK = footerLinks.length > 0 && footerLinks.every(l => l.height >= 36);
    vpResults['fix2_footer_links_36px'] = {
      pass: allFooterOK,
      detail: footerLinks.map(l => `"${l.text}":${Math.round(l.height)}px`).join(', ') || 'No footer links',
    };
    console.log(`  Footer links ≥36px: ${allFooterOK ? '✅ PASS' : '❌ FAIL'} — ${vpResults['fix2_footer_links_36px'].detail}`);
  } catch (e) {
    vpResults['fix2_footer_links_36px'] = { pass: false, detail: e.message.substring(0, 80) };
    console.log(`  Footer links ≥36px: ❌ FAIL — ${e.message.substring(0, 80)}`);
  }

  // ═══════════════════════════════════════════════════
  // FIX 3: Lightbox Close Button ≥44×44px
  // ═══════════════════════════════════════════════════
  console.log('\n── FIX 3: Lightbox Close Button ──');

  try {
    // Scroll to gallery area
    await page.evaluate(() => window.scrollTo(0, window.innerHeight * 2));
    await sleep(1000);

    // Find and click a gallery image via JS
    const clicked = await page.evaluate(() => {
      const links = document.querySelectorAll('a.glightbox, a[href$=".JPG"], a[href$=".jpg"], a[href$=".webp"]');
      for (const a of links) {
        const rect = a.getBoundingClientRect();
        if (rect.width > 50 && rect.height > 50 && rect.top > -100 && rect.top < window.innerHeight + 100) {
          a.click();
          return true;
        }
      }
      return false;
    });

    if (clicked) {
      await sleep(1500);
      await page.screenshot({ path: path.join(EVIDENCE_DIR, `${vp.name}_lightbox.png`) });

      const closeBtn = await page.evaluate(() => {
        // GLightbox close button selectors
        const selectors = ['.gclose', '.gbtn-close', 'button.gclose', '.glightbox-clean .gclose',
          'button[aria-label="Close"]', '.glightbox-container button'];
        for (const sel of selectors) {
          const btn = document.querySelector(sel);
          if (btn) {
            const rect = btn.getBoundingClientRect();
            const style = getComputedStyle(btn);
            if (rect.width > 0) {
              return {
                found: true,
                width: rect.width,
                height: rect.height,
                minWidth: style.minWidth,
                minHeight: style.minHeight,
                selector: sel,
              };
            }
          }
        }
        return { found: false };
      });

      vpResults['fix3_close_btn_44px'] = {
        pass: closeBtn.found && closeBtn.width >= 44 && closeBtn.height >= 44,
        detail: closeBtn.found
          ? `${Math.round(closeBtn.width)}×${Math.round(closeBtn.height)}px (min: ${closeBtn.minWidth}×${closeBtn.minHeight}) [${closeBtn.selector}]`
          : 'Close button NOT FOUND',
      };
      console.log(`  Close btn ≥44px: ${vpResults['fix3_close_btn_44px'].pass ? '✅ PASS' : '❌ FAIL'} — ${vpResults['fix3_close_btn_44px'].detail}`);

      // Close lightbox
      await page.keyboard.press('Escape');
      await sleep(500);
    } else {
      vpResults['fix3_close_btn_44px'] = { pass: false, detail: 'Could not click gallery image' };
      console.log(`  Close btn ≥44px: ⚠️ SKIP — No gallery image in viewport`);
    }
  } catch (e) {
    vpResults['fix3_close_btn_44px'] = { pass: false, detail: e.message.substring(0, 80) };
    console.log(`  Close btn ≥44px: ❌ FAIL — ${e.message.substring(0, 80)}`);
  }

  // ═══════════════════════════════════════════════════
  // FIX 4: Hover Rules Guarded
  // ═══════════════════════════════════════════════════
  console.log('\n── FIX 4: Hover Rules ──');

  try {
    const hoverCheck = await page.evaluate(() => {
      // Check inline styles for @media (hover: hover) guard
      const styles = document.querySelectorAll('style');
      let guardedBlocks = 0;
      let totalHoverInLocal = 0;

      for (const style of styles) {
        const text = style.textContent;
        const hoverMediaBlocks = text.match(/@media\s*\(\s*hover:\s*hover\s*\)/g);
        if (hoverMediaBlocks) guardedBlocks += hoverMediaBlocks.length;
        // Count :hover in local styles
        const hoverMatches = text.match(/:hover/g);
        if (hoverMatches) totalHoverInLocal += hoverMatches.length;
      }

      // Check via CSSOM for same-origin sheets
      let cssom_guarded = 0;
      let cssom_unguarded = 0;
      for (const sheet of document.styleSheets) {
        try {
          if (!sheet.href || sheet.href.startsWith(location.origin)) {
            const scan = (rules) => {
              for (const rule of rules) {
                if (rule.type === CSSRule.MEDIA_RULE) {
                  if (rule.conditionText?.includes('hover')) {
                    for (const inner of rule.cssRules) {
                      if (inner.selectorText?.includes(':hover')) cssom_guarded++;
                    }
                  } else {
                    scan(rule.cssRules);
                  }
                } else if (rule.selectorText?.includes(':hover')) {
                  cssom_unguarded++;
                }
              }
            };
            scan(sheet.cssRules);
          }
        } catch {}
      }
      return { guardedBlocks, totalHoverInLocal, cssom_guarded, cssom_unguarded };
    });

    vpResults['fix4_hover_guarded'] = {
      pass: hoverCheck.guardedBlocks > 0 || hoverCheck.cssom_guarded > 0,
      detail: `@media(hover:hover) blocks=${hoverCheck.guardedBlocks}, CSSOM guarded=${hoverCheck.cssom_guarded}, unguarded=${hoverCheck.cssom_unguarded}`,
    };
    console.log(`  Hover guarded: ${vpResults['fix4_hover_guarded'].pass ? '✅ PASS' : '❌ FAIL'} — ${vpResults['fix4_hover_guarded'].detail}`);
  } catch (e) {
    vpResults['fix4_hover_guarded'] = { pass: false, detail: e.message.substring(0, 80) };
    console.log(`  Hover guarded: ❌ FAIL — ${e.message.substring(0, 80)}`);
  }

  // ═══════════════════════════════════════════════════
  // FIX 5: Duplicate h1
  // ═══════════════════════════════════════════════════
  console.log('\n── FIX 5: Duplicate h1 ──');

  try {
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(300);

    const h1Info = await page.evaluate(() => {
      const h1s = document.querySelectorAll('h1');
      const preloader = document.getElementById('preloader');
      const preloaderHasH1 = preloader ? !!preloader.querySelector('h1') : false;
      const preloaderDiv = preloader ? preloader.querySelector('div[aria-hidden="true"]') : null;
      return {
        count: h1s.length,
        texts: Array.from(h1s).map(h => h.textContent.trim().substring(0, 50)),
        preloaderHasH1,
        preloaderHasAriaHiddenDiv: !!preloaderDiv,
        preloaderDivText: preloaderDiv?.textContent?.trim()?.substring(0, 40),
      };
    });

    vpResults['fix5_single_h1'] = {
      pass: h1Info.count === 1,
      detail: `${h1Info.count} h1(s): [${h1Info.texts.join(', ')}]`,
    };
    console.log(`  Single h1: ${h1Info.count === 1 ? '✅ PASS' : '❌ FAIL'} — ${vpResults['fix5_single_h1'].detail}`);

    vpResults['fix5_preloader_aria_hidden'] = {
      pass: !h1Info.preloaderHasH1,
      detail: `preloaderHasH1=${h1Info.preloaderHasH1}, ariaHiddenDiv=${h1Info.preloaderHasAriaHiddenDiv}${h1Info.preloaderDivText ? ' ("' + h1Info.preloaderDivText + '")' : ''}`,
    };
    console.log(`  Preloader no h1: ${!h1Info.preloaderHasH1 ? '✅ PASS' : '❌ FAIL'} — ${vpResults['fix5_preloader_aria_hidden'].detail}`);
  } catch (e) {
    vpResults['fix5_single_h1'] = { pass: false, detail: e.message.substring(0, 80) };
    console.log(`  Single h1: ❌ FAIL — ${e.message.substring(0, 80)}`);
  }

  // ═══════════════════════════════════════════════════
  // FIX 6: Interstitial Opacity ≥60%
  // ═══════════════════════════════════════════════════
  console.log('\n── FIX 6: Interstitial Opacity ──');

  try {
    // Scroll through page to find interstitials
    const interstitials = await page.evaluate(() => {
      const found = [];
      // Look for elements with reduced opacity (interstitial/quote/divider text)
      const candidates = document.querySelectorAll('p, span, div, blockquote, em, i');
      for (const el of candidates) {
        const style = getComputedStyle(el);
        const opacity = parseFloat(style.opacity);
        const text = el.textContent.trim();
        // Elements with opacity between 0.1 and 0.95, with meaningful text
        if (opacity > 0.1 && opacity < 0.95 && text.length > 10 && text.length < 300) {
          // Avoid duplicates from parent/child
          const parentOpacity = parseFloat(getComputedStyle(el.parentElement).opacity);
          if (Math.abs(opacity - parentOpacity) > 0.01 || el.children.length === 0) {
            found.push({
              text: text.substring(0, 60),
              opacity,
              tag: el.tagName,
              className: (el.className?.toString?.() || '').substring(0, 50),
            });
          }
        }
      }
      return found;
    });

    const at50 = interstitials.filter(e => e.opacity <= 0.55);
    const at60 = interstitials.filter(e => e.opacity >= 0.55 && e.opacity <= 0.65);
    const bumpedTo60 = at50.length === 0 && at60.length > 0;

    vpResults['fix6_opacity_60'] = {
      pass: bumpedTo60 || (at50.length === 0),
      detail: at60.length > 0
        ? `${at60.length} elements at ~60%: ${at60.slice(0, 2).map(e => `"${e.text.substring(0, 30)}…" @${(e.opacity * 100).toFixed(0)}%`).join('; ')}`
        : at50.length > 0
          ? `STILL ${at50.length} elements ≤50%: ${at50.slice(0, 2).map(e => `"${e.text.substring(0, 30)}…" @${(e.opacity * 100).toFixed(0)}%`).join('; ')}`
          : `No reduced-opacity interstitial text found (${interstitials.length} elements with any opacity)`,
    };
    console.log(`  Opacity ≥60%: ${vpResults['fix6_opacity_60'].pass ? '✅ PASS' : '❌ FAIL'} — ${vpResults['fix6_opacity_60'].detail}`);
  } catch (e) {
    vpResults['fix6_opacity_60'] = { pass: false, detail: e.message.substring(0, 80) };
    console.log(`  Opacity ≥60%: ❌ FAIL — ${e.message.substring(0, 80)}`);
  }

  // ═══════════════════════════════════════════════════
  // REGRESSION CHECKS
  // ═══════════════════════════════════════════════════
  console.log('\n── REGRESSION CHECKS ──');

  // Scroll through entire page to trigger lazy loading
  try {
    const totalHeight = await page.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y < totalHeight; y += vp.height * 0.8) {
      await page.evaluate((sy) => window.scrollTo(0, sy), y);
      await sleep(250);
    }
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(2000);

    // All images loaded
    const imgs = await page.evaluate(() => {
      const images = document.querySelectorAll('img');
      let total = 0, broken = 0;
      const brokenList = [];
      images.forEach(img => {
        total++;
        if (!img.complete || (img.naturalWidth === 0 && !img.src.startsWith('data:'))) {
          broken++;
          brokenList.push(img.src?.split('/').pop() || 'unknown');
        }
      });
      return { total, broken, brokenList: brokenList.slice(0, 5) };
    });
    vpResults['regression_images'] = {
      pass: imgs.broken === 0,
      detail: `${imgs.total} images, ${imgs.broken} broken${imgs.broken > 0 ? ': ' + imgs.brokenList.join(', ') : ''}`,
    };
    console.log(`  Images loaded: ${imgs.broken === 0 ? '✅ PASS' : '❌ FAIL'} — ${vpResults['regression_images'].detail}`);
  } catch (e) {
    vpResults['regression_images'] = { pass: false, detail: e.message.substring(0, 80) };
    console.log(`  Images loaded: ❌ FAIL — ${e.message.substring(0, 80)}`);
  }

  // Single-column grid
  try {
    await page.evaluate(() => window.scrollTo(0, window.innerHeight * 2));
    await sleep(500);
    const grid = await page.evaluate(() => {
      const imgs = document.querySelectorAll('img');
      let checked = 0, singleCol = true;
      for (const img of imgs) {
        const rect = img.getBoundingClientRect();
        if (rect.width > 80 && rect.height > 80) {
          checked++;
          if (rect.width < window.innerWidth * 0.7) { singleCol = false; }
          if (checked >= 6) break;
        }
      }
      return { checked, singleCol };
    });
    vpResults['regression_single_col'] = { pass: grid.singleCol, detail: `${grid.checked} imgs checked, singleCol=${grid.singleCol}` };
    console.log(`  Single-column: ${grid.singleCol ? '✅ PASS' : '❌ FAIL'} — ${vpResults['regression_single_col'].detail}`);
  } catch (e) {
    vpResults['regression_single_col'] = { pass: false, detail: e.message.substring(0, 80) };
  }

  // Lightbox opens on tap
  try {
    await page.evaluate(() => window.scrollTo(0, window.innerHeight * 2));
    await sleep(800);
    const lbClicked = await page.evaluate(() => {
      const links = document.querySelectorAll('a.glightbox, a[href$=".JPG"], a[href$=".webp"]');
      for (const a of links) {
        const rect = a.getBoundingClientRect();
        if (rect.width > 50 && rect.height > 50 && rect.top > -50 && rect.top < window.innerHeight + 50) {
          a.click();
          return true;
        }
      }
      return false;
    });
    if (lbClicked) {
      await sleep(1200);
      const lbOpen = await page.evaluate(() => {
        const container = document.querySelector('.glightbox-container, .goverlay');
        if (!container) return false;
        return getComputedStyle(container).display !== 'none';
      });
      vpResults['regression_lightbox'] = { pass: lbOpen, detail: `opened=${lbOpen}` };
      console.log(`  Lightbox opens: ${lbOpen ? '✅ PASS' : '❌ FAIL'}`);
      await page.keyboard.press('Escape');
      await sleep(500);
    } else {
      vpResults['regression_lightbox'] = { pass: false, detail: 'No gallery link found' };
      console.log(`  Lightbox opens: ⚠️ SKIP`);
    }
  } catch (e) {
    vpResults['regression_lightbox'] = { pass: false, detail: e.message.substring(0, 80) };
    console.log(`  Lightbox opens: ❌ FAIL — ${e.message.substring(0, 80)}`);
  }

  // Hero text
  try {
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(500);
    const hero = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      if (!h1) return { found: false };
      const rect = h1.getBoundingClientRect();
      const style = getComputedStyle(h1);
      return {
        found: true,
        text: h1.textContent.trim().substring(0, 40),
        visible: rect.width > 0 && rect.height > 0 && style.display !== 'none',
        fontSize: style.fontSize,
      };
    });
    vpResults['regression_hero'] = {
      pass: hero.found && hero.visible,
      detail: hero.found ? `"${hero.text}" visible=${hero.visible}, font=${hero.fontSize}` : 'No h1',
    };
    console.log(`  Hero text: ${vpResults['regression_hero'].pass ? '✅ PASS' : '❌ FAIL'} — ${vpResults['regression_hero'].detail}`);
  } catch (e) {
    vpResults['regression_hero'] = { pass: false, detail: e.message.substring(0, 80) };
  }

  // Scroll progress bar
  try {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await sleep(600);
    const progress = await page.evaluate(() => {
      const bar = document.querySelector('#progress, [id*="scroll-progress"], [class*="progress-bar"]');
      if (!bar) return { found: false };
      const style = getComputedStyle(bar);
      return { found: true, width: bar.style.width || style.width, id: bar.id, display: style.display };
    });
    vpResults['regression_progress'] = {
      pass: progress.found,
      detail: progress.found ? `id=${progress.id}, width=${progress.width}` : 'Not found',
    };
    console.log(`  Progress bar: ${progress.found ? '✅ PASS' : '❌ FAIL'} — ${vpResults['regression_progress'].detail}`);
  } catch (e) {
    vpResults['regression_progress'] = { pass: false, detail: e.message.substring(0, 80) };
  }

  // Preloader exists
  try {
    const preloader = await page.evaluate(() => {
      const p = document.getElementById('preloader');
      if (!p) return { exists: false };
      const s = getComputedStyle(p);
      return { exists: true, hidden: s.display === 'none' || s.opacity === '0' };
    });
    vpResults['regression_preloader'] = {
      pass: preloader.exists,
      detail: `exists=${preloader.exists}, hiddenAfterLoad=${preloader.hidden}`,
    };
    console.log(`  Preloader: ${preloader.exists ? '✅ PASS' : '❌ FAIL'} — ${vpResults['regression_preloader'].detail}`);
  } catch (e) {
    vpResults['regression_preloader'] = { pass: false, detail: e.message.substring(0, 80) };
  }

  // Console errors
  vpResults['regression_no_errors'] = {
    pass: consoleErrors.length === 0,
    detail: consoleErrors.length === 0 ? 'Clean' : `${consoleErrors.length} errors: ${consoleErrors.slice(0, 3).join(' | ').substring(0, 120)}`,
  };
  console.log(`  Console errors: ${consoleErrors.length === 0 ? '✅ PASS' : '❌ FAIL'} — ${vpResults['regression_no_errors'].detail}`);

  results[vp.name] = vpResults;
  await browser.close();
}

// ═══════════════════════════════════════════════════
// FINAL SUMMARY
// ═══════════════════════════════════════════════════
console.log(`\n\n${'═'.repeat(70)}`);
console.log('FINAL RESULTS');
console.log('═'.repeat(70));

let totalPass = 0, totalFail = 0;
for (const [vpName, vpRes] of Object.entries(results)) {
  console.log(`\n${vpName}:`);
  for (const [check, result] of Object.entries(vpRes)) {
    const icon = result.pass ? '✅' : '❌';
    console.log(`  ${icon} ${check}: ${result.detail}`);
    if (result.pass) totalPass++; else totalFail++;
  }
}
console.log(`\n${'─'.repeat(70)}`);
console.log(`TOTAL: ${totalPass} PASSED, ${totalFail} FAILED out of ${totalPass + totalFail} checks`);
console.log('─'.repeat(70));

const output = {
  status: totalFail === 0 ? 'completed' : 'completed_with_issues',
  summary: { totalPass, totalFail, total: totalPass + totalFail },
  viewports: results,
};
fs.writeFileSync(path.join(EVIDENCE_DIR, 'results.json'), JSON.stringify(output, null, 2));
