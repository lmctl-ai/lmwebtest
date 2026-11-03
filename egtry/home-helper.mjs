#!/usr/bin/env node
/**
 * home-helper.mjs - Playwright Chromium runner for egtry/home.lms
 *
 * Invoked by home.lms under `flock /tmp/browser-gate.lock`:
 *   node home-helper.mjs <plan.json> <raw-out.json>
 *
 * Verifies the R37 homepage (docs/design/simple-viewer/15-homepage.md):
 *   1. Structure & Hero/Tracks: .home-hero, section#player.home-player[aria-label="Example player"],
 *      section#tracks.tracks, footer, no "Featured diagrams" / .featured, hero visible text wording.
 *   2. Page Weight Before Player Loads: decoded byte weight of HTML + CSS + static JS modules
 *      before books.json / pages/<book>.json / data/<example>.json are fetched.
 *   3. Responsive Layout at 1280×900 and 600×900: zero horizontal overflow, standard buttons
 *      (Run, Step, ⚙ visible; Edit hidden; Next hidden in auto mode).
 *   4. Autoplay: runs >= N examples in a row (default 4) across different books with ~3 s pauses
 *      between ended and next start, .sv-rs cycling "○ Not started" / "▶ Running" -> "■ Ended",
 *      and clean .sv-note value comments (no leaked internals).
 *   5. Open page -> links: for each autoplayed example, HTTP 200 on /<book>/<slug>/ and
 *      /<book>/<slug>/data/<example>.json, matching <h1> and .sv[data-example="<id>"].
 *   6. Step -> Manual Mode: trusted click on .sv-step stops autoplay permanently, sets
 *      data-mode="manual", shows Next (.home-player__next), and enters data-state="stepping".
 *   7. No Way Back to Autoplay: playing/stepping to ■ Ended in manual mode and waiting > 3.5 s
 *      does not advance to another example.
 *   8. Next Button: clicking Next in manual mode loads another example in data-state="ready"
 *      ("○ Not started") and stays in ready without auto-running.
 *   9. Refresh Restores Autoplay: reloading the page restores data-mode="auto", hides Next,
 *      and auto-starts playback.
 *  10. prefers-reduced-motion: reduce => starts in data-mode="manual", Next visible,
 *      data-state="ready" ("○ Not started"), no autoplay.
 *  11. Player Window Fit (sample of 40 examples at 1280px & 600px): >= 95% of sampled examples
 *      fit in the player window without internal scrolling.
 *  12. Blocked Example Fetch Recovery: an HTTP 500 on the first example data fetch is skipped
 *      and the player seamlessly loads and plays another example with .sv-error hidden.
 *  13. Site-Wide Non-Regression URLs: /, /index.html, /books/, 5 tracks, 3 non-programming book
 *      pages, /python/, /go/, /tracks/programming-languages/ return HTTP 200 with all same-origin
 *      CSS/JS subresources HTTP 200 and 0 console/page errors.
 */

import fs from 'node:fs';
import { chromium } from 'playwright';

const [, , planPath, outPath] = process.argv;
if (!planPath || !outPath) {
  console.error('Usage: node home-helper.mjs <plan.json> <raw-out.json>');
  process.exit(2);
}

const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const {
  host,
  siteHost = host,
  scheme = 'https',
  seed = 3,
  autoplayCount = 4,
  sampleCount = 40,
  nonRegressionUrls = [],
} = plan;

const baseOrigin = `${scheme}://${host}`;

function hasLeakedInternal(text) {
  if (!text) return null;
  const patterns = [
    '[object Object]',
    '__lm',
    '<object ',
    'Traceback (most recent',
    'undefined is not',
  ];
  for (const pat of patterns) {
    if (text.includes(pat)) return pat;
  }
  return null;
}

/**
 * Accelerates requestAnimationFrame ONLY while `.sv[data-state="playing"]` is active
 * (advancing virtual frame time by +240ms every 2ms so every step executes and paints),
 * while leaving `window.setTimeout` untouched so the 3,000 ms PAUSE_MS inter-example
 * pause runs in real wall-clock time.
 */
function installFastPlayInitScript(context) {
  return context.addInitScript(() => {
    try {
      localStorage.setItem('egtry.simple.speed', 'fast');
    } catch {}
    const origRAF = window.requestAnimationFrame.bind(window);
    const origCAF = window.cancelAnimationFrame.bind(window);
    let virtualNow = performance.now();
    const fastIds = new Map();
    let nextId = 900000;

    window.requestAnimationFrame = (cb) => {
      if (document.querySelector('.sv[data-state="playing"]')) {
        const id = ++nextId;
        const tid = window.setTimeout(() => {
          fastIds.delete(id);
          const base = performance.now();
          if (virtualNow < base) virtualNow = base;
          virtualNow += 240;
          cb(virtualNow);
        }, 2);
        fastIds.set(id, tid);
        return id;
      }
      return origRAF(cb);
    };

    window.cancelAnimationFrame = (id) => {
      if (fastIds.has(id)) {
        window.clearTimeout(fastIds.get(id));
        fastIds.delete(id);
      } else {
        origCAF(id);
      }
    };
  });
}

function blockThirdPartyAnalytics(contextOrPage) {
  return contextOrPage.route(/googletagmanager\.com|google-analytics\.com/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: '' })
  );
}

async function main() {
  const result = {
    host,
    siteHost,
    seed,
    timestamp: new Date().toISOString(),
    structure: null,
    pageWeight: null,
    layout1280: null,
    layout600: null,
    autoplay: null,
    openPageChecks: [],
    stepManual: null,
    noWayBack: null,
    nextManual: null,
    refreshAuto: null,
    reducedMotion: null,
    windowFitSample: null,
    blockedFetchRecovery: null,
    nonRegression: [],
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    fatalError: null,
  };

  let browser;
  try {
    browser = await chromium.launch({ headless: true });

    // =========================================================================
    // PHASE 1: Main Homepage Lifecycle at 1280×900 (Structure, Weight, Autoplay,
    //          Open Page Links, Step -> Manual, No Way Back, Next, Refresh)
    // =========================================================================
    const context1280 = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    await installFastPlayInitScript(context1280);
    await blockThirdPartyAnalytics(context1280);

    const page = await context1280.newPage();
    const initialResources = [];
    let captureInitialResources = true;

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        result.consoleErrors.push(`[main] ${msg.text()}`);
      }
    });
    page.on('pageerror', (err) => {
      result.pageErrors.push(`[main] ${String(err?.message || err)}`);
    });
    page.on('requestfailed', (req) => {
      const failure = req.failure()?.errorText || 'failed';
      if (
        !failure.includes('ERR_ABORTED') &&
        !req.url().includes('googletagmanager') &&
        !req.url().includes('google-analytics')
      ) {
        result.failedRequests.push(`[main] ERR (${failure}) ${req.url()}`);
      }
    });
    page.on('response', async (res) => {
      const url = res.url();
      if (!url.startsWith(baseOrigin)) return;
      const st = res.status();
      if (st >= 400) {
        result.failedRequests.push(`[main] ${st} ${url}`);
      }
      if (!captureInitialResources) return;
      try {
        const u = new URL(url);
        const body = await res.body();
        initialResources.push({
          pathname: u.pathname,
          status: st,
          contentType: (res.headers()['content-type'] || '').split(';')[0].trim(),
          bytes: body.byteLength,
        });
      } catch {}
    });

    const homeUrl = `${baseOrigin}/?seed=${seed}`;
    const homeResp = await page.goto(homeUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    const homeStatus = homeResp ? homeResp.status() : 0;

    // Wait for first example to mount in [data-home-stage]
    await page.waitForFunction(
      () => Boolean(document.querySelector('[data-home-stage] .sv')?.dataset?.example),
      { timeout: 20000 }
    );
    // Allow initial resource bodies to settle
    await page.waitForTimeout(100);
    captureInitialResources = false;

    // Compute pre-player static page weight vs after-first-example weight
    const seenPrePaths = new Set();
    const prePlayerResources = [];
    let prePlayerBytes = 0;
    let firstExampleTotalBytes = 0;

    for (const r of initialResources) {
      firstExampleTotalBytes += r.bytes;
      const isPlayerData =
        r.pathname === '/assets/home/books.json' ||
        r.pathname.startsWith('/assets/home/pages/') ||
        /\/data\/[^/]+\.json$/.test(r.pathname) ||
        r.pathname.includes('chunk-WWWBXKTQ') ||
        r.pathname.includes('chunk-HRIUWSG4');
      if (!isPlayerData && !seenPrePaths.has(r.pathname)) {
        seenPrePaths.add(r.pathname);
        prePlayerResources.push(r);
        prePlayerBytes += r.bytes;
      }
    }

    result.pageWeight = {
      prePlayerBytes,
      prePlayerKb: +(prePlayerBytes / 1024).toFixed(2),
      prePlayerResources,
      allPrePlayer200:
        prePlayerResources.length >= 4 &&
        prePlayerResources.every((r) => r.status === 200),
      firstExampleTotalBytes,
      firstExampleTotalKb: +(firstExampleTotalBytes / 1024).toFixed(2),
    };

    // Inspect DOM structure, hero copy, tracks, controls, and 1280px layout
    const domCheck1280 = await page.evaluate((status) => {
      const hero = document.querySelector('.home-hero');
      const heroH1 = hero?.querySelector('h1')?.textContent?.trim() || '';
      const heroLede = hero?.querySelector('.home-hero__lede')?.textContent?.trim() || '';
      const heroVisibleText = (hero?.innerText || '').replace(/\s+/g, ' ').trim();
      const heroButtons = Array.from(hero?.querySelectorAll('a') || []).map((a) => ({
        text: (a.textContent || '').replace(/\s+/g, ' ').trim(),
        href: a.getAttribute('href') || '',
      }));

      const playerSection = document.querySelector('section#player.home-player');
      const playerAriaLabel = playerSection?.getAttribute('aria-label') || '';
      const playerH2 =
        playerSection?.querySelector('.home-player__head h2')?.textContent?.trim() || '';
      const stage = playerSection?.querySelector('[data-home-stage]');

      const tracksSection = document.querySelector('section#tracks.tracks');
      const trackCardCount = tracksSection
        ? tracksSection.querySelectorAll('.track-card').length
        : 0;
      const languagesSection = document.querySelector('section.languages');
      const footer = document.querySelector('footer');

      const hasFeaturedElement = Boolean(document.querySelector('.featured'));
      const hasFeaturedDiagramsText = /Featured diagrams/i.test(
        document.documentElement.outerHTML
      );

      const sv = stage?.querySelector('.sv');
      const runBtn = sv?.querySelector('.sv-run');
      const stepBtn = sv?.querySelector('.sv-step');
      const editBtn = sv?.querySelector('.sv-edit-btn');
      const gearBtn = stage?.querySelector('.sv-gear');
      const nextBtn = stage?.querySelector('.home-player__next');

      const isVisible = (el) =>
        Boolean(
          el &&
            !el.hidden &&
            window.getComputedStyle(el).display !== 'none' &&
            window.getComputedStyle(el).visibility !== 'hidden' &&
            el.getBoundingClientRect().width > 0
        );

      const innerWidth = window.innerWidth;
      const scrollWidth = document.documentElement.scrollWidth;
      const playerRect = playerSection?.getBoundingClientRect();

      return {
        structure: {
          status,
          title: document.title || '',
          hasHero: Boolean(hero),
          heroH1,
          heroLede,
          heroVisibleText,
          heroButtons,
          hasPlayerSection: Boolean(playerSection),
          playerAriaLabel,
          playerH2,
          hasStage: Boolean(stage),
          hasTracksSection: Boolean(tracksSection),
          trackCardCount,
          hasLanguagesSection: Boolean(languagesSection),
          hasFooter: Boolean(footer),
          hasFeaturedElement,
          hasFeaturedDiagramsText,
          controls: {
            runVisible: isVisible(runBtn),
            stepVisible: isVisible(stepBtn),
            gearVisible: isVisible(gearBtn),
            editHidden: !isVisible(editBtn),
            nextHiddenInAuto: Boolean(nextBtn?.hidden),
          },
        },
        layout1280: {
          viewportWidth: innerWidth,
          scrollWidth,
          overflowX: scrollWidth > innerWidth,
          playerWidth: playerRect ? Math.round(playerRect.width) : 0,
          playerFitsViewport: playerRect
            ? playerRect.left >= 0 && playerRect.right <= innerWidth + 1
            : false,
        },
      };
    }, homeStatus);

    result.structure = domCheck1280.structure;
    result.layout1280 = domCheck1280.layout1280;

    // -------------------------------------------------------------------------
    // Observe Autoplay for >= autoplayCount (4) complete examples + next start
    // -------------------------------------------------------------------------
    const autoplayData = await page.evaluate(async (targetCount) => {
      const stage = document.querySelector('[data-home-stage]');
      const records = [];
      let currentRec = null;

      const parseBookFromHref = (href) => {
        const m = /^\/([a-z0-9_-]+)\//.exec(href || '');
        return m ? m[1] : '';
      };

      const poll = () => {
        const sv = stage?.querySelector('.sv');
        if (!sv) return;
        const exId = sv.dataset.example || '';
        const state = sv.dataset.state || '';
        const rsText = (sv.querySelector('.sv-rs')?.textContent || '').trim();
        const title = (
          stage.querySelector('.home-player__title')?.textContent || ''
        ).trim();
        const openHref =
          stage.querySelector('.home-player__open')?.getAttribute('href') || '';
        const now = performance.now();

        if (!exId) return;

        if (!currentRec || currentRec.exampleId !== exId) {
          const prevEndedAt =
            currentRec && currentRec.endedAt ? currentRec.endedAt : null;
          currentRec = {
            index: records.length + 1,
            exampleId: exId,
            title,
            openHref,
            book: parseBookFromHref(openHref),
            startedAt: now,
            endedAt: null,
            pauseBeforeMs:
              prevEndedAt !== null ? Math.round(now - prevEndedAt) : null,
            statesSeen: [],
            rsTransitions: [],
            seenNotes: [],
          };
          records.push(currentRec);
        }

        if (title && !currentRec.title) currentRec.title = title;
        if (openHref && openHref !== '/books/') {
          currentRec.openHref = openHref;
          currentRec.book = parseBookFromHref(openHref);
        }
        if (
          state &&
          currentRec.statesSeen[currentRec.statesSeen.length - 1] !== state
        ) {
          currentRec.statesSeen.push(state);
        }
        if (
          rsText &&
          currentRec.rsTransitions[currentRec.rsTransitions.length - 1] !== rsText
        ) {
          currentRec.rsTransitions.push(rsText);
        }
        for (const n of sv.querySelectorAll('.sv-note')) {
          const txt = (n.textContent || '').trim();
          if (txt && !currentRec.seenNotes.includes(txt)) {
            currentRec.seenNotes.push(txt);
          }
        }
        if (state === 'ended' && currentRec.endedAt === null) {
          currentRec.endedAt = now;
        }
      };

      poll();
      const obs = new MutationObserver(poll);
      obs.observe(stage, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
      const timer = setInterval(poll, 30);

      const startWait = performance.now();
      // Wait until `targetCount` examples have finished (`endedAt !== null`) AND
      // example `targetCount + 1` has started (so all `targetCount` inter-example pauses are measured)
      while (performance.now() - startWait < 90000) {
        poll();
        const completed = records.filter((r) => r.endedAt !== null);
        if (completed.length >= targetCount && records.length >= targetCount + 1) {
          break;
        }
        await new Promise((r) => setTimeout(r, 40));
      }

      clearInterval(timer);
      obs.disconnect();

      // Attach pauseAfterMs to each completed example
      for (let i = 0; i < records.length - 1; i++) {
        if (records[i].endedAt !== null && records[i + 1].startedAt !== null) {
          records[i].pauseAfterMs = Math.round(
            records[i + 1].startedAt - records[i].endedAt
          );
        }
      }

      return {
        mode: stage?.dataset?.mode || '',
        nextHidden: Boolean(stage?.querySelector('.home-player__next')?.hidden),
        records,
      };
    }, autoplayCount);

    const completedExamples = autoplayData.records.slice(0, autoplayCount);
    for (const ex of completedExamples) {
      ex.leakedNotes = [];
      for (const n of ex.seenNotes || []) {
        const leak = hasLeakedInternal(n);
        if (leak) ex.leakedNotes.push(`${leak} in "${n}"`);
      }
    }
    const distinctExampleIds = new Set(completedExamples.map((e) => e.exampleId));
    const distinctBooks = new Set(
      completedExamples.map((e) => e.book).filter(Boolean)
    );
    const pausesMs = completedExamples
      .map((e) => e.pauseAfterMs)
      .filter((p) => typeof p === 'number');

    result.autoplay = {
      mode: autoplayData.mode,
      nextHidden: autoplayData.nextHidden,
      completedCount: completedExamples.length,
      distinctExampleCount: distinctExampleIds.size,
      distinctBookCount: distinctBooks.size,
      distinctBooks: Array.from(distinctBooks),
      pausesMs,
      allPausesAround3s:
        pausesMs.length >= autoplayCount &&
        pausesMs.every((p) => p >= 2400 && p <= 5500),
      examples: completedExamples,
      activeFifthExample: autoplayData.records[autoplayCount] || null,
    };

    // -------------------------------------------------------------------------
    // Verify Open page -> links for all completed autoplay examples
    // -------------------------------------------------------------------------
    result.openPageChecks = await page.evaluate(async (examples) => {
      const checks = [];
      for (const ex of examples) {
        const href = ex.openHref;
        const dataUrl = `${href}data/${ex.exampleId}.json`;
        let pageStatus = 0;
        let dataStatus = 0;
        let pageH1 = '';
        let hasMatchingExample = false;
        let pageExamples = [];
        try {
          const [pResp, dResp] = await Promise.all([
            fetch(href),
            fetch(dataUrl),
          ]);
          pageStatus = pResp.status;
          dataStatus = dResp.status;
          if (pResp.ok) {
            const html = await pResp.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            pageH1 = doc.querySelector('h1')?.textContent?.trim() || '';
            pageExamples = Array.from(
              doc.querySelectorAll('.sv[data-example]')
            ).map((el) => el.getAttribute('data-example') || '');
            hasMatchingExample = pageExamples.includes(ex.exampleId);
          }
        } catch (err) {
          pageH1 = `Error: ${String(err)}`;
        }
        checks.push({
          exampleId: ex.exampleId,
          title: ex.title,
          openHref: href,
          pageStatus,
          dataStatus,
          pageH1,
          hasMatchingExample,
          pageExamples,
        });
      }
      return checks;
    }, completedExamples);

    // -------------------------------------------------------------------------
    // Verify Step Stops Autoplay Permanently & Shows Next
    // -------------------------------------------------------------------------
    await page.waitForSelector('.home-player .sv[data-example] .sv-step:not([disabled])', {
      timeout: 10000,
    });
    await page.click('.home-player .sv-step');
    await page.waitForTimeout(50);

    const stepImmediate = await page.evaluate(() => {
      const stage = document.querySelector('[data-home-stage]');
      const sv = stage?.querySelector('.sv');
      const next = stage?.querySelector('.home-player__next');
      const rs = sv?.querySelector('.sv-rs');
      return {
        mode: stage?.dataset?.mode || '',
        nextVisible: Boolean(next && !next.hidden),
        exampleId: sv?.dataset?.example || '',
        state: sv?.dataset?.state || '',
        stepNum: Number(sv?.dataset?.step || 0),
        rsText: (rs?.textContent || '').trim(),
      };
    });

    await page.waitForTimeout(3400);
    const stepAfterWait = await page.evaluate(() => {
      const stage = document.querySelector('[data-home-stage]');
      const sv = stage?.querySelector('.sv');
      return {
        mode: stage?.dataset?.mode || '',
        exampleId: sv?.dataset?.example || '',
        state: sv?.dataset?.state || '',
      };
    });

    result.stepManual = {
      immediate: stepImmediate,
      afterWait: stepAfterWait,
      stayedOnSameExample:
        stepImmediate.exampleId !== '' &&
        stepImmediate.exampleId === stepAfterWait.exampleId,
    };

    // -------------------------------------------------------------------------
    // Verify No Way Back to Autoplay (Run to Ended in manual mode stays put)
    // -------------------------------------------------------------------------
    await page.click('.home-player .sv-run');
    await page.waitForFunction(
      () => document.querySelector('[data-home-stage] .sv')?.dataset?.state === 'ended',
      { timeout: 15000 }
    );
    // Wait longer than the 3,000 ms PAUSE_MS after reaching ■ Ended in manual mode
    await page.waitForTimeout(3600);
    const manualEndedCheck = await page.evaluate(() => {
      const stage = document.querySelector('[data-home-stage]');
      const sv = stage?.querySelector('.sv');
      const next = stage?.querySelector('.home-player__next');
      const rs = sv?.querySelector('.sv-rs');
      return {
        mode: stage?.dataset?.mode || '',
        nextVisible: Boolean(next && !next.hidden),
        exampleId: sv?.dataset?.example || '',
        state: sv?.dataset?.state || '',
        rsText: (rs?.textContent || '').trim(),
      };
    });

    result.noWayBack = {
      ...manualEndedCheck,
      expectedExampleId: stepImmediate.exampleId,
      stayedEndedInManual:
        manualEndedCheck.mode === 'manual' &&
        manualEndedCheck.state === 'ended' &&
        manualEndedCheck.rsText === '■ Ended' &&
        manualEndedCheck.exampleId === stepImmediate.exampleId,
    };

    // -------------------------------------------------------------------------
    // Verify Next Button Loads Another Example in ready ("○ Not started")
    // -------------------------------------------------------------------------
    const prevManualExampleId = manualEndedCheck.exampleId;
    await page.click('.home-player__next');
    await page.waitForFunction(
      (oldEx) => {
        const sv = document.querySelector('[data-home-stage] .sv');
        return sv && sv.dataset.example !== oldEx && sv.dataset.state === 'ready';
      },
      prevManualExampleId,
      { timeout: 15000 }
    );

    const nextImmediate = await page.evaluate(() => {
      const stage = document.querySelector('[data-home-stage]');
      const sv = stage?.querySelector('.sv');
      const next = stage?.querySelector('.home-player__next');
      const rs = sv?.querySelector('.sv-rs');
      const title = stage?.querySelector('.home-player__title');
      return {
        mode: stage?.dataset?.mode || '',
        nextVisible: Boolean(next && !next.hidden),
        exampleId: sv?.dataset?.example || '',
        title: (title?.textContent || '').trim(),
        state: sv?.dataset?.state || '',
        rsText: (rs?.textContent || '').trim(),
      };
    });

    await page.waitForTimeout(3400);
    const nextAfterWait = await page.evaluate(() => {
      const stage = document.querySelector('[data-home-stage]');
      const sv = stage?.querySelector('.sv');
      const rs = sv?.querySelector('.sv-rs');
      return {
        mode: stage?.dataset?.mode || '',
        exampleId: sv?.dataset?.example || '',
        state: sv?.dataset?.state || '',
        rsText: (rs?.textContent || '').trim(),
      };
    });

    result.nextManual = {
      previousExampleId: prevManualExampleId,
      immediate: nextImmediate,
      afterWait: nextAfterWait,
      loadedDifferentExample:
        nextImmediate.exampleId !== '' &&
        nextImmediate.exampleId !== prevManualExampleId,
      stayedReadyWithoutAutoplay:
        nextImmediate.state === 'ready' &&
        nextImmediate.rsText === '○ Not started' &&
        nextAfterWait.state === 'ready' &&
        nextAfterWait.rsText === '○ Not started' &&
        nextAfterWait.exampleId === nextImmediate.exampleId,
    };

    // -------------------------------------------------------------------------
    // Verify Page Refresh Restores Autoplay
    // -------------------------------------------------------------------------
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(
      () => {
        const sv = document.querySelector('[data-home-stage] .sv');
        return (
          sv &&
          sv.dataset.example &&
          (sv.dataset.state === 'playing' || sv.dataset.state === 'ended')
        );
      },
      { timeout: 15000 }
    );

    result.refreshAuto = await page.evaluate(() => {
      const stage = document.querySelector('[data-home-stage]');
      const sv = stage?.querySelector('.sv');
      const next = stage?.querySelector('.home-player__next');
      const rs = sv?.querySelector('.sv-rs');
      return {
        mode: stage?.dataset?.mode || '',
        nextHidden: Boolean(next?.hidden),
        exampleId: sv?.dataset?.example || '',
        state: sv?.dataset?.state || '',
        rsText: (rs?.textContent || '').trim(),
        restoredAutoplay:
          stage?.dataset?.mode === 'auto' &&
          Boolean(next?.hidden) &&
          (sv?.dataset?.state === 'playing' || sv?.dataset?.state === 'ended'),
      };
    });

    // =========================================================================
    // PHASE 2: Blocked Example Fetch Recovery Check
    // =========================================================================
    const recoveryPage = await context1280.newPage();
    recoveryPage.on('pageerror', (err) => {
      result.pageErrors.push(`[recovery] ${String(err?.message || err)}`);
    });
    const skippedDebugLogs = [];
    recoveryPage.on('console', (msg) => {
      if (msg.type() === 'debug' && msg.text().includes('example skipped')) {
        skippedDebugLogs.push(msg.text());
      } else if (msg.type() === 'error' && !msg.text().includes('500')) {
        result.consoleErrors.push(`[recovery] ${msg.text()}`);
      }
    });

    let blockedFirstDataFetch = false;
    let blockedDataUrl = '';
    await recoveryPage.route(/\/data\/[^/]+\.json$/, (route) => {
      if (!blockedFirstDataFetch) {
        blockedFirstDataFetch = true;
        blockedDataUrl = route.request().url();
        route.fulfill({
          status: 500,
          contentType: 'text/plain',
          body: 'simulated 500 error',
        });
      } else {
        route.continue();
      }
    });

    await recoveryPage.goto(homeUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await recoveryPage.waitForFunction(
      () => Boolean(document.querySelector('[data-home-stage] .sv')?.dataset?.example),
      { timeout: 20000 }
    );

    const recoveryState = await recoveryPage.evaluate(() => {
      const stage = document.querySelector('[data-home-stage]');
      const sv = stage?.querySelector('.sv');
      const title = stage?.querySelector('.home-player__title');
      const errEl = sv?.querySelector('.sv-error');
      return {
        exampleId: sv?.dataset?.example || '',
        state: sv?.dataset?.state || '',
        title: (title?.textContent || '').trim(),
        errorHidden: Boolean(!errEl || errEl.hidden),
      };
    });

    result.blockedFetchRecovery = {
      blockedFirstDataFetch,
      blockedDataUrl,
      skippedDebugLogsCount: skippedDebugLogs.length,
      ...recoveryState,
      recoveredCleanly:
        blockedFirstDataFetch &&
        recoveryState.exampleId !== '' &&
        recoveryState.title.includes(' · ') &&
        recoveryState.errorHidden,
    };
    await recoveryPage.close();
    await context1280.close();

    // =========================================================================
    // PHASE 3: prefers-reduced-motion: reduce + 600px Layout + 40-Example
    //          Player Window Fit Sample at 1280×900 and 600×900
    // =========================================================================
    const rmContext = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      reducedMotion: 'reduce',
    });
    await blockThirdPartyAnalytics(rmContext);
    const rmPage = await rmContext.newPage();

    rmPage.on('console', (msg) => {
      if (msg.type() === 'error') {
        result.consoleErrors.push(`[reduced-motion] ${msg.text()}`);
      }
    });
    rmPage.on('pageerror', (err) => {
      result.pageErrors.push(`[reduced-motion] ${String(err?.message || err)}`);
    });
    rmPage.on('response', (res) => {
      if (res.url().startsWith(baseOrigin) && res.status() >= 400) {
        result.failedRequests.push(`[reduced-motion] ${res.status()} ${res.url()}`);
      }
    });

    await rmPage.goto(homeUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await rmPage.waitForFunction(
      () => document.querySelector('[data-home-stage] .sv')?.dataset?.state === 'ready',
      { timeout: 20000 }
    );

    const rmInitial = await rmPage.evaluate(() => {
      const stage = document.querySelector('[data-home-stage]');
      const sv = stage?.querySelector('.sv');
      const next = stage?.querySelector('.home-player__next');
      const rs = sv?.querySelector('.sv-rs');
      return {
        mode: stage?.dataset?.mode || '',
        nextVisible: Boolean(next && !next.hidden),
        exampleId: sv?.dataset?.example || '',
        state: sv?.dataset?.state || '',
        rsText: (rs?.textContent || '').trim(),
      };
    });

    await rmPage.waitForTimeout(3400);
    const rmAfterWait = await rmPage.evaluate(() => {
      const stage = document.querySelector('[data-home-stage]');
      const sv = stage?.querySelector('.sv');
      const rs = sv?.querySelector('.sv-rs');
      return {
        mode: stage?.dataset?.mode || '',
        exampleId: sv?.dataset?.example || '',
        state: sv?.dataset?.state || '',
        rsText: (rs?.textContent || '').trim(),
      };
    });

    result.reducedMotion = {
      initial: rmInitial,
      afterWait: rmAfterWait,
      noAutoplay:
        rmInitial.mode === 'manual' &&
        rmInitial.nextVisible &&
        rmInitial.state === 'ready' &&
        rmInitial.rsText === '○ Not started' &&
        rmAfterWait.mode === 'manual' &&
        rmAfterWait.state === 'ready' &&
        rmAfterWait.rsText === '○ Not started' &&
        rmAfterWait.exampleId === rmInitial.exampleId,
    };

    // Check 600×900 responsive layout before running the 40-example sample
    await rmPage.setViewportSize({ width: 600, height: 900 });
    await rmPage.waitForTimeout(150);
    result.layout600 = await rmPage.evaluate(() => {
      const innerWidth = window.innerWidth;
      const scrollWidth = document.documentElement.scrollWidth;
      const playerSection = document.querySelector('section#player.home-player');
      const playerRect = playerSection?.getBoundingClientRect();
      const winEl = playerSection?.querySelector('.sv-window');
      const winRect = winEl?.getBoundingClientRect();
      return {
        viewportWidth: innerWidth,
        scrollWidth,
        overflowX: scrollWidth > innerWidth,
        playerWidth: playerRect ? Math.round(playerRect.width) : 0,
        windowWidth: winRect ? Math.round(winRect.width) : 0,
        playerFitsViewport: playerRect
          ? playerRect.left >= 0 && playerRect.right <= innerWidth + 1
          : false,
      };
    });

    // Sample 40 examples at a fixed viewport (no mid-loop ResizeObserver race)
    async function runWindowFitSampleAtWidth(width) {
      await rmPage.setViewportSize({ width, height: 900 });
      await rmPage.goto(homeUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await rmPage.waitForFunction(
        () => document.querySelector('[data-home-stage] .sv')?.dataset?.state === 'ready',
        { timeout: 20000 }
      );

      let fitsCount = 0;
      let noScrollPlanCount = 0;
      let within12To26RowsCount = 0;
      let minRowsSeen = 999;
      let maxRowsSeen = 0;
      const overflowed = [];
      const outOfRowBounds = [];

      for (let i = 0; i < sampleCount; i++) {
        const info = await rmPage.evaluate(async () => {
          const stage = document.querySelector('[data-home-stage]');
          const sv = stage.querySelector('.sv');
          const win = sv.querySelector('.sv-window');
          const linesCount = sv.querySelectorAll('.sv-line').length;
          const styleHeightPx = parseFloat(win.style.height) || win.clientHeight + 2;
          const windowRows = Math.round((styleHeightPx - 16) / 21);
          const within12To26Rows =
            windowRows >= 12 &&
            windowRows <= 26 &&
            win.clientHeight >= 12 * 21 + 14 &&
            win.clientHeight <= 26 * 21 + 16;
          // Note: home-base.css sets `* { box-sizing: border-box }` and `.sv-window` has a 1px top+bottom border (2px total),
          // so an exact-fit window has `scrollHeight - clientHeight <= 2`.
          const readyFits = win.scrollHeight <= win.clientHeight + 2;
          sv.querySelector('.sv-step').click();
          await new Promise((r) => setTimeout(r, 5));
          const scrolls = JSON.parse(sv.dataset.scrolls || '[]');
          const stepFits = win.scrollHeight <= win.clientHeight + 2;
          const fitsWindow = readyFits && stepFits;
          const noScrollMoves = scrolls.length === 0 || fitsWindow;
          return {
            exampleId: sv.dataset.example || '',
            title: (stage.querySelector('.home-player__title')?.textContent || '').trim(),
            linesCount,
            styleHeightPx,
            windowRows,
            within12To26Rows,
            scrollHeight: win.scrollHeight,
            clientHeight: win.clientHeight,
            scrollMoves: scrolls.length,
            fitsWindow,
            noScrollMoves,
          };
        });

        if (info.windowRows < minRowsSeen) minRowsSeen = info.windowRows;
        if (info.windowRows > maxRowsSeen) maxRowsSeen = info.windowRows;
        if (info.within12To26Rows) within12To26RowsCount++;
        else outOfRowBounds.push({ index: i + 1, ...info });

        if (info.fitsWindow) fitsCount++;
        else overflowed.push({ index: i + 1, ...info });
        if (info.noScrollMoves) noScrollPlanCount++;

        if (i < sampleCount - 1) {
          const prevEx = info.exampleId;
          await rmPage.click('.home-player__next');
          await rmPage.waitForFunction(
            (oldEx) => {
              const sv = document.querySelector('[data-home-stage] .sv');
              return sv && sv.dataset.example !== oldEx && sv.dataset.state === 'ready';
            },
            prevEx,
            { timeout: 15000 }
          );
        }
      }

      return {
        fitsCount,
        fitPct: +(fitsCount / sampleCount * 100).toFixed(1),
        noScrollPlanCount,
        noScrollPlanPct: +(noScrollPlanCount / sampleCount * 100).toFixed(1),
        within12To26RowsCount,
        minRowsSeen,
        maxRowsSeen,
        overflowed,
        outOfRowBounds,
      };
    }

    const fit1280 = await runWindowFitSampleAtWidth(1280);
    const fit600 = await runWindowFitSampleAtWidth(600);

    result.windowFitSample = {
      sampleCount,
      fits1280Count: fit1280.fitsCount,
      fitPct1280: fit1280.fitPct,
      noScrollPlan1280Count: fit1280.noScrollPlanCount,
      noScrollPlanPct1280: fit1280.noScrollPlanPct,
      within12To26Rows1280Count: fit1280.within12To26RowsCount,
      minRows1280: fit1280.minRowsSeen,
      maxRows1280: fit1280.maxRowsSeen,
      fits600Count: fit600.fitsCount,
      fitPct600: fit600.fitPct,
      noScrollPlan600Count: fit600.noScrollPlanCount,
      noScrollPlanPct600: fit600.noScrollPlanPct,
      within12To26Rows600Count: fit600.within12To26RowsCount,
      minRows600: fit600.minRowsSeen,
      maxRows600: fit600.maxRowsSeen,
      overflowedExamples1280: fit1280.overflowed,
      overflowedExamples600: fit600.overflowed,
      outOfRowBounds1280: fit1280.outOfRowBounds,
      outOfRowBounds600: fit600.outOfRowBounds,
    };

    await rmContext.close();

    // =========================================================================
    // PHASE 4: Site-Wide Non-Regression URL List (with CSS/JS HTTP 200)
    // =========================================================================
    const regContext = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    await blockThirdPartyAnalytics(regContext);
    const regPage = await regContext.newPage();

    let regConsoleErrors = [];
    let regPageErrors = [];
    let regSubresources = [];
    let regTargetOrigin = baseOrigin;

    // HTTP candidates can link to a site host that redirects to HTTPS. Track
    // the committed document origin before its stylesheet/script responses.
    regPage.on('framenavigated', (frame) => {
      if (frame === regPage.mainFrame()) {
        try { regTargetOrigin = new URL(frame.url()).origin; } catch {}
      }
    });

    regPage.on('console', (msg) => {
      if (msg.type() === 'error') {
        regConsoleErrors.push(msg.text());
      }
    });
    regPage.on('pageerror', (err) => {
      regPageErrors.push(String(err?.message || err));
    });
    regPage.on('response', (res) => {
      const u = res.url();
      if (!u.startsWith(regTargetOrigin)) return;
      const rt = res.request().resourceType();
      if (rt === 'stylesheet' || rt === 'script') {
        try {
          regSubresources.push({
            pathname: new URL(u).pathname,
            type: rt,
            status: res.status(),
          });
        } catch {}
      }
    });

    for (const item of nonRegressionUrls) {
      regConsoleErrors = [];
      regPageErrors = [];
      regSubresources = [];
      const itemHost = item.useSiteHost ? siteHost : host;
      regTargetOrigin = `${scheme}://${itemHost}`;
      const fullUrl = `${regTargetOrigin}${item.path}`;

      let docStatus = 0;
      let title = '';
      let h1 = '';
      try {
        const resp = await regPage.goto(fullUrl, {
          waitUntil: 'networkidle',
          timeout: 30000,
        });
        docStatus = resp ? resp.status() : 0;
        const meta = await regPage.evaluate(() => ({
          title: document.title || '',
          h1: document.querySelector('h1')?.textContent?.trim() || '',
        }));
        title = meta.title;
        h1 = meta.h1;
      } catch (err) {
        regPageErrors.push(String(err?.message || err));
      }

      const non200Assets = regSubresources.filter((r) => r.status !== 200);
      result.nonRegression.push({
        label: item.label,
        path: item.path,
        host: itemHost,
        url: fullUrl,
        status: docStatus,
        title,
        h1,
        cssJsCount: regSubresources.length,
        cssJsAssets: regSubresources,
        non200Assets,
        consoleErrors: [...regConsoleErrors],
        pageErrors: [...regPageErrors],
      });
    }

    await regContext.close();
  } catch (err) {
    result.fatalError = String(err?.stack || err);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n', 'utf8');
  if (result.fatalError) {
    console.error(result.fatalError);
    process.exit(1);
  }
}

main();
