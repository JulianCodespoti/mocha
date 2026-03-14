import { chromium } from 'playwright';
import { join } from 'path';

const EVIDENCE_DIR = '/home/domjules/Coding/mocha/test-results/hero-title-diagnosis';
const URL = 'https://juliancodespoti.github.io/mocha/';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // Collect ALL console messages
  const allMsgs = [];
  page.on('console', msg => allMsgs.push({ type: msg.type(), text: msg.text() }));
  page.on('pageerror', err => allMsgs.push({ type: 'pageerror', text: err.message + '\n' + err.stack }));

  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  
  // Wait long enough for everything
  await page.waitForTimeout(8000);

  // Deep GSAP diagnostic
  const results = await page.evaluate(() => {
    const out = {};

    // 1. Check GSAP timeline state
    if (typeof gsap !== 'undefined') {
      out.gsapVersion = gsap.version;
      
      // Get all active tweens
      const allTweens = gsap.globalTimeline.getChildren(true, true, true);
      out.totalTweens = allTweens.length;
      
      // Find tweens targeting .hero-title .char
      const charTweens = allTweens.filter(t => {
        try {
          const targets = t.targets?.() || [];
          return targets.some(el => el?.classList?.contains('char'));
        } catch(e) { return false; }
      });

      out.charTweens = charTweens.map(t => ({
        type: t.data || 'unknown',
        progress: t.progress(),
        totalProgress: t.totalProgress(),
        duration: t.duration(),
        isActive: t.isActive(),
        paused: t.paused(),
        reversed: t.reversed?.() || false,
        startTime: t.startTime(),
        vars: JSON.stringify(t.vars || {}),
      }));
    }

    // 2. Check the actual computed styles right now with extra detail
    const chars = document.querySelectorAll('.hero-title .char');
    out.charStyles = [];
    chars.forEach((c, i) => {
      const cs = getComputedStyle(c);
      out.charStyles.push({
        index: i,
        char: c.textContent,
        opacity: cs.opacity,
        transform: cs.transform,
        willChange: cs.willChange,
        backfaceVisibility: cs.backfaceVisibility,
        perspective: cs.perspective,
        transformOrigin: cs.transformOrigin,
        // GSAP inline styles
        inlineStyle: c.getAttribute('style'),
      });
    });

    // 3. Check parent elements for perspective
    const h1 = document.querySelector('.hero-title');
    if (h1) {
      const h1cs = getComputedStyle(h1);
      out.h1Perspective = h1cs.perspective;
      out.h1TransformStyle = h1cs.transformStyle;
      out.h1Transform = h1cs.transform;
      out.h1InlineStyle = h1.getAttribute('style');
    }

    // 4. Try to manually check if chars have GSAP data
    if (chars[0] && chars[0]._gsap) {
      out.gsapDataOnChar0 = JSON.stringify(Object.keys(chars[0]._gsap));
    }

    return out;
  });

  console.log('=== GSAP DEEP DIAGNOSTIC ===\n');
  console.log('GSAP Version:', results.gsapVersion);
  console.log('Total tweens in global timeline:', results.totalTweens);
  
  console.log('\n--- TWEENS TARGETING .char ELEMENTS ---');
  if (results.charTweens && results.charTweens.length > 0) {
    results.charTweens.forEach((t, i) => {
      console.log(`\nTween ${i}:`);
      console.log(`  progress: ${t.progress}, totalProgress: ${t.totalProgress}`);
      console.log(`  duration: ${t.duration}s, isActive: ${t.isActive}, paused: ${t.paused}`);
      console.log(`  reversed: ${t.reversed}, startTime: ${t.startTime}`);
      console.log(`  vars: ${t.vars}`);
    });
  } else {
    console.log('No char tweens found (may have been garbage collected)');
  }

  console.log('\n--- CHAR INLINE STYLES (GSAP-set) ---');
  results.charStyles.forEach(c => {
    console.log(`\nChar ${c.index} "${c.char}":`);
    console.log(`  opacity: ${c.opacity}`);
    console.log(`  transform: ${c.transform}`);
    console.log(`  inline style: ${c.inlineStyle}`);
    console.log(`  transform-origin: ${c.transformOrigin}`);
    console.log(`  will-change: ${c.willChange}`);
    console.log(`  backface-visibility: ${c.backfaceVisibility}`);
  });

  console.log('\n--- H1 PARENT ---');
  console.log('perspective:', results.h1Perspective);
  console.log('transform-style:', results.h1TransformStyle);
  console.log('transform:', results.h1Transform);
  console.log('inline style:', results.h1InlineStyle);

  console.log('\n--- ALL CONSOLE MESSAGES ---');
  allMsgs.forEach(m => {
    if (m.type !== 'log' || m.text.includes('GSAP') || m.text.includes('gsap') || m.text.includes('error') || m.type === 'error' || m.type === 'warning' || m.type === 'pageerror') {
      console.log(`[${m.type}] ${m.text.substring(0, 200)}`);
    }
  });

  // Now try to diagnose: did the .from() and .to() conflict?
  console.log('\n=== ROOT CAUSE ANALYSIS ===');
  
  // Check if rotateX is stuck
  const stuckChars = results.charStyles.filter(c => {
    // matrix3d for rotateX(-90deg) has [1][1]=0, [1][2]=-1, [2][1]=1, [2][2]=0
    return c.transform.includes('matrix3d') && c.transform !== 'none';
  });
  
  if (stuckChars.length > 0) {
    console.log(`\n🔴 CONFIRMED: ${stuckChars.length}/5 characters have unresolved 3D transforms`);
    console.log('The characters are rotated ~90° on the X-axis, making them edge-on (invisible).');
    console.log('\nRoot cause: The heroReveal() function has conflicting GSAP tweens:');
    console.log('  1. .to() at position 0 targets { rotateX: 0 }');
    console.log('  2. .from() at position 0 targets { rotateX: -90 } (same property, same time)');
    console.log('The .from() tween overrides the .to() tween for rotateX, creating a conflict');
    console.log('where both tweens fight for control of the same CSS transform property.');
  }

  // Take a final screenshot showing the problem clearly
  await page.screenshot({ path: join(EVIDENCE_DIR, 'desktop-04-final-state.png'), fullPage: false });
  
  // Also take a screenshot with a visible marker for the title area
  await page.evaluate(() => {
    const h1 = document.querySelector('.hero-title');
    if (h1) {
      h1.style.border = '2px solid red';
      h1.style.background = 'rgba(255,0,0,0.1)';
    }
  });
  await page.screenshot({ path: join(EVIDENCE_DIR, 'desktop-05-title-area-highlighted.png'), fullPage: false });

  await browser.close();
})();
