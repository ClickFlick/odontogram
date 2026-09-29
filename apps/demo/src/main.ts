import {
  ALL_TEETH,
  DEFAULT_THEME,
  DentalViewer,
  TOOTH_STATUSES,
  formatTooth,
  toPalmer,
  toUniversal,
  toothName,
  type Fdi,
  type JawFilter,
  type MissingMode,
  type Numbering,
  type TeethStates,
  type ToothStatus,
  type ViewName,
} from '@oozkul/dental-3d';

// ---------------------------------------------------------------------------------------------
// fake clinical data (what a real app would fetch)

interface Visit {
  date: string;
  title: string;
  note: string;
}

const visits: Visit[] = [
  {
    date: '2026-09-12',
    title: 'Check-up',
    note: 'Routine check. Tooth 36 filling intact, mild sensitivity on 26. Recommended fluoride varnish on 26 and 27.',
  },
  {
    date: '2026-05-03',
    title: 'Composite filling',
    note: 'Occlusal composite on 36 after caries removal. Anaesthesia 1.7 ml. Patient tolerated well.',
  },
  {
    date: '2026-02-18',
    title: 'Crown cementation',
    note: 'Zirconia crown cemented on 11. Occlusion checked against 41 and 42.',
  },
  {
    date: '2025-11-27',
    title: 'Crown preparation',
    note: 'Prepared 11 for full crown. Temporary crown placed. Impression taken.',
  },
  {
    date: '2025-08-09',
    title: 'Extraction',
    note: 'Extracted 24 (vertical root fracture). Sutures placed. Implant on 24 discussed.',
  },
  {
    date: '2025-06-30',
    title: 'Root canal',
    note: 'Completed endodontic treatment on 46, three canals obturated. Follow-up radiograph in 6 months.',
  },
  {
    date: '2025-03-15',
    title: 'Implant placement',
    note: 'Implant placed on 47. Healing abutment. Review 3 months.',
  },
  {
    date: '2024-12-02',
    title: 'Veneers',
    note: 'Porcelain veneers on 12 and 22 bonded. Shade A1.',
  },
  {
    date: '2024-10-19',
    title: 'Emergency',
    note: 'Pain on 18. Pericoronitis, irrigation and chlorhexidine. Extraction of 18 planned.',
  },
];

const initialStates: TeethStates = {
  '11': { status: 'crown' },
  '12': { status: 'veneer' },
  '22': { status: 'veneer' },
  '24': { status: 'missing' },
  '26': { status: 'attention' },
  '36': { status: 'filling' },
  '46': { status: 'root-canal' },
  '47': { status: 'implant' },
  '18': { status: 'extraction-planned' },
  '35': { status: 'bridge' },
  '37': { status: 'bridge' },
};

function mentions(fdi: Fdi): Visit[] {
  const re = new RegExp(`(^|[^0-9])${fdi}([^0-9]|$)`);
  return visits.filter((v) => re.test(v.note));
}

/** Adds visit counts as badges, like the Echo integration will. */
function withBadges(states: TeethStates): TeethStates {
  const out: TeethStates = {};
  for (const fdi of ALL_TEETH) {
    const count = mentions(fdi).length;
    const base = states[fdi];
    if (!base && count === 0) continue;
    out[fdi] = { ...base, ...(count ? { badge: count } : {}) };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// theme toggle (the library follows the CSS variables automatically)

const root = document.documentElement;
const themeToggle = document.getElementById('theme-toggle') as HTMLButtonElement;
const storedTheme = localStorage.getItem('dental-3d-demo-theme');
if (
  storedTheme === 'dark' ||
  (!storedTheme && matchMedia('(prefers-color-scheme: dark)').matches)
) {
  root.classList.add('dark');
}
themeToggle.setAttribute('aria-pressed', String(root.classList.contains('dark')));
themeToggle.addEventListener('click', () => {
  const dark = root.classList.toggle('dark');
  localStorage.setItem('dental-3d-demo-theme', dark ? 'dark' : 'light');
  themeToggle.setAttribute('aria-pressed', String(dark));
});

// ---------------------------------------------------------------------------------------------
// viewer

const numberingSelect = document.getElementById('numbering') as HTMLSelectElement;
const missingSelect = document.getElementById('missing-mode') as HTMLSelectElement;
const savedNumbering =
  (localStorage.getItem('dental-3d-demo-numbering') as Numbering | null) ?? 'fdi';
numberingSelect.value = savedNumbering;

let states = initialStates;
const viewer = new DentalViewer({
  container: document.getElementById('viewer')!,
  labels: true,
  numbering: savedNumbering,
  teeth: withBadges(states),
});

viewer.on('error', (e) => console.error('dental-3d failed to load', e.error));
if (import.meta.env.DEV) (window as unknown as { __dental: DentalViewer }).__dental = viewer;

// toolbar --------------------------------------------------------------------------------------

const viewButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-view]')];
for (const btn of viewButtons) {
  btn.addEventListener('click', () => {
    const view = btn.dataset['view'] as ViewName;
    viewer.setView(view);
    // occlusal views are only useful with the other jaw out of the way
    if (view === 'upper-occlusal') setJaw('upper');
    else if (view === 'lower-occlusal') setJaw('lower');
    for (const b of viewButtons) b.setAttribute('aria-pressed', String(b === btn));
  });
}

const jawButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-jaw]')];
function setJaw(jaw: JawFilter): void {
  viewer.setJaw(jaw);
  for (const b of jawButtons) b.setAttribute('aria-pressed', String(b.dataset['jaw'] === jaw));
}
for (const btn of jawButtons) {
  btn.addEventListener('click', () => setJaw(btn.dataset['jaw'] as JawFilter));
}

const openToggle = document.getElementById('open-toggle') as HTMLButtonElement;
openToggle.addEventListener('click', () => {
  const open = !viewer.open;
  viewer.setOpen(open);
  openToggle.setAttribute('aria-pressed', String(open));
  openToggle.textContent = open ? 'Close mouth' : 'Open mouth';
});

const labelsToggle = document.getElementById('labels-toggle') as HTMLButtonElement;
labelsToggle.addEventListener('click', () => {
  const on = !viewer.labels;
  viewer.setLabels(on);
  labelsToggle.setAttribute('aria-pressed', String(on));
});

numberingSelect.addEventListener('change', () => {
  const n = numberingSelect.value as Numbering;
  viewer.setNumbering(n);
  localStorage.setItem('dental-3d-demo-numbering', n);
  if (viewer.selected) renderPanel(viewer.selected);
});

missingSelect.addEventListener('change', () =>
  viewer.setMissingMode(missingSelect.value as MissingMode),
);

// side panel -----------------------------------------------------------------------------------

const panelEmpty = document.getElementById('panel-empty')!;
const panelTooth = document.getElementById('panel-tooth')!;
const statusSelect = document.getElementById('status') as HTMLSelectElement;
for (const s of TOOTH_STATUSES) {
  const opt = document.createElement('option');
  opt.value = s;
  opt.textContent = s;
  statusSelect.appendChild(opt);
}
statusSelect.addEventListener('change', () => {
  const fdi = viewer.selected;
  if (!fdi) return;
  const status = statusSelect.value as ToothStatus;
  states = { ...states, [fdi]: { ...states[fdi], status } };
  viewer.setTeeth(withBadges(states));
});
document.getElementById('clear')!.addEventListener('click', () => viewer.select(null));

function renderPanel(fdi: Fdi | null): void {
  panelEmpty.hidden = fdi !== null;
  panelTooth.hidden = fdi === null;
  if (!fdi) return;
  document.getElementById('tooth-code')!.textContent = formatTooth(fdi, viewer.numbering);
  document.getElementById('tooth-name')!.textContent = toothName(fdi);
  document.getElementById('meta-fdi')!.textContent = fdi;
  document.getElementById('meta-universal')!.textContent = String(toUniversal(fdi));
  document.getElementById('meta-palmer')!.textContent = toPalmer(fdi);
  statusSelect.value = states[fdi]?.status ?? 'present';
  const list = document.getElementById('history')!;
  list.textContent = '';
  const found = mentions(fdi);
  if (found.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = `No visits mention tooth ${fdi} yet.`;
    list.appendChild(li);
    return;
  }
  for (const v of found) {
    const li = document.createElement('li');
    const time = document.createElement('time');
    time.dateTime = v.date;
    time.textContent = new Date(v.date).toLocaleDateString(undefined, { dateStyle: 'medium' });
    const strong = document.createElement('strong');
    strong.textContent = v.title;
    const p = document.createElement('div');
    const re = new RegExp(`(^|[^0-9])(${fdi})([^0-9]|$)`, 'g');
    p.innerHTML = escapeHtml(v.note).replace(re, '$1<mark>$2</mark>$3');
    li.append(time, strong, p);
    list.appendChild(li);
  }
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

viewer.on('select', (e) => renderPanel(e.fdi));

// legend ----------------------------------------------------------------------------------------

const legend = document.getElementById('legend')!;
for (const status of TOOTH_STATUSES) {
  const btn = document.createElement('button');
  btn.type = 'button';
  const sw = document.createElement('span');
  sw.className = 'swatch';
  sw.style.background =
    status === 'present'
      ? DEFAULT_THEME.tooth
      : DEFAULT_THEME.statuses[status as keyof typeof DEFAULT_THEME.statuses];
  if (status === 'missing') sw.style.opacity = '0.35';
  btn.append(sw, document.createTextNode(status));
  btn.title = `Select a tooth with status "${status}"`;
  btn.addEventListener('click', () => {
    const fdi = ALL_TEETH.find((f) => (states[f]?.status ?? 'present') === status);
    if (fdi) viewer.select(fdi, { focus: true });
  });
  legend.appendChild(btn);
}
