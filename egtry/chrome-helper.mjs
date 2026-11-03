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
const { book, host, pages } = plan;
const baseOrigin = `https://${host}`;
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
    // in player.ts (MAX_FRAME_GAP = 250ms; at most one step starts per frame).
    await context.addInitScript(() => {
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
    // 1. Check /tracks/programming-languages/ and click the /<book>/ link
    // -------------------------------------------------------------------------
    resetDiagnostics();
    const tracksUrl = `${baseOrigin}/tracks/programming-languages/`;
    const tracksResp = await page.goto(tracksUrl, {
      waitUntil: 'domcontentloaded',
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

    result.tracks = {
      url: tracksUrl,
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
            u.pathname.endsWith('/')
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

      // Wait for all .sv[data-example] viewers on the page to mount and reach data-state="ready"
      await page.waitForFunction(
        () => {
          const all = Array.from(document.querySelectorAll('.sv[data-example]'));
          return all.length > 0 && all.every((el) => el.dataset.state === 'ready');
        },
        { timeout: 15000 }
      );

      // Run in-page lifecycle verification on the primary viewer (.sv):
      //   1. Capture initial state ("ready", "○ Not started") & fetch data/<example>.json
      //   2. Click Run (.sv-run) -> observe "○ Not started" -> "▶ Running" -> "■ Ended"
      //      and capture all .sv-note and .sv-line[title] strings across the run
      //   3. Click Step (.sv-step) -> verify data-state="stepping", data-step="1", "▶ Running", active line
      //   4. Click Edit (.sv-edit-btn) -> verify data-state="edit", textarea visible with source, "○ Not started"
      const evalData = await page.evaluate(async () => {
        const title = document.title || '';
        const h1 = document.querySelector('h1')?.textContent?.trim() || '';
        const svAll = Array.from(document.querySelectorAll('.sv[data-example]'));
        const sv = svAll[0];
        if (!sv) {
          return { error: 'No .sv[data-example] found on page', title, h1 };
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

        // Extract breadcrumbs and pager links
        const resolvePath = (href) => {
          if (!href) return '';
          try {
            return new URL(href, location.href).pathname;
          } catch {
            return href;
          }
        };
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
          nav: {
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
          },
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
