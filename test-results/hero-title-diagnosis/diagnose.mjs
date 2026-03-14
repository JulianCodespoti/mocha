import { chromium } from 'playwright';
import { join } from 'path';

const EVIDENCE_DIR = '/home/domjules/Coding/mocha/test-results/hero-title-diagnosis';
const URL = 'https://juliancodespoti.github.io/mocha/';

async function diagnose(viewport, label) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TESTING: ${label} (${viewport.width}x${viewport.height})`);
  console.log('='.repeat(60));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: label.includes('mobile') ? 3 : 2,
  });
  const page = await context.newPage();

  // Collect console messages
  const consoleMsgs = [];
  page.on('console', msg => consoleMsgs.push({ type: msg.type(), text: msg.text() }));
  page.on('pageerror', err => consoleMsgs.push({ type: 'error', text: err.message }));

  // Navigate
  console.log('\n[1] Navigating to page...');
  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });

  // Screenshot immediately (during preloader)
  console.log('[2] Capturing preloader screenshot...');
  await page.screenshot({ path: join(EVIDENCE_DIR, `${label}-01-preloader.png`), fullPage: false });

  // Wait for preloader to finish (5 seconds)
  console.log('[3] Waiting 6s for preloader + hero reveal to finish...');
  await page.waitForTimeout(6000);

  // Screenshot after hero reveal
  console.log('[4] Capturing post-reveal screenshot...');
  await page.screenshot({ path: join(EVIDENCE_DIR, `${label}-02-post-reveal.png`), fullPage: false });

  // Screenshot just the hero title area
  console.log('[5] Capturing hero title close-up...');
  const titleEl = page.locator('.hero-title');
  try {
    await titleEl.screenshot({ path: join(EVIDENCE_DIR, `${label}-03-title-closeup.png`) });
  } catch (e) {
    console.log(`   Warning: Could not screenshot title element: ${e.message}`);
  }

  // Run JavaScript diagnostics
  console.log('\n[6] Running JavaScript diagnostics...');
  const diagnostics = await page.evaluate(() => {
    const results = {};

    // Check each char element
    const chars = document.querySelectorAll('.hero-title .char');
    results.charCount = chars.length;
    results.chars = [];
    chars.forEach((c, i) => {
      const style = getComputedStyle(c);
      const rect = c.getBoundingClientRect();
      results.chars.push({
        index: i,
        text: c.textContent,
        opacity: style.opacity,
        transform: style.transform,
        display: style.display,
        visibility: style.visibility,
        rect: { left: Math.round(rect.left*10)/10, right: Math.round(rect.right*10)/10, top: Math.round(rect.top*10)/10, bottom: Math.round(rect.bottom*10)/10, width: Math.round(rect.width*10)/10, height: Math.round(rect.height*10)/10 }
      });
    });

    // Check h1 dimensions and overflow
    const h1 = document.querySelector('.hero-title');
    if (h1) {
      const h1Rect = h1.getBoundingClientRect();
      const h1Style = getComputedStyle(h1);
      results.h1 = {
        width: Math.round(h1Rect.width*10)/10,
        height: Math.round(h1Rect.height*10)/10,
        overflow: h1Style.overflow,
        overflowX: h1Style.overflowX,
        overflowY: h1Style.overflowY,
        letterSpacing: h1Style.letterSpacing,
        fontSize: h1Style.fontSize,
        textAlign: h1Style.textAlign,
        paddingRight: h1Style.paddingRight,
        rect: { left: Math.round(h1Rect.left*10)/10, right: Math.round(h1Rect.right*10)/10, top: Math.round(h1Rect.top*10)/10, bottom: Math.round(h1Rect.bottom*10)/10 }
      };

      // Check clipping
      results.clipping = [];
      chars.forEach((c, i) => {
        const cRect = c.getBoundingClientRect();
        const issues = [];
        if (cRect.right > h1Rect.right + 0.5) issues.push(`right edge (${cRect.right.toFixed(1)}) exceeds h1 right (${h1Rect.right.toFixed(1)}) by ${(cRect.right - h1Rect.right).toFixed(1)}px`);
        if (cRect.bottom > h1Rect.bottom + 0.5) issues.push(`bottom edge (${cRect.bottom.toFixed(1)}) exceeds h1 bottom (${h1Rect.bottom.toFixed(1)}) by ${(cRect.bottom - h1Rect.bottom).toFixed(1)}px`);
        if (cRect.left < h1Rect.left - 0.5) issues.push(`left edge (${cRect.left.toFixed(1)}) before h1 left (${h1Rect.left.toFixed(1)}) by ${(h1Rect.left - cRect.left).toFixed(1)}px`);
        if (cRect.top < h1Rect.top - 0.5) issues.push(`top edge (${cRect.top.toFixed(1)}) above h1 top (${h1Rect.top.toFixed(1)}) by ${(h1Rect.top - cRect.top).toFixed(1)}px`);
        if (issues.length > 0) {
          results.clipping.push({ char: c.textContent, index: i, issues });
        }
      });
    }

    // Check preloader state
    const preloader = document.getElementById('preloader');
    if (preloader) {
      results.preloader = {
        display: preloader.style.display,
        computedDisplay: getComputedStyle(preloader).display,
        opacity: getComputedStyle(preloader).opacity,
        pointerEvents: getComputedStyle(preloader).pointerEvents,
      };
    }

    // Check viewport
    results.viewport = {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    };

    // Check if GSAP is loaded
    results.gsapLoaded = typeof gsap !== 'undefined';

    // Check the h1 inline style
    if (h1) {
      results.h1InlineStyle = h1.getAttribute('style');
    }

    // Check letter-spacing effect: measure total text width vs h1 width
    if (h1 && chars.length > 0) {
      const firstChar = chars[0].getBoundingClientRect();
      const lastChar = chars[chars.length - 1].getBoundingClientRect();
      const h1Rect = h1.getBoundingClientRect();
      // letter-spacing adds space AFTER each character, including the last one
      const letterSpacingValue = parseFloat(getComputedStyle(h1).letterSpacing) || 0;
      results.textMetrics = {
        textSpanLeft: Math.round(firstChar.left*10)/10,
        textSpanRight: Math.round(lastChar.right*10)/10,
        totalTextWidth: Math.round((lastChar.right - firstChar.left)*10)/10,
        h1Width: Math.round(h1Rect.width*10)/10,
        lastCharRightEdge: Math.round(lastChar.right*10)/10,
        lastCharRightPlusLetterSpacing: Math.round((lastChar.right + letterSpacingValue)*10)/10,
        h1RightEdge: Math.round(h1Rect.right*10)/10,
        overflowAmount: Math.round((lastChar.right - h1Rect.right)*10)/10,
        overflowWithLetterSpacing: Math.round((lastChar.right + letterSpacingValue - h1Rect.right)*10)/10,
        letterSpacingPx: letterSpacingValue,
      };
    }

    return results;
  });

  // Print diagnostics
  console.log('\n--- PRELOADER STATE ---');
  console.log(JSON.stringify(diagnostics.preloader, null, 2));

  console.log('\n--- H1 ELEMENT ---');
  console.log(JSON.stringify(diagnostics.h1, null, 2));
  console.log(`Inline style: ${diagnostics.h1InlineStyle}`);

  console.log('\n--- TEXT METRICS ---');
  console.log(JSON.stringify(diagnostics.textMetrics, null, 2));

  console.log('\n--- CHARACTER DETAILS ---');
  diagnostics.chars.forEach(c => {
    const opacityOk = parseFloat(c.opacity) === 1;
    const transformOk = c.transform === 'none' || c.transform === 'matrix(1, 0, 0, 1, 0, 0)';
    const status = opacityOk && transformOk ? '✅' : '❌';
    console.log(`${status} Char ${c.index} "${c.text}": opacity=${c.opacity}, transform=${c.transform}`);
    console.log(`   rect: left=${c.rect.left}, right=${c.rect.right}, top=${c.rect.top}, w=${c.rect.width}, h=${c.rect.height}`);
  });

  console.log('\n--- CLIPPING ANALYSIS ---');
  if (diagnostics.clipping.length === 0) {
    console.log('✅ No clipping detected');
  } else {
    diagnostics.clipping.forEach(clip => {
      console.log(`⚠️ Char ${clip.index} "${clip.char}" CLIPPED:`);
      clip.issues.forEach(issue => console.log(`   - ${issue}`));
    });
  }

  // Check for GSAP errors in console
  console.log('\n--- CONSOLE MESSAGES (errors/warnings/gsap) ---');
  const gsapMsgs = consoleMsgs.filter(m => 
    m.text.toLowerCase().includes('gsap') || 
    m.type === 'error' || 
    m.type === 'warning'
  );
  if (gsapMsgs.length === 0) {
    console.log('✅ No errors or warnings');
  } else {
    gsapMsgs.forEach(m => console.log(`[${m.type}] ${m.text}`));
  }

  // Animation status
  const allVisible = diagnostics.chars.every(c => parseFloat(c.opacity) === 1);
  const allSettled = diagnostics.chars.every(c => {
    const t = c.transform;
    return t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)';
  });
  
  console.log('\n--- ANIMATION STATUS ---');
  console.log(`All chars visible (opacity=1): ${allVisible ? '✅ YES' : '❌ NO'}`);
  console.log(`All chars settled (no transform): ${allSettled ? '✅ YES' : '❌ NO'}`);
  console.log(`GSAP loaded: ${diagnostics.gsapLoaded ? '✅ YES' : '❌ NO'}`);
  console.log(`Preloader hidden: ${diagnostics.preloader?.display === 'none' ? '✅ YES' : '❌ NO'}`);

  // Overflow analysis
  if (diagnostics.textMetrics) {
    const overflow = diagnostics.textMetrics.overflowAmount;
    const overflowLS = diagnostics.textMetrics.overflowWithLetterSpacing;
    console.log(`\n--- OVERFLOW ANALYSIS ---`);
    console.log(`Letter-spacing: ${diagnostics.textMetrics.letterSpacingPx}px`);
    console.log(`Text span width: ${diagnostics.textMetrics.totalTextWidth}px`);
    console.log(`H1 container width: ${diagnostics.textMetrics.h1Width}px`);
    console.log(`Last char right edge: ${diagnostics.textMetrics.lastCharRightEdge}px`);
    console.log(`H1 right edge: ${diagnostics.textMetrics.h1RightEdge}px`);
    console.log(`Overflow (char only): ${overflow > 0 ? `⚠️ ${overflow}px` : `✅ ${overflow}px (fits)`}`);
    console.log(`Overflow (char + letter-spacing): ${overflowLS > 0 ? `⚠️ ${overflowLS}px` : `✅ ${overflowLS}px (fits)`}`);
    
    if (overflow > 0) {
      console.log(`\n🔴 THE LAST CHARACTER IS BEING CLIPPED by overflow:hidden on the h1!`);
      console.log(`   The letter-spacing: 0.25em adds trailing space after the last letter "A",`);
      console.log(`   pushing it beyond the h1 boundary. With overflow:hidden, it gets visually cropped.`);
    }
  }

  await browser.close();
}

// Run tests
(async () => {
  try {
    await diagnose({ width: 1440, height: 900 }, 'desktop');
    await diagnose({ width: 393, height: 852 }, 'mobile');

    console.log('\n' + '='.repeat(60));
    console.log('DIAGNOSIS COMPLETE');
    console.log(`Screenshots saved to: ${EVIDENCE_DIR}`);
    console.log('='.repeat(60));
  } catch (e) {
    console.error('Test failed:', e);
    process.exit(1);
  }
})();
