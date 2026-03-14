import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const URL = 'https://juliancodespoti.github.io/mocha/';
const EVIDENCE_DIR = path.resolve('test-results/mobile-regression/evidence');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const VIEWPORTS = [
  { name: 'iPhone14Pro', width: 393, height: 852, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1' },
  { name: 'GalaxyS21', width: 360, height: 800, ua: 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36' },
];

const results = {};

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForPageReady(page) {
  // Wait for preloader to finish
  try {
    await page.waitForFunction(() => {
      const preloader = document.getElementById('preloader');
      return !preloader || preloader.style.display === 'none' || preloader.style.opacity === '0' || getComputedStyle(preloader).opacity === '0' || getComputedStyle(preloader).display === 'none';
    }, { timeout: 15000 });
  } catch {
    console.log('  [WARN] Preloader may still be visible');
  }
  await sleep(2000);
}

for (const vp of VIEWPORTS) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TESTING: ${vp.name} (${vp.width}x${vp.height})`);
  console.log('='.repeat(60));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    userAgent: vp.ua,
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();

  // Collect console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(err.message));

  const vpResults = {};

  try {
    // Navigate
    console.log('\n→ Navigating to site...');
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
    await waitForPageReady(page);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, `${vp.name}_initial.png`) });

    // ═══════════════════════════════════════════════════
    // FIX 1: Mobile Nav Overflow
    // ═══════════════════════════════════════════════════
    console.log('\n── FIX 1: Mobile Nav Overflow ──');

    // 1a: No horizontal overflow
    const overflow = await page.evaluate(() => {
      return {
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        hasOverflow: document.documentElement.scrollWidth > window.innerWidth,
      };
    });
    vpResults['fix1_no_overflow'] = {
      pass: !overflow.hasOverflow,
      detail: `scrollWidth=${overflow.scrollWidth}, innerWidth=${overflow.innerWidth}`,
    };
    console.log(`  No overflow: ${!overflow.hasOverflow ? '✅ PASS' : '❌ FAIL'} (${overflow.scrollWidth} vs ${overflow.innerWidth})`);

    // 1b: Hamburger button visible
    const hamburger = await page.evaluate(() => {
      // Look for the hamburger button
      const btns = document.querySelectorAll('button');
      for (const btn of btns) {
        const rect = btn.getBoundingClientRect();
        const style = getComputedStyle(btn);
        const text = btn.textContent.trim().toLowerCase();
        const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
        const id = (btn.id || '').toLowerCase();
        // Check if it's likely a hamburger (has 3 lines/bars, or aria-label mentions menu/nav)
        if (ariaLabel.includes('menu') || ariaLabel.includes('nav') || id.includes('menu') || id.includes('hamburger') || id.includes('mobile')) {
          return {
            found: true,
            visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            ariaLabel: btn.getAttribute('aria-label'),
            id: btn.id,
          };
        }
      }
      // Fallback: look for any button that has svg/path children suggesting a hamburger icon
      for (const btn of btns) {
        const svg = btn.querySelector('svg');
        if (svg) {
          const rect = btn.getBoundingClientRect();
          const style = getComputedStyle(btn);
          if (rect.width > 0 && rect.width < 80 && rect.y < 100) {
            return {
              found: true,
              visible: style.display !== 'none' && style.visibility !== 'hidden',
              rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              ariaLabel: btn.getAttribute('aria-label'),
              id: btn.id,
            };
          }
        }
      }
      return { found: false };
    });
    vpResults['fix1_hamburger_visible'] = {
      pass: hamburger.found && hamburger.visible,
      detail: hamburger.found ? `Found at (${Math.round(hamburger.rect?.x)},${Math.round(hamburger.rect?.y)}), size ${Math.round(hamburger.rect?.width)}x${Math.round(hamburger.rect?.height)}, aria-label="${hamburger.ariaLabel}"` : 'NOT FOUND',
    };
    console.log(`  Hamburger visible: ${hamburger.found && hamburger.visible ? '✅ PASS' : '❌ FAIL'} - ${vpResults['fix1_hamburger_visible'].detail}`);

    // 1c: Inline nav hidden
    const inlineNavHidden = await page.evaluate(() => {
      const navLinks = document.querySelectorAll('header nav a, header .nav-links a');
      let hiddenCount = 0;
      let totalCount = 0;
      navLinks.forEach(a => {
        totalCount++;
        const style = getComputedStyle(a);
        const parentStyle = getComputedStyle(a.parentElement);
        if (style.display === 'none' || parentStyle.display === 'none' || 
            style.visibility === 'hidden' || parentStyle.visibility === 'hidden') {
          hiddenCount++;
        }
      });
      return { hiddenCount, totalCount };
    });
    vpResults['fix1_inline_nav_hidden'] = {
      pass: inlineNavHidden.hiddenCount > 0 || inlineNavHidden.totalCount === 0,
      detail: `${inlineNavHidden.hiddenCount}/${inlineNavHidden.totalCount} inline nav links hidden`,
    };
    console.log(`  Inline nav hidden: ${vpResults['fix1_inline_nav_hidden'].pass ? '✅ PASS' : '❌ FAIL'} - ${vpResults['fix1_inline_nav_hidden'].detail}`);

    // 1d: Tap hamburger, menu opens with 3 links
    if (hamburger.found) {
      // Find and click the hamburger
      const hamburgerSelector = hamburger.id ? `#${hamburger.id}` : hamburger.ariaLabel ? `button[aria-label="${hamburger.ariaLabel}"]` : 'button:has(svg)';
      try {
        await page.click(hamburgerSelector, { timeout: 3000 });
        await sleep(500);
        await page.screenshot({ path: path.join(EVIDENCE_DIR, `${vp.name}_menu_open.png`) });

        const menuState = await page.evaluate(() => {
          // Look for visible nav links in mobile menu
          const allLinks = document.querySelectorAll('a');
          const menuLinks = [];
          for (const a of allLinks) {
            const text = a.textContent.trim().toLowerCase();
            if (['portraits', 'adventures', 'cozy moments', 'cozy'].some(t => text.includes(t))) {
              const rect = a.getBoundingClientRect();
              const style = getComputedStyle(a);
              if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden') {
                menuLinks.push({
                  text: a.textContent.trim(),
                  rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                });
              }
            }
          }
          return { linkCount: menuLinks.length, links: menuLinks };
        });

        vpResults['fix1_menu_has_3_links'] = {
          pass: menuState.linkCount >= 3,
          detail: `Found ${menuState.linkCount} links: ${menuState.links.map(l => l.text).join(', ')}`,
        };
        console.log(`  Menu has 3 links: ${menuState.linkCount >= 3 ? '✅ PASS' : '❌ FAIL'} - ${vpResults['fix1_menu_has_3_links'].detail}`);

        // 1e: Check hamburger animates to X
        const isX = await page.evaluate((sel) => {
          const btn = document.querySelector(sel);
          if (!btn) return { checked: false };
          // Check for common X patterns: rotated lines, 'open' class, aria-expanded
          const expanded = btn.getAttribute('aria-expanded');
          const hasOpenClass = btn.classList.contains('open') || btn.closest('[class*="open"]');
          const spans = btn.querySelectorAll('span');
          let hasRotation = false;
          spans.forEach(s => {
            const transform = getComputedStyle(s).transform;
            if (transform && transform !== 'none') hasRotation = true;
          });
          return { expanded, hasOpenClass: !!hasOpenClass, hasRotation, checked: true };
        }, hamburgerSelector);
        vpResults['fix1_hamburger_to_x'] = {
          pass: isX.expanded === 'true' || isX.hasOpenClass || isX.hasRotation,
          detail: `expanded=${isX.expanded}, openClass=${isX.hasOpenClass}, rotation=${isX.hasRotation}`,
        };
        console.log(`  Hamburger → X: ${vpResults['fix1_hamburger_to_x'].pass ? '✅ PASS' : '❌ FAIL'} - ${vpResults['fix1_hamburger_to_x'].detail}`);

        // 1f: Tap link scrolls to section AND closes menu
        if (menuState.linkCount > 0) {
          const firstLinkText = menuState.links[0].text;
          await page.click(`a:visible:text("${firstLinkText}")`, { timeout: 3000 });
          await sleep(1500);
          
          const afterClick = await page.evaluate((linkText) => {
            // Check if page scrolled (not at top)
            const scrollY = window.scrollY;
            // Check if menu is closed (look for the mobile menu container)
            const menuContainer = document.querySelector('[class*="mobile-menu"], [id*="mobile-menu"], nav[class*="open"], [data-menu]');
            let menuVisible = false;
            if (menuContainer) {
              const style = getComputedStyle(menuContainer);
              menuVisible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
            }
            // Also check if hamburger is no longer expanded
            const btns = document.querySelectorAll('button');
            let hamburgerExpanded = false;
            for (const btn of btns) {
              if (btn.getAttribute('aria-expanded') === 'true') hamburgerExpanded = true;
            }
            return { scrollY, menuVisible, hamburgerExpanded };
          }, firstLinkText);

          vpResults['fix1_link_scrolls_and_closes'] = {
            pass: afterClick.scrollY > 50 && !afterClick.hamburgerExpanded,
            detail: `scrollY=${Math.round(afterClick.scrollY)}, menuVisible=${afterClick.menuVisible}, expanded=${afterClick.hamburgerExpanded}`,
          };
          console.log(`  Link scrolls & closes: ${vpResults['fix1_link_scrolls_and_closes'].pass ? '✅ PASS' : '❌ FAIL'} - ${vpResults['fix1_link_scrolls_and_closes'].detail}`);
        }

        // Scroll back to top for more tests
        await page.evaluate(() => window.scrollTo(0, 0));
        await sleep(500);
      } catch (e) {
        vpResults['fix1_menu_interaction'] = { pass: false, detail: `Error: ${e.message}` };
        console.log(`  Menu interaction: ❌ FAIL - ${e.message}`);
      }
    }

    // ═══════════════════════════════════════════════════
    // FIX 2: Touch Targets
    // ═══════════════════════════════════════════════════
    console.log('\n── FIX 2: Touch Targets ──');

    // Open hamburger menu again to check link sizes
    if (hamburger.found) {
      const hamburgerSelector = hamburger.id ? `#${hamburger.id}` : hamburger.ariaLabel ? `button[aria-label="${hamburger.ariaLabel}"]` : 'button:has(svg)';
      
      // Check if menu is already open
      const menuOpen = await page.evaluate(() => {
        const btns = document.querySelectorAll('button');
        for (const btn of btns) {
          if (btn.getAttribute('aria-expanded') === 'true') return true;
        }
        return false;
      });
      
      if (!menuOpen) {
        await page.click(hamburgerSelector, { timeout: 3000 });
        await sleep(500);
      }

      const touchTargets = await page.evaluate(() => {
        const allLinks = document.querySelectorAll('a');
        const mobileMenuLinks = [];
        for (const a of allLinks) {
          const text = a.textContent.trim().toLowerCase();
          if (['portraits', 'adventures', 'cozy moments', 'cozy'].some(t => text.includes(t))) {
            const rect = a.getBoundingClientRect();
            const style = getComputedStyle(a);
            if (rect.width > 0 && rect.height > 0 && style.display !== 'none') {
              mobileMenuLinks.push({
                text: a.textContent.trim(),
                height: rect.height,
                width: rect.width,
              });
            }
          }
        }
        return mobileMenuLinks;
      });

      const allAbove44 = touchTargets.every(l => l.height >= 44);
      vpResults['fix2_menu_links_44px'] = {
        pass: allAbove44,
        detail: touchTargets.map(l => `"${l.text}": ${Math.round(l.height)}px`).join(', '),
      };
      console.log(`  Menu links ≥44px: ${allAbove44 ? '✅ PASS' : '❌ FAIL'} - ${vpResults['fix2_menu_links_44px'].detail}`);

      // Close menu
      await page.click(hamburgerSelector, { timeout: 3000 });
      await sleep(500);
    }

    // Check footer link sizes
    const footerLinks = await page.evaluate(() => {
      const footer = document.querySelector('footer');
      if (!footer) return [];
      const links = footer.querySelectorAll('a');
      return Array.from(links).map(a => {
        const rect = a.getBoundingClientRect();
        return { text: a.textContent.trim().substring(0, 30), height: rect.height, width: rect.width };
      }).filter(l => l.height > 0);
    });
    
    // Scroll to footer to measure
    await page.evaluate(() => {
      const footer = document.querySelector('footer');
      if (footer) footer.scrollIntoView();
    });
    await sleep(1000);
    
    const footerLinksAfterScroll = await page.evaluate(() => {
      const footer = document.querySelector('footer');
      if (!footer) return [];
      const links = footer.querySelectorAll('a');
      return Array.from(links).map(a => {
        const rect = a.getBoundingClientRect();
        return { text: a.textContent.trim().substring(0, 30), height: rect.height, width: rect.width };
      }).filter(l => l.height > 0);
    });
    
    const footerAbove36 = footerLinksAfterScroll.length > 0 && footerLinksAfterScroll.every(l => l.height >= 36);
    vpResults['fix2_footer_links_36px'] = {
      pass: footerAbove36,
      detail: footerLinksAfterScroll.map(l => `"${l.text}": ${Math.round(l.height)}px`).join(', ') || 'No footer links found',
    };
    console.log(`  Footer links ≥36px: ${footerAbove36 ? '✅ PASS' : '❌ FAIL'} - ${vpResults['fix2_footer_links_36px'].detail}`);

    // Scroll back to top
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(500);

    // ═══════════════════════════════════════════════════
    // FIX 3: Lightbox Close Button
    // ═══════════════════════════════════════════════════
    console.log('\n── FIX 3: Lightbox Close Button ──');

    // Find and click first gallery image
    const firstImage = await page.evaluate(() => {
      const galleryLinks = document.querySelectorAll('a.glightbox, [data-gallery] a, .gallery a, a[href$=".JPG"], a[href$=".jpg"]');
      for (const a of galleryLinks) {
        const rect = a.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight * 3) {
          return { found: true, x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
        }
      }
      // Fallback: any image link
      const imgs = document.querySelectorAll('img');
      for (const img of imgs) {
        const parent = img.closest('a');
        if (parent) {
          const rect = parent.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            return { found: true, selector: `a[href="${parent.getAttribute('href')}"]` };
          }
        }
      }
      return { found: false };
    });

    // Scroll down to find a gallery image
    await page.evaluate(() => window.scrollTo(0, window.innerHeight * 1.5));
    await sleep(1000);

    try {
      const galleryImage = await page.evaluate(() => {
        const links = document.querySelectorAll('a.glightbox, a[href$=".JPG"], a[href$=".jpg"], a[href$=".webp"]');
        for (const a of links) {
          const rect = a.getBoundingClientRect();
          if (rect.width > 50 && rect.height > 50 && rect.top > 0 && rect.top < window.innerHeight) {
            return { found: true, href: a.getAttribute('href') };
          }
        }
        return { found: false };
      });

      if (galleryImage.found) {
        await page.click(`a[href="${galleryImage.href}"]`, { timeout: 3000 });
        await sleep(1500);
        await page.screenshot({ path: path.join(EVIDENCE_DIR, `${vp.name}_lightbox.png`) });

        const closeBtn = await page.evaluate(() => {
          const closeBtns = document.querySelectorAll('.gclose, .glightbox-close, button[aria-label="Close"], .gslide-media ~ button, .gbtn.gbtn-close');
          for (const btn of closeBtns) {
            const rect = btn.getBoundingClientRect();
            const style = getComputedStyle(btn);
            if (rect.width > 0) {
              return {
                found: true,
                width: rect.width,
                height: rect.height,
                minWidth: parseFloat(style.minWidth) || rect.width,
                minHeight: parseFloat(style.minHeight) || rect.height,
              };
            }
          }
          // Broader search
          const allBtns = document.querySelectorAll('button, [role="button"]');
          for (const btn of allBtns) {
            const rect = btn.getBoundingClientRect();
            const cls = btn.className || '';
            if (cls.includes('close') || cls.includes('gclose')) {
              return {
                found: true,
                width: rect.width,
                height: rect.height,
                className: cls,
              };
            }
          }
          return { found: false };
        });

        vpResults['fix3_close_btn_44px'] = {
          pass: closeBtn.found && closeBtn.width >= 44 && closeBtn.height >= 44,
          detail: closeBtn.found ? `${Math.round(closeBtn.width)}x${Math.round(closeBtn.height)}px` : 'Close button NOT FOUND',
        };
        console.log(`  Close btn ≥44px: ${vpResults['fix3_close_btn_44px'].pass ? '✅ PASS' : '❌ FAIL'} - ${vpResults['fix3_close_btn_44px'].detail}`);

        // Close lightbox
        try {
          await page.keyboard.press('Escape');
          await sleep(500);
        } catch {}
      } else {
        vpResults['fix3_close_btn_44px'] = { pass: false, detail: 'No gallery image found to test' };
        console.log('  Close btn ≥44px: ⚠️ SKIP - No gallery image found');
      }
    } catch (e) {
      vpResults['fix3_close_btn_44px'] = { pass: false, detail: `Error: ${e.message}` };
      console.log(`  Close btn ≥44px: ❌ FAIL - ${e.message}`);
    }

    // ═══════════════════════════════════════════════════
    // FIX 4: Hover Rules
    // ═══════════════════════════════════════════════════
    console.log('\n── FIX 4: Hover Rules ──');

    // Check CSS for @media (hover: hover) guard
    const hoverGuard = await page.evaluate(() => {
      const sheets = document.styleSheets;
      let unguardedHoverRules = 0;
      let guardedHoverRules = 0;
      let glightboxUnguarded = 0;
      
      try {
        for (const sheet of sheets) {
          try {
            const rules = sheet.cssRules || sheet.rules;
            for (const rule of rules) {
              const ruleText = rule.cssText || '';
              if (rule.type === CSSRule.MEDIA_RULE && rule.conditionText && rule.conditionText.includes('hover: hover')) {
                // Count hover rules inside media guard
                for (const inner of rule.cssRules) {
                  if (inner.selectorText && inner.selectorText.includes(':hover')) {
                    guardedHoverRules++;
                  }
                }
              } else if (rule.selectorText && rule.selectorText.includes(':hover')) {
                unguardedHoverRules++;
              }
            }
          } catch (e) {
            // Cross-origin stylesheet, skip
          }
        }
      } catch (e) {}
      
      return { unguardedHoverRules, guardedHoverRules };
    });
    
    // For local CSS, check specifically
    const localHoverCheck = await page.evaluate(() => {
      const styleElements = document.querySelectorAll('style');
      let localUnguarded = 0;
      let localGuarded = 0;
      for (const style of styleElements) {
        const text = style.textContent;
        // Count :hover outside of @media (hover: hover) blocks
        const hoverMatches = text.match(/:hover/g);
        const mediaHoverMatches = text.match(/@media\s*\(\s*hover:\s*hover\s*\)/g);
        if (hoverMatches) localUnguarded += hoverMatches.length;
        if (mediaHoverMatches) localGuarded += mediaHoverMatches.length;
      }
      return { localUnguarded, localGuarded };
    });

    vpResults['fix4_hover_guarded'] = {
      pass: localHoverCheck.localGuarded > 0 || hoverGuard.guardedHoverRules > 0,
      detail: `Local: ${localHoverCheck.localGuarded} guarded, CSSOM: ${hoverGuard.guardedHoverRules} guarded / ${hoverGuard.unguardedHoverRules} unguarded`,
    };
    console.log(`  Hover rules guarded: ${vpResults['fix4_hover_guarded'].pass ? '✅ PASS' : '❌ FAIL'} - ${vpResults['fix4_hover_guarded'].detail}`);

    // ═══════════════════════════════════════════════════
    // FIX 5: Duplicate h1
    // ═══════════════════════════════════════════════════
    console.log('\n── FIX 5: Duplicate h1 ──');

    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(500);

    const h1Count = await page.evaluate(() => {
      const h1s = document.querySelectorAll('h1');
      return {
        count: h1s.length,
        texts: Array.from(h1s).map(h => ({ text: h.textContent.trim().substring(0, 50), tag: h.tagName })),
      };
    });
    vpResults['fix5_single_h1'] = {
      pass: h1Count.count === 1,
      detail: `Found ${h1Count.count} h1(s): ${h1Count.texts.map(t => `"${t.text}"`).join(', ')}`,
    };
    console.log(`  Single h1: ${h1Count.count === 1 ? '✅ PASS' : '❌ FAIL'} - ${vpResults['fix5_single_h1'].detail}`);

    // Check preloader uses div with aria-hidden
    const preloaderCheck = await page.evaluate(() => {
      const preloader = document.getElementById('preloader');
      if (!preloader) return { found: false };
      const heading = preloader.querySelector('h1, h2, h3, h4, h5, h6');
      const divHeading = preloader.querySelector('div[aria-hidden="true"]');
      return {
        found: true,
        hasHeadingTag: !!heading,
        headingTag: heading?.tagName,
        hasAriaHiddenDiv: !!divHeading,
      };
    });
    vpResults['fix5_preloader_no_heading'] = {
      pass: !preloaderCheck.hasHeadingTag || !preloaderCheck.found,
      detail: preloaderCheck.found 
        ? `hasHeadingTag=${preloaderCheck.hasHeadingTag}, hasAriaHiddenDiv=${preloaderCheck.hasAriaHiddenDiv}` 
        : 'Preloader not found (may be removed after load)',
    };
    console.log(`  Preloader no heading: ${vpResults['fix5_preloader_no_heading'].pass ? '✅ PASS' : '❌ FAIL'} - ${vpResults['fix5_preloader_no_heading'].detail}`);

    // ═══════════════════════════════════════════════════
    // FIX 6: Interstitial Opacity
    // ═══════════════════════════════════════════════════
    console.log('\n── FIX 6: Interstitial Opacity ──');

    const interstitialOpacity = await page.evaluate(() => {
      // Find interstitial/divider text between gallery sections
      const candidates = document.querySelectorAll('[class*="interstitial"], [class*="divider"], .section-divider, blockquote, .quote');
      const results = [];
      
      // Also look for text with reduced opacity
      const allElements = document.querySelectorAll('p, span, div, blockquote');
      for (const el of allElements) {
        const style = getComputedStyle(el);
        const opacity = parseFloat(style.opacity);
        const text = el.textContent.trim();
        if (opacity > 0 && opacity < 1 && text.length > 10 && text.length < 200) {
          results.push({
            text: text.substring(0, 60),
            opacity,
            tag: el.tagName,
            className: el.className?.substring?.(0, 40) || '',
          });
        }
      }
      
      // Also check for opacity in parent elements
      for (const el of candidates) {
        const style = getComputedStyle(el);
        results.push({
          text: el.textContent.trim().substring(0, 60),
          opacity: parseFloat(style.opacity),
          tag: el.tagName,
          className: el.className?.substring?.(0, 40) || '',
        });
      }
      
      return results;
    });

    // Filter for likely interstitial elements (opacity between 0.5 and 0.7)
    const interstitialElements = interstitialOpacity.filter(e => e.opacity >= 0.55 && e.opacity <= 0.65);
    const below50 = interstitialOpacity.filter(e => e.opacity > 0 && e.opacity <= 0.5);
    
    vpResults['fix6_interstitial_opacity'] = {
      pass: interstitialElements.length > 0 || below50.length === 0,
      detail: interstitialElements.length > 0 
        ? `Found ${interstitialElements.length} elements at ~60% opacity: ${interstitialElements.slice(0, 2).map(e => `"${e.text}" @${e.opacity}`).join(', ')}`
        : below50.length > 0 
          ? `Found ${below50.length} elements still at ≤50% opacity` 
          : 'No reduced-opacity text found (may use different approach)',
    };
    console.log(`  Interstitial ≥60%: ${vpResults['fix6_interstitial_opacity'].pass ? '✅ PASS' : '❌ FAIL'} - ${vpResults['fix6_interstitial_opacity'].detail}`);

    // ═══════════════════════════════════════════════════
    // REGRESSION: No Broken Images
    // ═══════════════════════════════════════════════════
    console.log('\n── REGRESSION CHECKS ──');

    // Scroll through entire page to trigger lazy loading
    const pageHeight = await page.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y < pageHeight; y += vp.height) {
      await page.evaluate((scrollY) => window.scrollTo(0, scrollY), y);
      await sleep(300);
    }
    await sleep(2000);

    const imageCheck = await page.evaluate(() => {
      const imgs = document.querySelectorAll('img');
      let total = 0;
      let broken = 0;
      const brokenList = [];
      imgs.forEach(img => {
        total++;
        if (!img.complete || img.naturalWidth === 0) {
          broken++;
          brokenList.push(img.src?.substring(img.src.lastIndexOf('/') + 1) || 'unknown');
        }
      });
      return { total, broken, brokenList };
    });
    vpResults['regression_no_broken_images'] = {
      pass: imageCheck.broken === 0,
      detail: `${imageCheck.total} images, ${imageCheck.broken} broken${imageCheck.broken > 0 ? ': ' + imageCheck.brokenList.join(', ') : ''}`,
    };
    console.log(`  No broken images: ${imageCheck.broken === 0 ? '✅ PASS' : '❌ FAIL'} - ${vpResults['regression_no_broken_images'].detail}`);

    // ═══════════════════════════════════════════════════
    // REGRESSION: Single-column grid on mobile
    // ═══════════════════════════════════════════════════
    const gridCheck = await page.evaluate(() => {
      const galleries = document.querySelectorAll('[class*="gallery"], [class*="grid"], .columns-1');
      const results = [];
      galleries.forEach(g => {
        const style = getComputedStyle(g);
        results.push({
          className: g.className?.substring?.(0, 60) || '',
          columns: style.columnCount || style.gridTemplateColumns || 'N/A',
          display: style.display,
        });
      });
      // Also check: are gallery images full-width?
      const galleryImgs = document.querySelectorAll('img');
      let singleCol = true;
      let checked = 0;
      for (const img of galleryImgs) {
        const rect = img.getBoundingClientRect();
        if (rect.width > 100 && rect.height > 100) {
          checked++;
          // On single-column, images should be nearly full-width
          if (rect.width < window.innerWidth * 0.6) {
            singleCol = false;
          }
          if (checked >= 5) break;
        }
      }
      return { galleries: results, singleCol, checked };
    });
    vpResults['regression_single_column'] = {
      pass: gridCheck.singleCol,
      detail: `${gridCheck.checked} images checked, singleCol=${gridCheck.singleCol}`,
    };
    console.log(`  Single-column grid: ${gridCheck.singleCol ? '✅ PASS' : '❌ FAIL'} - ${vpResults['regression_single_column'].detail}`);

    // ═══════════════════════════════════════════════════
    // REGRESSION: Lightbox opens on tap
    // ═══════════════════════════════════════════════════
    await page.evaluate(() => window.scrollTo(0, window.innerHeight * 1.5));
    await sleep(1000);
    
    try {
      const galleryImg2 = await page.evaluate(() => {
        const links = document.querySelectorAll('a.glightbox, a[href$=".JPG"], a[href$=".jpg"], a[href$=".webp"]');
        for (const a of links) {
          const rect = a.getBoundingClientRect();
          if (rect.width > 50 && rect.height > 50 && rect.top > 0 && rect.top < window.innerHeight) {
            return { found: true, href: a.getAttribute('href') };
          }
        }
        return { found: false };
      });

      if (galleryImg2.found) {
        await page.click(`a[href="${galleryImg2.href}"]`, { timeout: 3000 });
        await sleep(1000);
        
        const lightboxOpen = await page.evaluate(() => {
          const lb = document.querySelector('.glightbox-container, .goverlay, .gslide');
          return !!lb && getComputedStyle(lb).display !== 'none';
        });
        vpResults['regression_lightbox_opens'] = { pass: lightboxOpen, detail: `lightbox opened: ${lightboxOpen}` };
        console.log(`  Lightbox opens: ${lightboxOpen ? '✅ PASS' : '❌ FAIL'}`);

        await page.keyboard.press('Escape');
        await sleep(500);
      } else {
        vpResults['regression_lightbox_opens'] = { pass: false, detail: 'No gallery image found' };
      }
    } catch (e) {
      vpResults['regression_lightbox_opens'] = { pass: false, detail: e.message };
      console.log(`  Lightbox opens: ❌ FAIL - ${e.message}`);
    }

    // ═══════════════════════════════════════════════════
    // REGRESSION: Hero text displays correctly
    // ═══════════════════════════════════════════════════
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(500);

    const heroCheck = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      if (!h1) return { found: false };
      const rect = h1.getBoundingClientRect();
      const style = getComputedStyle(h1);
      return {
        found: true,
        text: h1.textContent.trim(),
        visible: rect.width > 0 && rect.height > 0 && style.display !== 'none',
        fontSize: style.fontSize,
        withinViewport: rect.top >= 0 && rect.bottom <= window.innerHeight,
      };
    });
    vpResults['regression_hero_text'] = {
      pass: heroCheck.found && heroCheck.visible,
      detail: heroCheck.found ? `"${heroCheck.text}" visible=${heroCheck.visible}, fontSize=${heroCheck.fontSize}` : 'No h1 found',
    };
    console.log(`  Hero text: ${vpResults['regression_hero_text'].pass ? '✅ PASS' : '❌ FAIL'} - ${vpResults['regression_hero_text'].detail}`);

    // ═══════════════════════════════════════════════════
    // REGRESSION: Scroll progress bar
    // ═══════════════════════════════════════════════════
    const progressBar = await page.evaluate(() => {
      const bar = document.querySelector('[class*="progress"], #progress, [id*="scroll-progress"]');
      return bar ? { found: true, id: bar.id, className: bar.className?.substring?.(0, 40) } : { found: false };
    });
    
    // Scroll down to trigger progress
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await sleep(500);
    
    const progressAfterScroll = await page.evaluate(() => {
      const bar = document.querySelector('[class*="progress"], #progress, [id*="scroll-progress"]');
      if (!bar) return { found: false };
      const style = getComputedStyle(bar);
      return {
        found: true,
        width: bar.style.width || style.width,
        display: style.display,
        opacity: style.opacity,
      };
    });
    vpResults['regression_scroll_progress'] = {
      pass: progressBar.found || progressAfterScroll.found,
      detail: progressAfterScroll.found ? `width=${progressAfterScroll.width}, display=${progressAfterScroll.display}` : 'Progress bar not found',
    };
    console.log(`  Scroll progress: ${vpResults['regression_scroll_progress'].pass ? '✅ PASS' : '❌ FAIL'} - ${vpResults['regression_scroll_progress'].detail}`);

    // ═══════════════════════════════════════════════════
    // REGRESSION: Console errors
    // ═══════════════════════════════════════════════════
    vpResults['regression_no_console_errors'] = {
      pass: consoleErrors.length === 0,
      detail: consoleErrors.length === 0 ? 'No errors' : `${consoleErrors.length} errors: ${consoleErrors.slice(0, 3).join(' | ')}`,
    };
    console.log(`  No console errors: ${consoleErrors.length === 0 ? '✅ PASS' : '❌ FAIL'} - ${vpResults['regression_no_console_errors'].detail}`);

    // ═══════════════════════════════════════════════════
    // REGRESSION: Preloader works
    // ═══════════════════════════════════════════════════
    const preloaderExists = await page.evaluate(() => {
      const p = document.getElementById('preloader');
      return {
        exists: !!p,
        hidden: p ? (getComputedStyle(p).display === 'none' || getComputedStyle(p).opacity === '0' || p.style.display === 'none') : true,
      };
    });
    vpResults['regression_preloader'] = {
      pass: preloaderExists.exists,
      detail: `exists=${preloaderExists.exists}, hidden=${preloaderExists.hidden} (should be hidden after load)`,
    };
    console.log(`  Preloader: ${preloaderExists.exists ? '✅ PASS' : '❌ FAIL'} - ${vpResults['regression_preloader'].detail}`);

  } catch (e) {
    console.error(`CRITICAL ERROR: ${e.message}`);
    vpResults['critical_error'] = { pass: false, detail: e.message };
  }

  results[vp.name] = vpResults;
  await browser.close();
}

// ═══════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════
console.log('\n\n' + '═'.repeat(70));
console.log('FINAL RESULTS SUMMARY');
console.log('═'.repeat(70));

const output = { status: 'completed', viewports: {} };
let totalPass = 0, totalFail = 0;

for (const [vpName, vpResults] of Object.entries(results)) {
  console.log(`\n${vpName}:`);
  output.viewports[vpName] = {};
  for (const [check, result] of Object.entries(vpResults)) {
    const icon = result.pass ? '✅' : '❌';
    console.log(`  ${icon} ${check}: ${result.detail}`);
    output.viewports[vpName][check] = result;
    if (result.pass) totalPass++;
    else totalFail++;
  }
}

console.log(`\n${'─'.repeat(70)}`);
console.log(`TOTAL: ${totalPass} passed, ${totalFail} failed out of ${totalPass + totalFail} checks`);
console.log('─'.repeat(70));

output.summary = { totalPass, totalFail, total: totalPass + totalFail };
fs.writeFileSync(path.join(EVIDENCE_DIR, 'results.json'), JSON.stringify(output, null, 2));
console.log(`\nResults saved to ${path.join(EVIDENCE_DIR, 'results.json')}`);
