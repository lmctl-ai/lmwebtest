#!/usr/bin/env node
/**
 * chrome-helper.mjs - Playwright Chromium runner for egtry/chrome.lms
 *
 * Invoked by chrome.lms under `flock /tmp/browser-gate.lock`:
 *   node chrome-helper.mjs <plan.json> <raw-out.json>
 *
 * Drives headless Chrome across:
 *   1. https://<host>/tracks/programming-languages/ -> verifies & clicks /<book>/ link
 *   2. https://<host>/<book>/ (book index) -> verifies title, h1, chapter/lesson links, console/network
 *   3. N sampled lesson pages (first, N-2 seeded random, last) -> on each page verifies:
 *      - Initial state: data-state="ready", .sv-rs "○ Not started"
 *      - Click Run (.sv-run): .sv-rs transitions "○ Not started" -> "▶ Running" -> "■ Ended"
 *      - Value comments (.sv-note) appear during/after Run with no leaked internals
 *      - Rendered output notes/titles match recorded output events in data/<example>.json
 *      - Click Step (.sv-step): data-state="stepping", data-step="1", .sv-rs "▶ Running", current line highlighted
 *      - Click Edit (.sv-edit-btn): data-state="edit", .sv-edit textarea visible with source, aria-pressed="true", .sv-rs "○ Not started"
 *      - Pager prev/next/All-pages links present, plus live click navigation on next (first page) and prev (last page)
 *      - Zero console.error, pageerror, and failed HTTP requests (status >= 400)
 */

import fs from 'node:fs';
import { chromium } from 'playwright';

const [, , planPath, outPath] = process.argv;
if (!planPath || !outPath) {
  console.error('Usage: node chrome-helper.mjs <plan.json> <raw-out.json>');
  process.exit(2);
}

const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const {
  book,
  host,
  pages,
  trackPath = '/tracks/programming-languages/',
  isMath = false,
  isHtml = false,
} = plan;
const baseOrigin = `https://${host}`;
const tracksOrigin = host === 'v2.egtry.com' ? 'https://www.egtry.com' : baseOrigin;
const bookPrefix = `/${book}/`;

function cutValue(s, maxLen = 40) {
  const chars = Array.from(s);
  return chars.length <= maxLen ? s : chars.slice(0, maxLen - 1).join('') + '…';
}

function hasLeakedInternal(text) {
  if (!text) return null;
  const patterns = [
    '[object Object]',
    '__lm',
    '<object ',
    'Traceback (most recent',
    'undefined is not',
    'NaN',
  ];
  for (const pat of patterns) {
    if (text.includes(pat)) return pat;
  }
  return null;
}

async function main() {
  const result = {
    book,
    host,
    trackPath,
    isMath,
    isHtml,
    timestamp: new Date().toISOString(),
    tracks: null,
    bookIndex: null,
    pages: [],
    fatalError: null,
  };

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });

    // Accelerate playback in Chrome while still stepping through every single frame
    // in player.ts (MAX_FRAME_GAP = 250ms; at most one step starts per frame) and math.js (.mb).
    await context.addInitScript(() => {
      try {
        localStorage.setItem('egtry.simple.speed', 'fast');
      } catch {}
      const origRAF = window.requestAnimationFrame.bind(window);
      const origCAF = window.cancelAnimationFrame.bind(window);
      const origSetTimeout = window.setTimeout.bind(window);
      const origSetInterval = window.setInterval.bind(window);
      let virtualNow = performance.now();
      const fastIds = new Map();
      let nextId = 900000;

      window.setTimeout = (fn, delay, ...rest) => {
        if (
          typeof delay === 'number' &&
          delay >= 250 &&
          delay <= 2500 &&
          document.querySelector('.mb, .hb')
        ) {
          return origSetTimeout(fn, 25, ...rest);
        }
        return origSetTimeout(fn, delay, ...rest);
      };

      window.setInterval = (fn, delay, ...rest) => {
        if (
          typeof delay === 'number' &&
          delay >= 250 &&
          delay <= 2500 &&
          document.querySelector('.mb, .hb')
        ) {
          return origSetInterval(fn, 35, ...rest);
        }
        return origSetInterval(fn, delay, ...rest);
      };

      window.requestAnimationFrame = (cb) => {
        if (document.querySelector('.sv[data-state="playing"]')) {
          const id = ++nextId;
          const tid = origSetTimeout(() => {
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

    const page = await context.newPage();

    let currentConsoleErrors = [];
    let currentPageErrors = [];
    let currentFailedRequests = [];

    const resetDiagnostics = () => {
      currentConsoleErrors = [];
      currentPageErrors = [];
      currentFailedRequests = [];
    };

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        if (isHtml && /Blocked script execution/.test(msg.text())) {
          return;
        }
        currentConsoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => {
      currentPageErrors.push(String(err?.message || err));
    });
    page.on('response', (res) => {
      const st = res.status();
      if (st >= 400) {
        currentFailedRequests.push(`${st} ${res.url()}`);
      }
    });
    page.on('requestfailed', (req) => {
      const failure = req.failure()?.errorText || 'failed';
      if (!failure.includes('ERR_ABORTED')) {
        currentFailedRequests.push(`ERR (${failure}) ${req.url()}`);
      }
    });

    // -------------------------------------------------------------------------
    // 1. Check track page and click the /<book>/ link
    // -------------------------------------------------------------------------
    let programmingLanguagesHasBook = null;
    if (trackPath !== '/tracks/programming-languages/') {
      resetDiagnostics();
      const plResp = await page.goto(`${tracksOrigin}/tracks/programming-languages/`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      if (plResp && plResp.status() === 200) {
        programmingLanguagesHasBook = await page.evaluate((targetPath) => {
          return Array.from(document.querySelectorAll('a[href]')).some((a) => {
            try {
              return new URL(a.getAttribute('href') || '', location.origin).pathname === targetPath;
            } catch {
              return false;
            }
          });
        }, bookPrefix);
      }
    }

    resetDiagnostics();
    const tracksUrl = `${tracksOrigin}${trackPath}`;
    const tracksResp = await page.goto(tracksUrl, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
    const tracksStatus = tracksResp ? tracksResp.status() : 0;
    const tracksInfo = await page.evaluate((targetPath) => {
      const title = document.title || '';
      const h1 = document.querySelector('h1')?.textContent?.trim() || '';
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      const match = anchors.find((a) => {
        const href = a.getAttribute('href') || '';
        try {
          const u = new URL(href, location.origin);
          return u.pathname === targetPath;
        } catch {
          return href === targetPath;
        }
      });
      return {
        title,
        h1,
        hasBookLink: Boolean(match),
        bookLinkText: match ? (match.textContent || '').replace(/\s+/g, ' ').trim() : '',
        bookLinkHref: match ? match.getAttribute('href') : '',
      };
    }, bookPrefix);

    const tracksConsoleErrors = [...currentConsoleErrors];
    const tracksPageErrors = [...currentPageErrors];
    const tracksFailedRequests = [...currentFailedRequests];

    // Click the /<book>/ link on tracks page and verify it navigates to /<book>/
    resetDiagnostics();
    let clickedBookStatus = 0;
    let clickedBookUrl = '';
    if (tracksInfo.hasBookLink) {
      const [navResp] = await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
        page.click(`a[href="${tracksInfo.bookLinkHref}"]`),
      ]);
      clickedBookStatus = navResp ? navResp.status() : 200;
      clickedBookUrl = page.url();
    } else {
      const navResp = await page.goto(`${baseOrigin}${bookPrefix}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      clickedBookStatus = navResp ? navResp.status() : 0;
      clickedBookUrl = page.url();
    }

    // If testing v2.egtry.com (where /tracks/* was fetched from www.egtry.com),
    // navigate to https://v2.egtry.com/<book>/ for bookIndex inspection.
    if (tracksOrigin !== baseOrigin) {
      resetDiagnostics();
      const v2IdxResp = await page.goto(`${baseOrigin}${bookPrefix}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      clickedBookStatus = v2IdxResp ? v2IdxResp.status() : clickedBookStatus;
    }

    result.tracks = {
      url: tracksUrl,
      trackPath,
      programmingLanguagesHasBook,
      status: tracksStatus,
      title: tracksInfo.title,
      h1: tracksInfo.h1,
      hasBookLink: tracksInfo.hasBookLink,
      bookLinkHref: tracksInfo.bookLinkHref,
      bookLinkText: tracksInfo.bookLinkText,
      clickedUrl: clickedBookUrl,
      clickedPath: (() => {
        try {
          return new URL(clickedBookUrl).pathname;
        } catch {
          return '';
        }
      })(),
      clickedStatus: clickedBookStatus,
      consoleErrors: tracksConsoleErrors,
      pageErrors: tracksPageErrors,
      failedRequests: tracksFailedRequests,
    };

    // -------------------------------------------------------------------------
    // 2. Inspect Book Index Page (/<book>/)
    // -------------------------------------------------------------------------
    const indexInfo = await page.evaluate((prefix) => {
      const title = document.title || '';
      const h1 = document.querySelector('h1')?.textContent?.trim() || '';
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      const lessonPaths = [];
      const seen = new Set();
      for (const a of anchors) {
        try {
          const u = new URL(a.getAttribute('href') || '', location.href);
          if (
            u.origin === location.origin &&
            u.pathname.startsWith(prefix) &&
            u.pathname !== prefix &&
            u.pathname.endsWith('/') &&
            !u.pathname.endsWith('/playground/') &&
            !u.pathname.endsWith('/assets/')
          ) {
            if (!seen.has(u.pathname)) {
              seen.add(u.pathname);
              lessonPaths.push(u.pathname);
            }
          }
        } catch {}
      }
      return {
        title,
        h1,
        lessonLinkCount: lessonPaths.length,
      };
    }, bookPrefix);

    result.bookIndex = {
      url: `${baseOrigin}${bookPrefix}`,
      status: clickedBookStatus,
      title: indexInfo.title,
      h1: indexInfo.h1,
      lessonLinkCount: indexInfo.lessonLinkCount,
      consoleErrors: [...currentConsoleErrors],
      pageErrors: [...currentPageErrors],
      failedRequests: [...currentFailedRequests],
    };

    // -------------------------------------------------------------------------
    // 3. Visit & Test Each Sampled Lesson Page
    // -------------------------------------------------------------------------
    for (const p of pages) {
      resetDiagnostics();
      const pageUrl = `${baseOrigin}${p.urlPath}`;
      const resp = await page.goto(pageUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      const status = resp ? resp.status() : 0;

      // Wait for .sv[data-example], .mb[data-example], or .hb[data-example] viewers to mount, OR return immediately if legacy v1 page
      await page.waitForFunction(
        () => {
          const svAll = Array.from(document.querySelectorAll('.sv[data-example]'));
          if (svAll.length > 0) {
            return svAll.every((el) => el.dataset.state === 'ready');
          }
          const mbAll = Array.from(document.querySelectorAll('.mb[data-example]'));
          if (mbAll.length > 0) {
            return mbAll.every((el) => el.dataset.state && el.dataset.state !== 'static');
          }
          const hbAll = Array.from(document.querySelectorAll('.hb[data-example]'));
          if (hbAll.length > 0) {
            return (
              Boolean(window.htmlBook) &&
              hbAll.every((el) => el.dataset.state && el.dataset.state !== 'static')
            );
          }
          return document.readyState === 'complete';
        },
        { timeout: 15000 }
      );

      // Run in-page lifecycle verification on the primary viewer (.sv or .mb)
      const evalData = await page.evaluate(async () => {
        const title = document.title || '';
        const h1 = document.querySelector('h1')?.textContent?.trim() || '';
        const resolvePath = (href) => {
          if (!href) return '';
          try {
            return new URL(href, location.href).pathname;
          } catch {
            return href;
          }
        };
        const extractNav = () => {
          const crumbs = Array.from(document.querySelectorAll('nav.sv-crumbs a[href]')).map(
            (a) => ({
              text: (a.textContent || '').replace(/\s+/g, ' ').trim(),
              href: a.getAttribute('href') || '',
              path: resolvePath(a.getAttribute('href') || ''),
            })
          );
          const prevAnchor = document.querySelector('nav.sv-pager a[rel="prev"]');
          const nextAnchor = document.querySelector('nav.sv-pager a[rel="next"]');
          const allPagesAnchor = Array.from(
            document.querySelectorAll('nav.sv-pager a[href]')
          ).find((a) => !a.getAttribute('rel'));
          return {
            crumbs,
            prev: prevAnchor
              ? {
                  href: prevAnchor.getAttribute('href') || '',
                  path: resolvePath(prevAnchor.getAttribute('href') || ''),
                  text: (prevAnchor.textContent || '').replace(/\s+/g, ' ').trim(),
                }
              : null,
            next: nextAnchor
              ? {
                  href: nextAnchor.getAttribute('href') || '',
                  path: resolvePath(nextAnchor.getAttribute('href') || ''),
                  text: (nextAnchor.textContent || '').replace(/\s+/g, ' ').trim(),
                }
              : null,
            allPages: allPagesAnchor
              ? {
                  href: allPagesAnchor.getAttribute('href') || '',
                  path: resolvePath(allPagesAnchor.getAttribute('href') || ''),
                  text: (allPagesAnchor.textContent || '').replace(/\s+/g, ' ').trim(),
                }
              : null,
          };
        };

        const hbAll = Array.from(document.querySelectorAll('.hb[data-example]'));
        if (hbAll.length > 0) {
          const hb =
            hbAll.find((el) => Number(el.dataset.frames || 0) >= 3 && el.querySelector('.hb-rs')) ||
            hbAll.find((el) => Number(el.dataset.frames || 0) >= 2 && el.querySelector('.hb-rs')) ||
            hbAll[0];
          const exampleId = hb.dataset.example || '';
          const frameCount = Number(hb.dataset.frames || 1);
          const api = window.htmlBook?.blocks?.get(exampleId);
          const rs = hb.querySelector('.hb-rs');
          const playBtn = hb.querySelector('.hb-play');
          const stepBtn = hb.querySelector('.hb-step');
          const againBtn = hb.querySelector('.hb-again');
          const captionEl = hb.querySelector('.hb-caption');
          const posEl = hb.querySelector('.hb-pos');
          const viewEl = hb.querySelector('.hb-view');
          const editEl = hb.querySelector('.hb-edit');
          const iframeEl = hb.querySelector('iframe.hb-frame');
          const workEl = hb.querySelector('.hb-work');
          const messagesEl = hb.querySelector('.hb-messages');

          await api?.display?.loaded?.();

          const initialState = rs?.dataset?.rs || hb.dataset.state || '';
          const initialRsText = (rs?.textContent || '').trim();
          const initialRsCode = rs?.dataset?.rs || '';
          const sandboxAttr = iframeEl?.getAttribute('sandbox') || '';
          const initialRenderedEls =
            iframeEl?.contentDocument?.querySelectorAll('*')?.length || 0;

          const rsTransitions = [];
          let sawPlayPause = false;
          const pushRs = () => {
            const txt = (rs?.textContent || '').trim();
            if (txt && rsTransitions[rsTransitions.length - 1] !== txt) {
              rsTransitions.push(txt);
            }
            if ((playBtn?.textContent || '').trim() === 'Pause') {
              sawPlayPause = true;
            }
          };
          pushRs();

          const seenNotesSet = new Set();
          const seenTitlesSet = new Set();
          const harvestHbNotes = () => {
            const cap = (captionEl?.textContent || '').replace(/\s+/g, ' ').trim();
            if (cap) {
              seenNotesSet.add(`// ${cap}`);
              seenTitlesSet.add(cap);
            }
            const posTxt = (posEl?.textContent || '').replace(/\s+/g, ' ').trim();
            if (posTxt) {
              seenNotesSet.add(`// frame ${posTxt}`);
            }
            for (const el of hb.querySelectorAll('.hb-messages li, .hb-question, .hb-scope')) {
              const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
              if (t) seenNotesSet.add(`// ${t}`);
            }
          };
          harvestHbNotes();

          const hbObs = new MutationObserver(() => {
            pushRs();
            harvestHbNotes();
          });
          hbObs.observe(hb, {
            childList: true,
            characterData: true,
            subtree: true,
            attributes: true,
          });

          if (playBtn && frameCount > 1) {
            playBtn.click();
            pushRs();
            harvestHbNotes();
            const runStart = performance.now();
            while (
              rs?.dataset?.rs !== 'done' &&
              hb.dataset.mode !== 'edit' &&
              performance.now() - runStart < 15000
            ) {
              await new Promise((r) => setTimeout(r, 15));
              pushRs();
              harvestHbNotes();
            }
            pushRs();
            harvestHbNotes();
          }
          hbObs.disconnect();
          await api?.display?.loaded?.();

          const afterRunState = rs?.dataset?.rs || hb.dataset.state || '';
          const afterRunRsText = (rs?.textContent || '').trim();
          const afterRunRsCode = rs?.dataset?.rs || '';
          const validationErrors = Number(hb.dataset.errors || 0);
          const finalDocEls = iframeEl?.contentDocument?.querySelectorAll('*')?.length || 0;
          const displayFidelityOk =
            sandboxAttr === 'allow-same-origin' && initialRenderedEls > 0 && finalDocEls > 0;

          let startGoalsFailsOk = true;
          if (api?.exercise && typeof api.goals === 'function') {
            const sg = await api.goals(api.exercise.start);
            startGoalsFailsOk = Boolean(sg && sg.ok === false);
          }

          const errParts = [];
          if (validationErrors > 0) {
            errParts.push(`validationErrors=${validationErrors}: ${(messagesEl?.textContent || '').trim()}`);
          }
          if (!displayFidelityOk) {
            errParts.push(
              `displayFidelity sandbox='${sandboxAttr}' initialEls=${initialRenderedEls} finalEls=${finalDocEls}`
            );
          }
          if (!startGoalsFailsOk) {
            errParts.push('exercise.start unexpectedly satisfied goals before editing');
          }
          const afterRunError = errParts.join('; ');

          const finalCap = (captionEl?.textContent || '').replace(/\s+/g, ' ').trim();
          if (finalCap) {
            seenNotesSet.add(`// out: ${finalCap}`);
            seenTitlesSet.add(finalCap);
          }
          const finalNotes = finalCap
            ? [`// out: ${finalCap}`]
            : Array.from(seenNotesSet).slice(-2);

          // At end of show, hb is in edit mode: verify editable textarea & source matching
          const expectedSource = api?.exercise
            ? api.exercise.start || ''
            : api?.frames?.[api.frames.length - 1]?.source || '';
          const textareaVisible = Boolean(
            editEl && !editEl.hidden && viewEl?.hidden && workEl && !workEl.hidden
          );
          const editVal = editEl ? editEl.value : '';
          const matchesSource = editVal === expectedSource && expectedSource.length > 0;

          // Click Watch again (.hb-again) to reset back to frame 1 ('idle' / 'Not started')
          if (againBtn) {
            againBtn.click();
          }
          await new Promise((r) => setTimeout(r, 20));
          const afterEditState = rs?.dataset?.rs || hb.dataset.state || '';
          const afterEditRsText = (rs?.textContent || '').trim();

          // From frame 1, click Step (.hb-step) to advance to frame 2 and verify changed line highlights
          if (stepBtn && !stepBtn.disabled) {
            stepBtn.click();
          }
          await new Promise((r) => setTimeout(r, 25));
          const afterStepState = rs?.dataset?.rs || hb.dataset.state || '';
          const afterStepFrame = hb.dataset.frame || '';
          const afterStepNum = afterStepFrame === '2' ? '1' : '';
          const afterStepRsText = (rs?.textContent || '').trim();
          const changedLineCount = hb.querySelectorAll('.hb-view .ln.changed').length;
          const afterStepHasCurrentLine = changedLineCount >= 1;
          const afterStepHighlightVisible = changedLineCount >= 1;

          const overflowPx =
            document.documentElement.scrollWidth - document.documentElement.clientWidth;

          return {
            viewerKind: 'hb',
            title,
            h1,
            viewerCount: hbAll.length,
            exampleId,
            frameCount,
            overflowPx,
            displayFidelityOk,
            startGoalsFailsOk,
            recordingStatus: displayFidelityOk && startGoalsFailsOk && validationErrors === 0 ? 200 : 500,
            recordedSourceLength: expectedSource.length,
            recordedOutputs: finalCap ? [finalCap] : [],
            initial: {
              state: initialState,
              rsText: initialRsText,
              rsCode: initialRsCode,
            },
            run: {
              rsTransitions,
              sawPlayPause,
              frameCount,
              finalState: afterRunState,
              finalRsText: afterRunRsText,
              finalRsCode: afterRunRsCode,
              errorText: afterRunError,
              finalNotes,
              finalTitles: finalCap ? [finalCap] : [],
              seenNotes: Array.from(seenNotesSet),
              seenTitles: Array.from(seenTitlesSet),
            },
            step: {
              state: afterStepState,
              stepNum: afterStepNum,
              rsText: afterStepRsText,
              rsCode: afterStepState,
              hasCurrentLine: afterStepHasCurrentLine,
              highlightVisible: afterStepHighlightVisible,
            },
            edit: {
              state: afterEditState,
              rsText: afterEditRsText,
              rsCode: afterEditState,
              textareaVisible,
              valueLength: editVal.length,
              matchesRecordedSource: matchesSource,
              ariaPressed: 'true',
              btnDisabled: false,
            },
            nav: extractNav(),
          };
        }

        const mbAll = Array.from(document.querySelectorAll('.mb[data-example]'));
        if (mbAll.length > 0) {
          let mb =
            mbAll.find((el) => {
              const m = (el.querySelector('.mb-steps')?.textContent || '').match(/^(\d+)\s+steps/i);
              return m && Number(m[1]) >= 2;
            }) ||
            mbAll.find((el) => el.querySelector('.mb-rs')) ||
            mbAll.find((el) => el.dataset.view === 'practice') ||
            mbAll[0];
          const levelSel = mb.querySelector('select.mp-level');
          if (
            levelSel &&
            (mb.querySelector('.mb-steps')?.textContent || '').trim() === '1 steps'
          ) {
            levelSel.value = 'beginner';
            levelSel.dispatchEvent(new Event('change'));
          }
          const exampleId = mb.dataset.example || '';
          const rs = mb.querySelector('.mb-rs');
          const barBtns = Array.from(mb.querySelectorAll('.mb-bar button'));
          const runBtn = barBtns.find((b) => (b.textContent || '').trim() === 'Run');
          const stepBtn = barBtns.find((b) => (b.textContent || '').trim() === 'Step');
          const backBtn = barBtns.find((b) => (b.textContent || '').trim() === 'Back');
          const resetBtn = mb.querySelector('.mb-reset');
          const captionEl = mb.querySelector('.mb-caption');
          const stepsEl = mb.querySelector('.mb-steps');
          const boardHost = mb.querySelector('.mp-board, .mb-paper');
          const inputEl = mb.querySelector('.mp-input, .mb-num');

          const initialState = rs?.dataset?.rs || mb.dataset.state || '';
          const initialRsText = (rs?.textContent || '').trim();
          const initialRsCode = rs?.dataset?.rs || '';
          const recordedSource = mb.dataset.problem || mb.dataset.formulation || '';

          const rsTransitions = [];
          const pushRs = () => {
            const txt = (rs?.textContent || '').trim();
            if (txt && rsTransitions[rsTransitions.length - 1] !== txt) {
              rsTransitions.push(txt);
            }
          };
          pushRs();

          const seenNotesSet = new Set();
          const seenTitlesSet = new Set();
          const harvestMbNotes = () => {
            const cap = (captionEl?.textContent || '').replace(/\s+/g, ' ').trim();
            if (cap) {
              seenNotesSet.add(`// ${cap}`);
              seenTitlesSet.add(cap);
            }
            for (const el of mb.querySelectorAll('.bb-note, .bb-explain, .bb-line, .mb-steps')) {
              const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
              if (t) seenNotesSet.add(`// ${t}`);
            }
          };
          harvestMbNotes();

          const rsObs = new MutationObserver(() => {
            pushRs();
            harvestMbNotes();
          });
          rsObs.observe(mb, {
            childList: true,
            characterData: true,
            subtree: true,
            attributes: true,
          });

          if (runBtn) {
            runBtn.click();
            pushRs();
            harvestMbNotes();
            const runStart = performance.now();
            while (
              rs?.dataset?.rs !== 'done' &&
              rs?.dataset?.rs !== 'error' &&
              performance.now() - runStart < 15000
            ) {
              await new Promise((r) => setTimeout(r, 15));
              pushRs();
              harvestMbNotes();
            }
            pushRs();
            harvestMbNotes();
          }
          rsObs.disconnect();

          const afterRunState = rs?.dataset?.rs || mb.dataset.state || '';
          const afterRunRsText = (rs?.textContent || '').trim();
          const afterRunRsCode = rs?.dataset?.rs || '';
          const finalCap = (captionEl?.textContent || '').replace(/\s+/g, ' ').trim();
          const afterRunError =
            afterRunState === 'error' || captionEl?.classList?.contains('error') ? finalCap : '';
          if (finalCap) {
            seenNotesSet.add(`// out: ${finalCap}`);
            seenTitlesSet.add(finalCap);
          }
          const finalNotes = finalCap ? [`// out: ${finalCap}`] : Array.from(seenNotesSet).slice(-2);

          // Reset to step 0 / idle, then test Step button
          if (resetBtn) {
            resetBtn.click();
          } else {
            let guard = 0;
            while (backBtn && !backBtn.disabled && guard++ < 50) {
              backBtn.click();
            }
          }
          await new Promise((r) => setTimeout(r, 20));
          if (stepBtn && !stepBtn.disabled) {
            stepBtn.click();
          }
          await new Promise((r) => setTimeout(r, 25));
          const afterStepState = rs?.dataset?.rs || mb.dataset.state || '';
          const stepsLabel = (stepsEl?.textContent || '').trim();
          const stepMatch = stepsLabel.match(/^step\s+(\d+)/i);
          const afterStepNum = stepMatch ? stepMatch[1] : afterStepState === 'run' ? '1' : '';
          const afterStepRsText = (rs?.textContent || '').trim();
          const afterStepHasCurrentLine = Boolean(boardHost && boardHost.children.length > 0);
          const afterStepHighlightVisible = Boolean(afterStepNum === '1');

          // Check editable input & Reset back to Not started
          const numInputs = Array.from(mb.querySelectorAll('.mb-num'));
          let matchesSource = false;
          let valLen = 0;
          if (mb.querySelector('.mp-input')) {
            const v = mb.querySelector('.mp-input').value;
            valLen = v.length;
            matchesSource = v === recordedSource && recordedSource.length > 0;
          } else if (numInputs.length >= 2) {
            const joined = numInputs.map((i) => i.value).join(',');
            valLen = joined.length;
            matchesSource = recordedSource.startsWith(numInputs[0].value) && valLen > 0;
          }
          if (resetBtn) {
            resetBtn.click();
          }
          await new Promise((r) => setTimeout(r, 20));
          const afterEditState = rs?.dataset?.rs || mb.dataset.state || '';
          const afterEditRsText = (rs?.textContent || '').trim();

          const appletEl = document.querySelector('.ma');
          const overflowPx =
            document.documentElement.scrollWidth - document.documentElement.clientWidth;

          return {
            viewerKind: 'mb',
            title,
            h1,
            viewerCount: mbAll.length,
            exampleId,
            overflowPx,
            applet: appletEl
              ? {
                  state: appletEl.dataset.state || '',
                  score: (appletEl.querySelector('.ma-score')?.textContent || '').trim(),
                }
              : null,
            recordingStatus: 200,
            recordedSourceLength: recordedSource.length,
            recordedOutputs: finalCap ? [finalCap] : [],
            initial: {
              state: initialState,
              rsText: initialRsText,
              rsCode: initialRsCode,
            },
            run: {
              rsTransitions,
              finalState: afterRunState,
              finalRsText: afterRunRsText,
              finalRsCode: afterRunRsCode,
              errorText: afterRunError,
              finalNotes,
              finalTitles: finalCap ? [finalCap] : [],
              seenNotes: Array.from(seenNotesSet),
              seenTitles: Array.from(seenTitlesSet),
            },
            step: {
              state: afterStepState,
              stepNum: afterStepNum,
              rsText: afterStepRsText,
              rsCode: afterStepState,
              hasCurrentLine: afterStepHasCurrentLine,
              highlightVisible: afterStepHighlightVisible,
            },
            edit: {
              state: afterEditState,
              rsText: afterEditRsText,
              rsCode: afterEditState,
              textareaVisible: Boolean(inputEl),
              valueLength: valLen,
              matchesRecordedSource: matchesSource,
              ariaPressed: 'true',
              btnDisabled: false,
            },
            nav: extractNav(),
          };
        }

        const svAll = Array.from(document.querySelectorAll('.sv[data-example]'));
        const sv = svAll[0];
        if (!sv) {
          return {
            error: 'No .sv[data-example] or .mb[data-example] found on page (legacy v1 page)',
            title,
            h1,
            viewerCount: 0,
            exampleId: '',
            recordingStatus: 0,
            recordedOutputs: [],
            initial: { state: '', rsText: '', rsCode: '' },
            run: {
              rsTransitions: [],
              finalState: '',
              finalRsText: '',
              errorText: 'No v2 viewer (.sv or .mb) found on page',
              finalNotes: [],
              finalTitles: [],
              seenNotes: [],
              seenTitles: [],
            },
            step: {
              state: '',
              stepNum: '',
              rsText: '',
              hasCurrentLine: false,
              highlightVisible: false,
            },
            edit: {
              state: '',
              rsText: '',
              textareaVisible: false,
              valueLength: 0,
              matchesRecordedSource: false,
              ariaPressed: '',
            },
            nav: extractNav(),
          };
        }

        const exampleId = sv.dataset.example || '';
        const rs = sv.querySelector('.sv-rs');
        const runBtn = sv.querySelector('.sv-run');
        const stepBtn = sv.querySelector('.sv-step');
        const editBtn = sv.querySelector('.sv-edit-btn');
        const viewEl = sv.querySelector('.sv-view');
        const editEl = sv.querySelector('.sv-edit');
        const hlEl = sv.querySelector('.sv-hl');
        const errEl = sv.querySelector('.sv-error');

        const initialState = sv.dataset.state || '';
        const initialRsText = (rs?.textContent || '').trim();
        const initialRsCode = rs?.dataset?.rs || '';

        // Fetch the recorded trace JSON directly to compare source & output events
        let recording = null;
        let recordingStatus = 0;
        try {
          const recResp = await fetch(`data/${exampleId}.json`);
          recordingStatus = recResp.status;
          if (recResp.ok) {
            recording = await recResp.json();
          }
        } catch (e) {
          recording = { fetchError: String(e) };
        }

        const recordedSource = typeof recording?.source === 'string' ? recording.source : '';
        const recordedEvents = Array.isArray(recording?.trace)
          ? recording.trace
              .map((line) => {
                try {
                  return JSON.parse(line);
                } catch {
                  return null;
                }
              })
              .filter(Boolean)
          : [];
        const recordedOutputs = recordedEvents
          .filter((e) => e.ev === 'output' && e.stream !== 'stderr')
          .map((e) => String(e.text ?? ''));

        // Track run-state transitions and all notes/titles rendered during playback
        const rsTransitions = [];
        const pushRs = () => {
          const txt = (rs?.textContent || '').trim();
          if (txt && rsTransitions[rsTransitions.length - 1] !== txt) {
            rsTransitions.push(txt);
          }
        };
        pushRs();

        const seenNotesSet = new Set();
        const seenTitlesSet = new Set();
        const harvestDomNotes = () => {
          for (const n of sv.querySelectorAll('.sv-note')) {
            const t = (n.textContent || '').trim();
            if (t) seenNotesSet.add(t);
          }
          for (const li of sv.querySelectorAll('.sv-line[title]')) {
            const t = li.getAttribute('title') || '';
            if (t) seenTitlesSet.add(t);
          }
        };
        harvestDomNotes();

        const rsObserver = new MutationObserver(pushRs);
        if (rs) {
          rsObserver.observe(rs, {
            childList: true,
            characterData: true,
            subtree: true,
            attributes: true,
          });
        }

        const viewObserver = new MutationObserver(harvestDomNotes);
        if (viewEl) {
          viewObserver.observe(viewEl, {
            childList: true,
            characterData: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['title'],
          });
        }

        // Click Run
        runBtn.click();
        pushRs();
        harvestDomNotes();

        // Wait until playback finishes (data-state="ended" or "error")
        const runStart = performance.now();
        while (
          sv.dataset.state !== 'ended' &&
          sv.dataset.state !== 'error' &&
          performance.now() - runStart < 20000
        ) {
          await new Promise((r) => setTimeout(r, 15));
          pushRs();
          harvestDomNotes();
        }
        pushRs();
        harvestDomNotes();

        rsObserver.disconnect();
        viewObserver.disconnect();

        const afterRunState = sv.dataset.state || '';
        const afterRunRsText = (rs?.textContent || '').trim();
        const afterRunRsCode = rs?.dataset?.rs || '';
        const afterRunError = !errEl?.hidden ? (errEl?.textContent || '').trim() : '';
        const finalNotes = Array.from(sv.querySelectorAll('.sv-note')).map((n) =>
          (n.textContent || '').trim()
        );
        const finalTitles = Array.from(sv.querySelectorAll('.sv-line[title]')).map(
          (li) => li.getAttribute('title') || ''
        );

        // Now test Step (.sv-step): from ended, clicking Step starts manual stepping at step 1
        stepBtn.click();
        await new Promise((r) => setTimeout(r, 40));
        const afterStep1State = sv.dataset.state || '';
        const afterStep1Num = sv.dataset.step || '';
        const afterStep1RsText = (rs?.textContent || '').trim();
        const afterStep1RsCode = rs?.dataset?.rs || '';
        const afterStep1HasCurrentLine = Boolean(
          sv.querySelector('.sv-line[aria-current="step"]')
        );
        const afterStep1HighlightVisible =
          (hlEl && !hlEl.hidden) || Boolean(sv.querySelector('.sv-ub'));

        // Now test Edit (.sv-edit-btn): clicking Edit enters edit mode and resets rs to Not started
        editBtn.click();
        await new Promise((r) => setTimeout(r, 30));
        const afterEditState = sv.dataset.state || '';
        const afterEditRsText = (rs?.textContent || '').trim();
        const afterEditRsCode = rs?.dataset?.rs || '';
        const afterEditTextareaVisible = Boolean(editEl && !editEl.hidden && viewEl?.hidden);
        const afterEditValue = editEl ? editEl.value : '';
        const afterEditAriaPressed = editBtn.getAttribute('aria-pressed') || '';
        const afterEditBtnDisabled = Boolean(editBtn.disabled);

        return {
          title,
          h1,
          viewerCount: svAll.length,
          exampleId,
          recordingStatus,
          recordedSourceLength: recordedSource.length,
          recordedOutputs,
          initial: {
            state: initialState,
            rsText: initialRsText,
            rsCode: initialRsCode,
          },
          run: {
            rsTransitions,
            finalState: afterRunState,
            finalRsText: afterRunRsText,
            finalRsCode: afterRunRsCode,
            errorText: afterRunError,
            finalNotes,
            finalTitles,
            seenNotes: Array.from(seenNotesSet),
            seenTitles: Array.from(seenTitlesSet),
          },
          step: {
            state: afterStep1State,
            stepNum: afterStep1Num,
            rsText: afterStep1RsText,
            rsCode: afterStep1RsCode,
            hasCurrentLine: afterStep1HasCurrentLine,
            highlightVisible: afterStep1HighlightVisible,
          },
          edit: {
            state: afterEditState,
            rsText: afterEditRsText,
            rsCode: afterEditRsCode,
            textareaVisible: afterEditTextareaVisible,
            valueLength: afterEditValue.length,
            matchesRecordedSource: afterEditValue === recordedSource && recordedSource.length > 0,
            ariaPressed: afterEditAriaPressed,
            btnDisabled: afterEditBtnDisabled,
          },
          nav: extractNav(),
        };
      });

      // Verify recordedOutputs vs observed seenNotes / seenTitles
      const recordedOutputs = evalData.recordedOutputs || [];
      const seenNotes = evalData.run?.seenNotes || [];
      const seenTitles = evalData.run?.seenTitles || [];
      const seenOutNotes = seenNotes.filter((n) => n.includes('out: '));

      const unmatchedOutputs = [];
      const matchedOutputs = [];
      for (const rawOut of recordedOutputs) {
        const clean = rawOut.replace(/\n$/, '');
        if (!clean) continue;
        const oneLine = clean.replace(/\n/g, '⏎');
        const shortNote = cutValue(oneLine, 35);
        const foundInTitle = seenTitles.some((t) => t.includes(clean));
        const foundInNote = seenNotes.some(
          (n) => n.includes(shortNote) || n.includes(cutValue(oneLine, 40))
        );
        if (foundInTitle || foundInNote) {
          matchedOutputs.push(oneLine);
        } else {
          unmatchedOutputs.push(oneLine);
        }
      }

      const outputMatchesRecording =
        recordedOutputs.filter((o) => o.replace(/\n$/, '').length > 0).length === 0
          ? seenOutNotes.length === 0
          : unmatchedOutputs.length === 0 && seenOutNotes.length > 0;

      // Check for leaked internals across all seen notes
      const leakedNotes = [];
      for (const n of seenNotes) {
        const leak = hasLeakedInternal(n);
        if (leak) {
          leakedNotes.push(`${leak} in "${n}"`);
        }
      }

      // Live browser click test on pager next (for first page) and pager prev (for last page)
      let pagerClickResult = null;
      if (p.isFirst && evalData.nav?.next) {
        const [nextResp] = await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
          page.click('nav.sv-pager a[rel="next"]'),
        ]);
        const nextH1 = await page.evaluate(
          () => document.querySelector('h1')?.textContent?.trim() || ''
        );
        pagerClickResult = {
          direction: 'next',
          expectedPath: evalData.nav.next.path,
          actualPath: new URL(page.url()).pathname,
          status: nextResp ? nextResp.status() : 200,
          h1: nextH1,
        };
      } else if (p.isFirst && evalData.nav?.allPages) {
        const [allResp] = await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
          page.click('nav.sv-pager a[href]'),
        ]);
        const allH1 = await page.evaluate(
          () => document.querySelector('h1')?.textContent?.trim() || ''
        );
        pagerClickResult = {
          direction: 'allPages',
          expectedPath: evalData.nav.allPages.path,
          actualPath: new URL(page.url()).pathname,
          status: allResp ? allResp.status() : 200,
          h1: allH1,
        };
      } else if (p.isLast && evalData.nav?.prev) {
        const [prevResp] = await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
          page.click('nav.sv-pager a[rel="prev"]'),
        ]);
        const prevH1 = await page.evaluate(
          () => document.querySelector('h1')?.textContent?.trim() || ''
        );
        pagerClickResult = {
          direction: 'prev',
          expectedPath: evalData.nav.prev.path,
          actualPath: new URL(page.url()).pathname,
          status: prevResp ? prevResp.status() : 200,
          h1: prevH1,
        };
      } else if (p.isLast && evalData.nav?.allPages) {
        const [allResp] = await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
          page.click('nav.sv-pager a[href]'),
        ]);
        const allH1 = await page.evaluate(
          () => document.querySelector('h1')?.textContent?.trim() || ''
        );
        pagerClickResult = {
          direction: 'allPages',
          expectedPath: evalData.nav.allPages.path,
          actualPath: new URL(page.url()).pathname,
          status: allResp ? allResp.status() : 200,
          h1: allH1,
        };
      }

      result.pages.push({
        slug: p.slug,
        urlPath: p.urlPath,
        isFirst: Boolean(p.isFirst),
        isLast: Boolean(p.isLast),
        bookOrderIndex: p.index,
        status,
        ...evalData,
        outputVerification: {
          recordedOutputCount: recordedOutputs.length,
          nonEmptyOutputCount: recordedOutputs.filter((o) => o.replace(/\n$/, '').length > 0)
            .length,
          seenOutNotesCount: seenOutNotes.length,
          seenOutNotesSample: seenOutNotes.slice(0, 5),
          matchedOutputsCount: matchedOutputs.length,
          unmatchedOutputs,
          outputMatchesRecording,
        },
        leakedNotes,
        pagerClickResult,
        consoleErrors: [...currentConsoleErrors],
        pageErrors: [...currentPageErrors],
        failedRequests: [...currentFailedRequests],
      });
    }
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
