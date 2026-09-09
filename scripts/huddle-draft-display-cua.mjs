// root is tab.playwright or a verified frameLocator for the Huddle draft view.
// This adapter only checks the rendered app. It has no screen recorder dependency.
export function createHuddleDraftDisplay({ tab, root = tab.playwright, minimumVisibleMs = 400 }) {
  const observations = [];
  async function read() {
    return root.locator('body').evaluate(body => {
      const doc = body.ownerDocument, get = id => doc.getElementById(id), text = id => get(id)?.textContent || '';
      const width = doc.documentElement.clientWidth, height = doc.documentElement.clientHeight;
      const selectors = ['#preferred', '#safe', '#upside', '#selected', '#decision-reason', '#recent', '#roster', '#audit-status'];
      const allPanelsInFrame = selectors.every(selector => { const element = doc.querySelector(selector), box = element?.getBoundingClientRect();
        return box && element.getClientRects().length && box.left >= -1 && box.top >= -1 && box.right <= width + 2 && box.bottom <= height + 2; });
      return { observedAt: new Date().toISOString(), planId: body.dataset.decisionPlan || '', recommendationId: body.dataset.recommendationId || '',
        overallPick: Number(body.dataset.currentPick), selected: text('selected'), preferred: text('preferred'), safe: text('safe'), upside: text('upside'),
        reason: text('decision-reason'), allPanelsInFrame, stale: body.dataset.stale !== 'false', width, height,
        owned: [...(get('roster')?.children || [])].map(e => e.textContent), recent: [...(get('recent')?.children || [])].map(e => e.textContent) };
    });
  }
  async function confirm(expected, { timeoutMs = 3500 } = {}) {
    if (!/^[a-f0-9]{64}$/.test(expected.planId) || !/^[a-f0-9]{64}$/.test(expected.recommendationId)) throw Error('Display confirmation requires saved Huddle revisions');
    const body = root.locator(`body[data-decision-plan="${expected.planId}"][data-recommendation-id="${expected.recommendationId}"][data-current-pick="${expected.overallPick}"]`);
    await body.waitFor({ state: 'visible', timeoutMs });
    const first = await read();
    const valid = view => view.planId === expected.planId && view.recommendationId === expected.recommendationId && view.overallPick === expected.overallPick
      && view.preferred === expected.preferred && view.selected === expected.selected && view.safe && view.upside && view.allPanelsInFrame && !view.stale;
    if (!valid(first)) throw Object.assign(new Error('Huddle decision is stale, mismatched, or clipped in the draft view'), { code: 'DISPLAY_NOT_READY' });
    // Recheck that the displayed decision stays stable before input.
    if (minimumVisibleMs > 0) await tab.playwright.waitForTimeout(minimumVisibleMs);
    const stable = await read();
    if (!valid(stable)) throw Object.assign(new Error('The visible Huddle decision changed before input'), { code: 'DISPLAY_CHANGED' });
    observations.push(stable); return stable;
  }
  return { confirm, read, observations: () => structuredClone(observations) };
}
