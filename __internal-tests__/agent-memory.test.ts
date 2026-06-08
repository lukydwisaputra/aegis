import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { proposeLesson, pruneAgedEntries, readLessons } from '@qa/agent-memory';

const AGENT = 'qa-test-agent';
let aegisRoot: string;

beforeEach(() => {
  aegisRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-mem-test-'));
  fs.mkdirSync(path.join(aegisRoot, 'agent-memory', AGENT), { recursive: true });
  // Isolate the @qa/ids counter to this tmp dir — otherwise nextId() writes to the
  // shared repo .aegis/.counters.json, polluting it across runs (and eventually
  // pushing the lesson counter past 999, which breaks the L-{INITIALS}-{NNN} format).
  process.env['AEGIS_COUNTERS_PATH'] = path.join(aegisRoot, '.counters.json');
});

afterEach(() => {
  delete process.env['AEGIS_COUNTERS_PATH'];
  fs.rmSync(aegisRoot, { recursive: true, force: true });
});

const baseCandidate = {
  polarity: 'negative' as const,
  trigger: 'spv-rejection' as const,
  mistake: 'Skipped asserting response headers in API tests causing missed regressions',
  rootCause: 'Test focused on status code only and missed header validation entirely',
  correctiveRule: 'Always assert Content-Type and Cache-Control headers in API tests',
};

describe('@qa/agent-memory', () => {
  it('proposeLesson() appends a lesson entry', async () => {
    await proposeLesson(AGENT, baseCandidate, aegisRoot);
    const data = readLessons(AGENT, aegisRoot);
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0]!.rootCause).toBe(baseCandidate.rootCause);
  });

  it('deduplicates entries with Jaccard similarity >= 0.7 by incrementing hitCount', async () => {
    await proposeLesson(AGENT, {
      ...baseCandidate,
      rootCause: 'Test focused on status code only and missed header validation entirely here',
    }, aegisRoot);
    await proposeLesson(AGENT, {
      ...baseCandidate,
      rootCause: 'Test focused on status code only and missed header validation entirely there',
    }, aegisRoot);
    const data = readLessons(AGENT, aegisRoot);
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0]!.hitCount).toBeGreaterThanOrEqual(2);
  });

  it('returns outcome: appended for a new lesson', async () => {
    const result = await proposeLesson(AGENT, baseCandidate, aegisRoot);
    expect(result.outcome).toBe('appended');
  });

  it('returns outcome: deduped for a near-duplicate lesson', async () => {
    await proposeLesson(AGENT, baseCandidate, aegisRoot);
    const result = await proposeLesson(AGENT, {
      ...baseCandidate,
      rootCause: 'Test focused on status code only and missed header validation entirely again',
    }, aegisRoot);
    expect(result.outcome).toBe('deduped');
  });

  it('caps at 50 entries and evicts the lowest-hitCount oldest entry', async () => {
    // Each root cause uses entirely disjoint vocabulary to stay under Jaccard 0.7
    const rootCauses = [
      'login redirect bypassed when session cookie expires prematurely',
      'checkout total miscalculated due to rounding in currency conversion',
      'image upload silently dropped when mime type validation rejects png',
      'search pagination broken after filter combination clears offset state',
      'password reset email never sent because smtp queue exhausted retries',
      'notification badge count stale after background sync completes fetch',
      'date picker renders wrong month when locale timezone offset crosses midnight',
      'file download corrupted due to chunked encoding mishandled by proxy',
      'autocomplete dropdown hidden behind modal z-index overflow clipping',
      'websocket reconnect floods server after brief network interruption occurs',
      'csv export truncates rows beyond ten thousand due to memory cap hit',
      'oauth token refresh race condition causes concurrent requests to fail',
      'drag and drop reorder lost when mouseup fires outside drop target zone',
      'dark mode toggle reverts on page refresh because preference not persisted',
      'infinite scroll duplicates items when api returns same cursor twice',
      'form validation skipped entirely when submit triggered via keyboard enter',
      'chart tooltip renders offscreen when data point near right edge boundary',
      'session timeout countdown pauses when browser tab becomes inactive',
      'multilingual text truncated incorrectly because character width miscounted',
      'keyboard shortcut conflicts with browser native handler preventing action',
      'print stylesheet missing causing layout broken when user prints report',
      'table sort order reversed after column header clicked second consecutive time',
      'avatar initials show wrong letters when display name contains emoji character',
      'sidebar collapse animation stutters on safari due to transform hardware bug',
      'api rate limit error surfaced as generic server error hiding retry guidance',
      'bulk select deselects all items when last page navigated using pagination',
      'tooltip content overlaps adjacent element when viewport narrowed below breakpoint',
      'copy to clipboard fails silently in http context lacking secure origin',
      'drag handle invisible in high contrast accessibility mode due to color conflict',
      'focus ring disappears after modal closes returning focus to wrong element',
      'error boundary swallows thrown promise rejection hiding root exception cause',
      'currency symbol positioned incorrectly for right-to-left locales arabic persian',
      'video playback stalls when switching quality mid-stream on chrome mobile',
      'breadcrumb navigation missing last segment when url contains trailing slash',
      'skeleton loader never removed when data fetch returns empty successful response',
      'undo history wiped when document auto-saved overwriting local draft state',
      'color contrast ratio below wcag threshold on disabled button hover state',
      'number input accepts alphabetic characters bypassing schema validation entirely',
      'back button returns to wrong scroll position after navigating detail page',
      'icon font characters render as squares when font preload link tag absent',
      'step indicator skips completed state when revisiting earlier wizard section',
      'map marker cluster explodes incorrectly at certain zoom levels near boundary',
      'audio notification plays twice when multiple browser tabs receive same event',
      'filter chip removal triggers full page reload instead of partial state update',
      'progress bar overshoots hundred percent due to floating point accumulation',
      'cache invalidation misses related entity when parent record updated indirectly',
      'column resize handle unresponsive after table re-rendered with new dataset',
      'link preview card fetches external url even when user paste action cancelled',
      'status badge color wrong for pending state in legacy internet explorer browser',
      'empty state illustration hidden behind sticky header on small viewport devices',
    ];
    for (let i = 0; i < 50; i++) {
      await proposeLesson(AGENT, {
        ...baseCandidate,
        rootCause: rootCauses[i]!,
        correctiveRule: `Always verify scenario ${i + 1} behavior with targeted regression test coverage`,
      }, aegisRoot);
    }

    await proposeLesson(AGENT, {
      ...baseCandidate,
      rootCause: 'Brand new overflow lesson that has absolutely never appeared before in any run',
      correctiveRule: 'Always handle the overflow case with explicit boundary checking on entry',
    }, aegisRoot);

    const data = readLessons(AGENT, aegisRoot);
    expect(data.entries).toHaveLength(50);
    const found = data.entries.some((e) => e.rootCause.includes('Brand new overflow'));
    expect(found).toBe(true);
  });

  it('pruneAgedEntries() archives entries older than 90 days with hitCount < 2', async () => {
    const lessonsPath = path.join(aegisRoot, 'agent-memory', AGENT, 'lessons.json');
    const oldDate = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();

    const file = {
      agent: AGENT,
      schemaVersion: '1.0',
      lastUpdatedAt: new Date().toISOString(),
      entries: [
        { id: 'L-TA-001', polarity: 'negative', trigger: 'spv-rejection', mistake: 'Old stale lesson that should be pruned away from memory', rootCause: 'Root cause for old stale lesson that is no longer relevant', correctiveRule: 'Always fix old stale issues promptly to avoid accumulation', evidence: [], firstSeen: oldDate, lastSeen: oldDate, hitCount: 1 },
        { id: 'L-TA-002', polarity: 'negative', trigger: 'spv-rejection', mistake: 'Old but popular lesson that should be kept due to high hit count', rootCause: 'Root cause for popular lesson that recurs frequently across runs', correctiveRule: 'Always address popular recurring issues with systematic solutions', evidence: [], firstSeen: oldDate, lastSeen: oldDate, hitCount: 5 },
        { id: 'L-TA-003', polarity: 'negative', trigger: 'spv-rejection', mistake: 'Recent lesson that should be kept because it was seen recently', rootCause: 'Root cause for recent lesson that appeared in the latest run cycle', correctiveRule: 'Always treat recent lessons with priority over older accumulated ones', evidence: [], firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString(), hitCount: 1 },
      ],
    };
    fs.writeFileSync(lessonsPath, JSON.stringify(file));

    await pruneAgedEntries(AGENT, aegisRoot);

    const data = readLessons(AGENT, aegisRoot);
    const ids = data.entries.map((e) => e.id);
    expect(ids).not.toContain('L-TA-001');
    expect(ids).toContain('L-TA-002');
    expect(ids).toContain('L-TA-003');
  });
});
