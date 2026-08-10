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
import { hermesTargetSites, hermesProspectWaived } from '../../data/hermes.js';

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

// V5 Hermes Fall briefing: the threat, the mission, the means, and the clock.
// `turnsLeft` is the live countdown (data/hermes.js#turnsToImpact), so a replay
// mid-mission opens on the time actually remaining rather than the full 24.
// `seats` forks the briefing between the solo mission and a cooperative table:
// the deflection belongs to everyone at the table, so a co-op reader must not be
// told they are the only program that can reach it, and must be told plainly
// that a team-mate's factory turns the rock just as well as their own.
function hermesSlides(turnsLeft, done, seats) {
  const n = Math.max(1, seats | 0);
  const coop = n > 1;
  // The mission SCALES with the table (user 2026-08-07), and the briefing is
  // where a player finds that out - so it states this table's terms, not the
  // scenario's in general. Three seats owe a third site; two or more lose the
  // prospecting waiver and need an ISRU-0 rig for the bare halves.
  const targets = hermesTargetSites(n);
  const needCount = targets.length;
  const withNeujmin = n >= 3;
  const isruGated = !hermesProspectWaived(n);
  const left = Math.max(0, turnsLeft | 0);
  const cycles = Math.max(1, Math.ceil(left / 12));
  // The closing line has to read truthfully at any point in the mission: before
  // either half is planted, after one, and once the clock has actually run out.
  const clockLine = left <= 0
    ? 'Time is up.'
    : `${left} turn${left === 1 ? '' : 's'} to impact.`;
  const progress = done >= needCount ? 'Every site is under thrust. Hermes will miss.'
    : done > 0 ? `${done} of ${needCount} sites under thrust. The rest are still coming.`
      : 'Nothing is under thrust yet.';
  return [
    {
      kind: 'title',
      glyph: '☄️',
      title: 'HERMES FALL',
      subtitle: 'A binary asteroid on an Earth-crossing path',
      footer: 'Priority One - Planetary Defence',
    },
    {
      title: 'The Threat',
      glyph: '🌍',
      kicker: 'Hermes is not one rock. It is two.',
      bullets: [
        'Two bodies, locked together, headed for Earth',
        'Nudging one is not enough - both must be turned',
        ...(withNeujmin ? ['Comet Neujmin 1 crosses the same path. Secure it too'] : []),
        'There is no evacuation plan. There is only the deflection',
      ],
      footer: coop
        ? 'Between you, yours are the only programs that can reach it in time.'
        : 'You are the only program that can reach it in time.',
    },
    {
      title: 'The Mission',
      glyph: '🏭',
      kicker: withNeujmin
        ? 'Plant a factory on BOTH halves AND on Comet Neujmin 1'
        : 'Plant a factory on BOTH halves',
      bullets: [
        'Each factory drives thrusters off the body\'s own regolith',
        isruGated
          ? 'The halves are bare rock - hydration 0 - so claiming one takes a robonaut whose ISRU reads 0'
          : 'Prospecting either half is automatic - the rock is bare, so any rig can read it',
        ...(withNeujmin ? ['Neujmin is a comet: prospect it against its own hydration, the ordinary way'] : []),
        'Each build additionally spends an operational dirt rocket, burned into the works',
        'The Mass Driver is near the top of the thruster deck. Get it.',
        ...(coop ? ['Whose factory it is does not matter. Split the sites and go'] : []),
      ],
      footer: coop
        ? `${needCount} factories, ${needCount} turned bodies, one saved planet. You win or lose together.`
        : 'Two factories, two turned rocks, one saved planet.',
    },
    {
      kind: 'close',
      glyph: '⏳',
      title: 'The Clock',
      subtitle: clockLine,
      footer: `${progress} You have ${cycles} Solar Cycle${cycles === 1 ? '' : 's'} of funding. Go.`,
    },
  ];
}

// V9 The Sirens briefing: who you are, where home is, and the handful of rules
// that are not the base game. FOUR shapes, because two things fork it.
//
//  - `solo` vs a table: the solitaire route runs the CEO board loop and cuts the
//    library by spectral type, while a mixed table splits it in half by species
//    and has First Contact to play for.
//  - `species`: a seat in a Sirens game may be SIRENIAN or EARTHLING, in solo as
//    much as at a table. The briefing used to address every reader as a Siren,
//    which told an Earthling host that their home was Cordelia and that their
//    crew read rad-hardness 0 - both false for them. Every "you" below is
//    therefore written from the reader's own side.
function sirensSlides(solo, species) {
  const siren = species !== 'earthling';   // unknown reads as the Sirenian side
  const common = [
    {
      kind: 'title',
      glyph: '🌊',
      title: 'THE SIRENS',
      subtitle: 'Carbon-based life from the supercritical diamond oceans of Uranus',
      footer: 'V9 - by Pawel Garycki and Phil Eklund',
    },
    siren ? {
      title: 'Home Is Cordelia',
      glyph: '🪐',
      kicker: 'You do not launch from Earth orbit',
      bullets: [
        'Cordelia is your LEO: your aqua bank, and where boosted cards arrive',
        'Crew retire there, and the Free Market sells there',
        'A pad explosion happens there too - it is home in every sense',
        'Luna and the Uranus Aerostat open under busted claims, and so does Cordelia',
      ],
    } : {
      title: 'Two Homes',
      glyph: '🪐',
      kicker: 'You still launch from Earth orbit. They do not',
      bullets: [
        'LEO is your home: your aqua bank, and where your boosted cards arrive',
        'The Sirens work out of Cordelia instead, a moon of Uranus',
        'Their crew retire there, their Free Market sells there, their pads explode there',
        'Luna and the Uranus Aerostat open under busted claims, and so does Cordelia',
      ],
    },
    {
      title: 'Diamonds Aren\'t Forever',
      glyph: '💎',
      kicker: 'Sirenian Crew and Human Colonists read rad-hardness 0',
      bullets: [
        siren
          ? 'Your people are diamond. Radiation is what diamond does not survive'
          : 'Sirenian bodies are diamond. Radiation is what diamond does not survive',
        siren
          ? 'A solar flare or a belt will take them where an Earthling would shrug'
          : 'A solar flare or a belt will take a Siren where your own crew would shrug',
        'ROBOTS ARE NOT SIRENS - a robot colonist keeps its printed rating',
        'The card still prints its real number; the 0 is how the rule reads it',
      ],
    },
  ];
  const soloTail = [
    {
      title: siren ? 'Your Library' : 'Two Libraries',
      glyph: '📚',
      kicker: siren ? 'The Sirens take every D and V patent' : 'The Sirens keep every D and V patent',
      bullets: [
        siren
          ? 'D and V spectral patents are yours; the rest belongs to Earth'
          : 'Everything that is not D or V spectral is yours; the D and V are theirs',
        'With nobody to bid against, your Operation is to TAKE the top card',
        'Pay 1 aqua per card taken, bonus supports included',
      ],
    },
    {
      title: 'The Uranian System',
      glyph: '🌙',
      kicker: siren ? 'Your own moons are worth the trip' : 'Their moons are worth the trip',
      bullets: [
        'Land a Human on a D or V moon and flip any white patent in that stack to its black side',
        'Free, and repeatable while the stack stays there',
        siren
          ? 'The first cycle your Humans reach ANY Uranian moon satisfies the Board outright'
          : 'The first cycle your Humans reach ANY Uranian moon satisfies the Board outright - you have found the Sirenians',
        'A centaur is not a moon - the zone holds both, and only the moons count',
      ],
    },
    {
      kind: 'close',
      glyph: '👔',
      title: 'The Board',
      subtitle: 'You run this expedition as its CEO. They convene each Solar Cycle and set a number.',
    },
  ];
  const coopTail = [
    {
      title: 'Two Libraries',
      glyph: '📚',
      kicker: siren
        ? 'With Earthlings at the table, every deck is cut in two'
        : 'With Sirens at the table, every deck is cut in two',
      bullets: [
        'Each species draws only from its own half (the odd card goes to the Sirens)',
        'You cannot bid on a lot off the other species\' deck',
        'The only one of your species at the table? Then you TAKE the top card for 1 aqua each instead',
        'The Patent Market shows the other half behind a tab, closed to you',
      ],
    },
    {
      title: 'First Contact',
      glyph: '🤝',
      kicker: 'The first time the two species meet, it is worth something',
      bullets: [
        'The first meeting of Human and Sirenian pays a Heroism chit: 2 VP',
        'It also opens a Technology Trade - a card drawn from the other library',
        'End your turn with one of your Humans beside theirs to trade again',
      ],
    },
    siren ? {
      kind: 'close',
      glyph: '🏛',
      title: 'Around Uranus',
      subtitle: 'Anchor your Home Bernal at a Uranian home orbit: it scores its Dirtside Hydration rather than a flat 6. A Cycler carries you through the mu dust ring, and a dome at a push-sat or aerostat colony is worth 3.',
    } : {
      kind: 'close',
      glyph: '🏛',
      title: 'Home Orbits',
      subtitle: 'Anchor your Home Bernal at one of YOUR home orbits, the Earth ones. A Uranian home orbit takes a Sirenian Bernal only, and a dome at a push-sat or aerostat colony is worth 3 to either side.',
    },
  ];
  return [...common, ...(solo ? soloTail : coopTail)];
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

// Play the V5 Hermes Fall briefing, same slide-deck styling. `turnsLeft` is the
// countdown, `done` is how many halves already carry a factory (0-2), and
// `seats` is the size of the table (2+ reads as the cooperative mission).
export function playHermesCutscene({ turnsLeft = 24, done = 0, seats = 1, onDone } = {}) {
  return playDeck(hermesSlides(turnsLeft, done, seats), { chrome: 'HERMES FALL · MISSION BRIEFING', onDone });
}

// Play the V9 Sirens briefing. `solo` picks the solitaire (CEO route) deck over
// the competitive one; they share their first three slides. `species` is the
// READER's own side ('siren' | 'earthling'), which rewrites every "you" - an
// Earthling host is not homed at Cordelia and their crew are not rad-hard 0.
export function playSirensCutscene({ solo = false, species = null, onDone } = {}) {
  return playDeck(sirensSlides(!!solo, species), {
    chrome: `THE SIRENS · ${solo ? 'SOLITAIRE' : 'EXPEDITION'} BRIEFING`,
    onDone,
  });
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
