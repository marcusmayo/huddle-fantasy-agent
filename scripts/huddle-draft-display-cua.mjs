// root is tab.playwright or a verified frameLocator for the Huddle draft view.
// This adapter only checks the rendered app. It has no screen recorder dependency.
export function readHuddleDraftDocument(body = document.body) {
      const doc = body.ownerDocument, get = id => doc.getElementById(id), text = id => get(id)?.textContent || '';
      const width = doc.documentElement.clientWidth, height = doc.documentElement.clientHeight;
      const selectors = ['#preferred', '#safe', '#upside', '#selected', '#decision-reason', '#recent', '#roster', '#audit-status'];
      const allPanelsInFrame = selectors.every(selector => { const element = doc.querySelector(selector), box = element?.getBoundingClientRect();
        return box && element.getClientRects().length && box.left >= -1 && box.top >= -1 && box.right <= width + 2 && box.bottom <= height + 2; });
      return { observedAt: new Date().toISOString(), sessionId:body.dataset.sessionId,leagueId:body.dataset.leagueId,completed:body.dataset.complete==='true',turnAgreement:body.dataset.turnAgreement,
        choices:['preferred','safe','upside'].map(id=>({name:text(id),yahooPlayerId:(get(id)?.dataset.playerId||'').split('.p.').at(-1),position:get(id)?.dataset.position,team:get(id)?.dataset.team})),
        accepted:[...(get('roster')?.children||[])].map(e=>({overallPick:Number(e.dataset.overallPick),yahooPlayerId:(e.dataset.playerId||'').split('.p.').at(-1)})),
        planId: body.dataset.decisionPlan || '', recommendationId: body.dataset.recommendationId || '',
        overallPick: Number(body.dataset.currentPick), selected: text('selected'), preferred: text('preferred'), safe: text('safe'), upside: text('upside'),
        reason: text('decision-reason'), allPanelsInFrame, stale: body.dataset.stale !== 'false', width, height,
        owned: [...(get('roster')?.children || [])].map(e => e.textContent), recent: [...(get('recent')?.children || [])].map(e => e.textContent) };
}

export function createHuddleDraftDisplay({ tab, root = tab.playwright, minimumVisibleMs = 400, now = Date.now }) {
  const observations = [];
  async function read({ timeoutMs = 3000 } = {}) {
    // In the observed in-app browser, BODY locator evaluation timed out while
    // direct document evaluation succeeded on the same visible draft page.
    return root === tab.playwright
      ? root.evaluate(readHuddleDraftDocument, undefined, { timeoutMs })
      : root.locator('body').evaluate(readHuddleDraftDocument, undefined, { timeoutMs });
  }
  async function confirm(expected, { timeoutMs = 3500, signal } = {}) {
    if (!/^[a-f0-9]{64}$/.test(expected.planId) || !/^[a-f0-9]{64}$/.test(expected.recommendationId)) throw Error('Display confirmation requires saved Huddle revisions');
    const until = now() + timeoutMs;
    const left = () => {
      if (signal?.aborted || until-now() < 80) throw Object.assign(new Error('Display verification exhausted its active invocation budget'), { code:'DISPLAY_DEADLINE' });
      return Math.floor(until-now());
    };
    const matching = view => view.planId === expected.planId && view.recommendationId === expected.recommendationId && view.overallPick === expected.overallPick;
    let first = await read({timeoutMs:left()});
    while (!matching(first)) {
      await tab.playwright.waitForTimeout(Math.min(80,left()));
      first = await read({timeoutMs:left()});
    }
    const valid = view => matching(view)
      && view.preferred === expected.preferred && view.selected === expected.selected && view.safe && view.upside && view.allPanelsInFrame && !view.stale;
    if (!valid(first)) throw Object.assign(new Error('Huddle decision is stale, mismatched, or clipped in the draft view'), { code: 'DISPLAY_NOT_READY' });
    // Recheck that the displayed decision stays stable before input.
    if (minimumVisibleMs > 0) {
      if (left() < minimumVisibleMs + 80) throw Object.assign(new Error('Insufficient time to verify a stable displayed decision'), { code:'DISPLAY_DEADLINE' });
      await tab.playwright.waitForTimeout(minimumVisibleMs);
    }
    const stable = await read({timeoutMs:left()});
    left();
    if (!valid(stable)) throw Object.assign(new Error('The visible Huddle decision changed before input'), { code: 'DISPLAY_CHANGED' });
    observations.push(stable); return stable;
  }
  return { confirm, read, observations: () => structuredClone(observations) };
}
