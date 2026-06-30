// CEO Solitaire - intro cutscene.
//
// A staged, full-screen "boardroom pitch" the player sees once when a CEO
// Solitaire room starts. It is dressed as a 1999-era corporate slide deck (the
// beveled gradient title bars, serif headings, square bullets, projector-screen
// frame) so the player steps into the CEO chair: you are pitching your 40-70
// year space plan to the Board of Directors, who will judge you against a rising
// expectation (the KPI) every cycle.
//
// Player-facing copy talks about the GAME (the company, the Board, the plan),
// never the engine (Style rule). Built on the same .card-modal-overlay pattern
// the crew wizard uses; tear down with .remove() on finish/skip.
//
// ADMIN-PREVIEW only for now (CEO Solitaire is gated). The V6 board-meeting
// engine is not wired yet, so the "expectations" slide states the variant's
// intent rather than reading live KPI numbers.

import { firedSvg, promotedSvg } from './ceo-art.js';

const COMPANY = 'ASTRA DYNAMICS';
// Each Solar Cycle (board meeting interval) is 12 in-game years, so the plan's
// horizon is the selected game length times 12 (4 rounds = 48 years, 7 = 84).
const YEARS_PER_ROUND = 12;

// Each slide: a title, an optional kicker line, body bullets (or a custom html
// block), and a big "clip-art" glyph in the era's spirit.
function slidesFor(ceoName, rounds) {
  const ceo = ceoName ? `@${ceoName}` : 'the new CEO';
  const r = [4, 5, 6, 7].includes(Number(rounds)) ? Number(rounds) : 5;
  const years = r * YEARS_PER_ROUND;
  // "an 84-year" (eighty) vs "a 48-year" (forty): vowel sound on 8x / 11 / 18.
  const article = /^(8|11|18)/.test(String(years)) ? 'An' : 'A';
  return [
    {
      kind: 'title',
      glyph: '🚀',
      title: COMPANY,
      subtitle: `${article} ${years}-Year Plan for the Solar Frontier`,
      footer: `Presented to the Board of Directors by ${ceo}`,
    },
    {
      title: 'Agenda',
      glyph: '📋',
      bullets: [
        'The opportunity: water, metal, and glory beyond Earth',
        'The plan: prospect, claim, industrialize, settle',
        'What the Board expects of its CEO',
        'The ask: keep the program funded',
      ],
    },
    {
      title: 'The Opportunity',
      glyph: '🪐',
      kicker: 'Why we go',
      bullets: [
        'The inner system is a desert of dry rock and the odd ice patch',
        'Every claimed site is a foothold; every factory pays for the next',
        'First to a milestone takes the glory, and the glory takes the headlines',
        'Rivals are not the threat. Standing still is.',
      ],
    },
    {
      title: 'The Plan',
      glyph: '🏭',
      kicker: 'Four phases, one company',
      bullets: [
        'PROSPECT: scout sites, roll the dice, prove the water is there',
        'CLAIM: plant our disc before anyone else can',
        'INDUSTRIALIZE: stand up a factory and turn dirt into product',
        'SETTLE: domes, colonies, and a Bernal station to crown it all',
      ],
    },
    {
      title: 'What the Board Expects',
      glyph: '📈',
      kicker: `Every ${YEARS_PER_ROUND} years, we meet`,
      bullets: [
        'The Board convenes each Solar Cycle to judge the program',
        'They set a number. Hit it, and you keep your chair',
        'Each cycle the number rises. Yesterday’s success is today’s baseline',
        'Lives lost on the pad are remembered. Do not bring us fatalities.',
      ],
    },
    {
      kind: 'scoring',
      title: 'Meet the Number, or Else',
      kicker: 'At each board meeting your victory points are tallied against the demand',
      customBody: `
        <div class="ceo-outcomes">
          <figure class="ceo-outcome is-good">
            ${promotedSvg('ceo-outcome-art')}
            <figcaption><strong>Meet expectations</strong><span>Promoted. More stock options, a bigger mandate, and your chair for another cycle.</span></figcaption>
          </figure>
          <figure class="ceo-outcome is-bad">
            ${firedSvg('ceo-outcome-art')}
            <figcaption><strong>Fall short</strong><span>You are fired. The program ends and so does your tenure.</span></figcaption>
          </figure>
        </div>`,
    },
    {
      kind: 'close',
      glyph: '🤝',
      title: 'The Ask',
      subtitle: 'Fund the program. Make the company money. Earn your seat.',
      footer: 'Ladies and gentlemen of the Board, let us begin.',
    },
  ];
}

let _activeOverlay = null;

// Play the intro cutscene. Returns a promise that resolves when the player
// finishes or skips. `onDone` is also called for callers that prefer a callback.
export function playCeoCutscene({ ceoName = '', rounds = 5, onDone } = {}) {
  // Never stack two cutscenes.
  if (_activeOverlay) { _activeOverlay.remove(); _activeOverlay = null; }

  const slides = slidesFor(ceoName, rounds);
  let i = 0;

  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay ceo-cutscene-overlay';
  overlay.tabIndex = -1;
  _activeOverlay = overlay;

  const deck = document.createElement('div');
  deck.className = 'ceo-deck';
  overlay.appendChild(deck);

  return new Promise((resolve) => {
    const finish = () => {
      document.removeEventListener('keydown', onKey);
      if (_activeOverlay === overlay) _activeOverlay = null;
      overlay.classList.add('is-closing');
      setTimeout(() => overlay.remove(), 180);
      if (typeof onDone === 'function') onDone();
      resolve();
    };

    // dir: 'next' (advance) slides the new slide in from the RIGHT; 'prev'
    // (back) slides it in from the LEFT. Either way the deck reads as moving
    // right to left as you advance.
    const render = (dir = 'next') => {
      const s = slides[i];
      const isFirst = i === 0;
      const isLast = i === slides.length - 1;
      const kicker = s.kicker ? `<p class="ceo-kicker">${esc(s.kicker)}</p>` : '';
      const footer = s.footer ? `<p class="ceo-slide-footer">${esc(s.footer)}</p>` : '';
      // A scoring/custom slide owns its full body (its own illustrations); a
      // normal slide is the clipart glyph + a text column.
      let body;
      if (s.customBody) {
        body = `<div class="ceo-slide-body ceo-slide-body-wide">${kicker}${s.customBody}${footer}</div>`;
      } else {
        const bodyHtml = s.bullets
          ? `<ul class="ceo-bullets">${s.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`
          : (s.subtitle ? `<p class="ceo-subtitle">${esc(s.subtitle)}</p>` : '');
        body = `<div class="ceo-slide-body">
            <div class="ceo-clipart" aria-hidden="true">${s.glyph || ''}</div>
            <div class="ceo-slide-text">${kicker}${bodyHtml}${footer}</div>
          </div>`;
      }
      deck.innerHTML = `
        <div class="ceo-projector">
          <div class="ceo-slide ceo-kind-${esc(s.kind || 'body')} ceo-anim-${dir === 'prev' ? 'prev' : 'next'}" key="${i}">
            <div class="ceo-titlebar"><span class="ceo-title">${esc(s.title)}</span></div>
            ${body}
            <div class="ceo-slide-chrome">
              <span class="ceo-confidential">CONFIDENTIAL · Q1 1999 · Board of Directors</span>
              <span class="ceo-pagenum">${i + 1} / ${slides.length}</span>
            </div>
          </div>
        </div>
        <div class="ceo-controls">
          <button type="button" class="ceo-skip">Skip intro</button>
          <div class="ceo-nav">
            <button type="button" class="ceo-back"${isFirst ? ' disabled' : ''}>‹ Back</button>
            <button type="button" class="ceo-next primary">${isLast ? 'Begin ▸' : 'Next ›'}</button>
          </div>
        </div>`;
      deck.querySelector('.ceo-skip').addEventListener('click', finish);
      deck.querySelector('.ceo-back').addEventListener('click', () => { if (i > 0) { i--; render('prev'); } });
      deck.querySelector('.ceo-next').addEventListener('click', () => {
        if (isLast) finish();
        else { i++; render('next'); }
      });
    };

    const onKey = (e) => {
      if (e.key === 'Escape') finish();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        if (i === slides.length - 1) finish(); else { i++; render('next'); }
      } else if (e.key === 'ArrowLeft') { if (i > 0) { i--; render('prev'); } }
    };

    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    overlay.focus();
    render();
  });
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
