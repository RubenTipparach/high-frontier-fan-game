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
// CEO Solitaire is RELEASED (v1.2.0, open to every host). The V6 board-meeting
// engine is not wired yet, so the "expectations" slide states the variant's
// intent rather than reading live KPI numbers.

import { firedSvg, promotedSvg } from './ceo-art.js';
import { renderCard } from './card-ui.js';
import { PATENTS_BY_ID } from '../../data/patents.js';

// Render a real card into `host` and draw pulsing rings (with a small label) on
// the specific parts a tutorial slide is explaining. Parts map to the card's
// live DOM, so a ring always lands on the real glyph. Positioned off each part's
// bounding box after layout, so it must be called once the host is on screen.
const CARD_PART_SEL = {
  thrust: '.card-thrust',
  spectral: '.card-spectral',
  mass: '.card-statbox > span:nth-child(1)',
  rad: '.card-statbox > span:nth-child(2)',
  supports: '.card-supports',
};
const CARD_PART_LABEL = {
  thrust: 'Thrust + fuel', spectral: 'Spectral', mass: 'Mass', rad: 'Rad', supports: 'Supports',
};
function paintCardArt(host, { cardId, face = 'primary', parts = [] } = {}) {
  const card = PATENTS_BY_ID[cardId];
  if (!host || !card) return;
  host.innerHTML = '';
  let cardEl;
  try { cardEl = renderCard(card, { type: 'patent', face }); }
  catch { return; }
  cardEl.classList.add('tut-anatomy-card');
  host.appendChild(cardEl);
  const place = () => {
    const hostR = host.getBoundingClientRect();
    for (const p of parts) {
      const el = cardEl.querySelector(CARD_PART_SEL[p]);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const x = r.left - hostR.left, y = r.top - hostR.top;
      const ring = document.createElement('div');
      ring.className = 'tut-anatomy-ring';
      ring.style.left = (x - 4) + 'px';
      ring.style.top = (y - 4) + 'px';
      ring.style.width = (r.width + 8) + 'px';
      ring.style.height = (r.height + 8) + 'px';
      host.appendChild(ring);
      if (CARD_PART_LABEL[p]) {
        const lab = document.createElement('div');
        lab.className = 'tut-anatomy-label';
        lab.textContent = CARD_PART_LABEL[p];
        // Above the ring, nudged inside the host's left edge if it would clip.
        lab.style.left = Math.max(0, x - 4) + 'px';
        lab.style.top = Math.max(0, y - 4 - 16) + 'px';
        host.appendChild(lab);
      }
    }
  };
  // Two passes: once now, once next frame (the card's fonts / glyphs settle).
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(place);
  else setTimeout(place, 30);
}

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
      glyph: '🪐',
      bullets: [
        'The opportunity: water, metal, and glory beyond Earth',
        'The plan: prospect, claim, industrialize, settle',
        'What the Board expects of its CEO',
        'The ask: keep the program funded',
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

// Tutorial intro slides: what High Frontier IS, before Buggy the Rover walks you
// through your first mission. Reuses the CEO pitch's slide-deck styling so the
// tutorial opens with a short, readable briefing instead of dropping you in cold.
function tutorialSlides() {
  return [
    {
      kind: 'title',
      glyph: '🚀',
      title: 'HIGH FRONTIER',
      subtitle: 'Build an industrial empire across the solar system',
      footer: 'A quick briefing before your first mission',
    },
    {
      title: 'The Goal: Factories in Space',
      glyph: '🏭',
      bullets: [
        'High Frontier is a race to build FACTORIES out across the solar system.',
        'You score for every factory you own - more factories, more victory points.',
        'A factory is worth LESS as more factories of the SAME spectral type come online. Get there first, and spread across different types, to score the most.',
      ],
    },
    {
      title: 'How a Factory is Born',
      glyph: '⛏',
      kicker: 'Every factory starts with a claim',
      bullets: [
        'Fly a robonaut out to a site and PROSPECT it to stake your claim.',
        'INDUSTRIALIZE the claim - spend a robonaut and a refinery - to raise a factory.',
        'A factory refines the local water for fuel and can build new cards right there in space.',
      ],
    },
    {
      title: 'Black-Side Cards: Made in Space',
      glyph: '🛠',
      bullets: [
        'Every component card has a white side and a black (space-made) side.',
        'Black-side cards can ONLY be produced at a factory, out in space.',
        'They save precious fuel: you build the heavy parts where you need them, instead of hauling them up out of Earth\'s gravity.',
        'And they hand you advanced space technology to play with.',
      ],
    },
    {
      title: 'Anatomy of a Card',
      cardArt: { cardId: 'thr_pulsed_inductive', parts: ['thrust', 'spectral', 'mass', 'rad', 'supports'] },
      kicker: 'Every part reads the same way',
      bullets: [
        'On a thruster, the pink circle is its THRUST (how hard it pushes) and the water droplet is its FUEL per burn.',
        'The coloured hexagon is the SPECTRAL TYPE, which decides what a factory can produce from it.',
        'MASS is the part\'s weight and RAD HARDNESS is how well it survives radiation.',
        'The icons in the support row are what the card NEEDS to work.',
      ],
    },
    {
      title: 'Supports: Cards Power Each Other',
      cardArt: { cardId: 'thr_pulsed_inductive', parts: ['supports'] },
      kicker: 'A thruster never fires alone',
      bullets: [
        'A thruster needs POWER. Its support icons show what it requires - a reactor or a generator.',
        'Another card SUPPLIES that requirement, and it may need power in turn, so the parts form a CHAIN.',
        'Power flows down the chain to the thruster (reactor, then generator, then thruster). The thruster only lights up once the whole chain is satisfied.',
      ],
    },
    {
      title: 'Weight and Radiation',
      cardArt: { cardId: 'thr_pulsed_inductive', parts: ['mass', 'rad'] },
      bullets: [
        'MASS is weight. The more your ship carries, the heavier it flies and the LESS efficiently it moves.',
        'A heavier ship drops into a lower thrust band, so mass directly costs you movement.',
        'RAD HARDNESS is how well a card survives crossing radiation spaces. Low-rad-hardness cards degrade or break down when you fly through a hazard.',
      ],
    },
    {
      title: 'Fuel and Wet Mass',
      glyph: '💧',
      kicker: 'Fuel is mass too',
      bullets: [
        'The water you load into the tank is WET MASS, stacked on top of your ship\'s dry mass.',
        'The fuel strip tracks your ship\'s mass: every burn walks the wet-mass marker down toward dry mass.',
        'The higher the wet mass, the LESS each burn moves you. A heavy, full tank is inefficient; the lighter you get, the more each fuel step buys.',
      ],
    },
    {
      kind: 'close',
      glyph: '🤝',
      title: 'Your First Mission',
      subtitle: 'Follow Buggy the Rover: fly to Deimos, claim it, and raise your first two factories.',
      footer: 'Let us get to work.',
    },
  ];
}

let _activeOverlay = null;

// Play the CEO Solitaire boardroom pitch. Returns a promise that resolves when
// the player finishes or skips; `onDone` also fires for callback-style callers.
export function playCeoCutscene({ ceoName = '', rounds = 5, onDone } = {}) {
  return playDeck(slidesFor(ceoName, rounds), { onDone });
}

// Play the tutorial intro (what High Frontier is), same slide-deck styling.
export function playTutorialCutscene({ onDone } = {}) {
  return playDeck(tutorialSlides(), { chrome: 'HIGH FRONTIER · MISSION BRIEFING', onDone });
}

// Shared slide-deck player. `chrome` is the small footer stamp on each slide.
function playDeck(slides, { chrome = 'CONFIDENTIAL · Q1 1999 · Board of Directors', onDone } = {}) {
  // Never stack two cutscenes.
  if (_activeOverlay) { _activeOverlay.remove(); _activeOverlay = null; }
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
      const bulletsHtml = s.bullets
        ? `<ul class="ceo-bullets">${s.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`
        : (s.subtitle ? `<p class="ceo-subtitle">${esc(s.subtitle)}</p>` : '');
      if (s.customBody) {
        body = `<div class="ceo-slide-body ceo-slide-body-wide">${kicker}${s.customBody}${footer}</div>`;
      } else if (s.cardArt) {
        // A real card in the clipart slot; paintCardArt fills + rings it after mount.
        body = `<div class="ceo-slide-body">
            <div class="ceo-clipart ceo-clipart-card" aria-hidden="true"></div>
            <div class="ceo-slide-text">${kicker}${bulletsHtml}${footer}</div>
          </div>`;
      } else {
        body = `<div class="ceo-slide-body">
            <div class="ceo-clipart" aria-hidden="true">${s.glyph || ''}</div>
            <div class="ceo-slide-text">${kicker}${bulletsHtml}${footer}</div>
          </div>`;
      }
      deck.innerHTML = `
        <div class="ceo-projector">
          <div class="ceo-slide ceo-kind-${esc(s.kind || 'body')} ceo-anim-${dir === 'prev' ? 'prev' : 'next'}" key="${i}">
            <div class="ceo-titlebar"><span class="ceo-title">${esc(s.title)}</span></div>
            ${body}
            <div class="ceo-slide-chrome">
              <span class="ceo-confidential">${esc(chrome)}</span>
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
      if (s.cardArt) paintCardArt(deck.querySelector('.ceo-clipart-card'), s.cardArt);
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
