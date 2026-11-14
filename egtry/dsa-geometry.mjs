// Geometry assertions are made at manual execution dwell, after its glide.
// A wide SVG may deliberately pan inside its figure; its whole content must be
// reachable there. Hidden/clipped overflow and collapsed pictures still fail.
export function pictureClipped(g, panel) {
  if (!Number.isFinite(g.width) || g.width < 40 || !Number.isFinite(g.height) || g.height <= 0) return true;
  const v = g.view;
  if (!v) return g.left < panel.left - 1 || g.right > panel.right + 1;
  if (v.width < 40 || v.left < panel.left - 1 || v.right > panel.right + 1) return true;
  if (g.left >= v.left - 1 && g.right <= v.right + 1) return false;
  return !['auto', 'scroll'].includes(v.overflowX) || g.contentLeft < -1 || g.contentRight > v.scrollWidth + 1;
}

export function geometryProblems(s, width) {
  const problems = [];
  if (s.svgs.some(g => pictureClipped(g, s.dg))) problems.push('a picture is cut off or collapsed');
  if (s.overflow > 1) problems.push(`sideways overflow ${s.overflow}px`);
  if (s.line) {
    if (s.line.top < s.win.top - 1 || s.line.bottom > s.win.bottom + 1) problems.push('the executing line is clipped by its source window');
    if (s.line.top < -1 || s.line.bottom > s.vh + 1) problems.push('the executing line is outside the viewport');
    if (width < 1000 && s.dg.top <= 1 && s.line.top < s.dg.bottom - 1) problems.push('the executing line is under the sticky diagram');
  }
  if (width < 1000) {
    if (s.bar.top < -1 || s.bar.bottom > s.vh + 1) problems.push('Run/Step controls are outside the viewport');
    if (Math.min(s.dg.bottom, s.vh) - Math.max(s.dg.top, 0) < Math.min(60, s.dg.height) - 1) problems.push('the diagram is outside the viewport');
  }
  return problems;
}

// One real mutation is enough (for example a pre-populated frequency map's
// single change of best). Static pictures or a missing change caption fail.
export const diagramChanges = (pictures, captions) => pictures >= 3 && captions >= 1;
