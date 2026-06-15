// Sol Political Assembly (Module 0) - functional data for the assembly panel +
// (later) the engine resolvers. The six ideologies sit in a hexagon around a
// Centrist center; each carries a Law (active when the ideology is in power)
// and an end-game VP award. Pure data: no DOM, no node imports, so both the
// client panel and the server engine can read it (mirrors data/zone-chits.js).
//
// Wording here is our own functional description of each effect (game
// mechanics), NOT a copy of the printed mat's layout or text.
//
// SCOPE: M0 is not in the shipped game yet (see CLAUDE.md "Variants we
// target"). This is the forward-design data behind docs/politics-m0-plan.md.

export const IDEOLOGIES = [
  {
    key: 'freedom', name: 'Freedom', color: '#c01f6e',
    law: { name: 'Free Trade Act', text: 'A Free Market op may sell 2 cards for 5 aqua.' },
    award: { text: '+1 VP per factory cube' },
  },
  {
    key: 'honor', name: 'Honor', color: '#b8bcc6',
    law: { name: 'Paleoconservative Directive', text: 'On a Fundraise op, aqua gained equals your glory-chit count.' },
    award: { text: '+1 VP per glory chit' },
  },
  {
    key: 'unity', name: 'Unity', color: '#e0a81e',
    law: { name: 'UN General Assembly', text: 'Every ideology with 2+ delegates has its Law active, but lobbying is disallowed.' },
    award: { text: '+1 VP per ideology you have a delegate in' },
  },
  {
    key: 'authority', name: 'Authority', color: '#b98fd0',
    law: { name: 'Martial Law', text: 'On a Fundraise op, may discard an opponent’s delegate.' },
    award: { text: '+1 VP per claim disc' },
  },
  {
    key: 'equality', name: 'Equality', color: '#74c79a',
    law: { name: 'Research Grants', text: 'When starting a Research Auction op, pay 1 aqua and take the top card with no support cards.' },
    award: { text: '+1 VP per colony dome' },
  },
  {
    key: 'individuality', name: 'Individuality', color: '#6b7280',
    law: { name: 'Freedom to Roam Treaty', text: 'Treat an opponent’s Factory or Bernal as your own for non-victory purposes.' },
    // The two site icons on the mat are unreadable in the scan - confirm from
    // the M0 rules which site types these tokens sit on.
    award: { text: '+1 VP per token on certain sites (TBD)' },
  },
];

export const CENTRIST = {
  key: 'centrist', name: 'Centrist',
  law: {
    name: 'Pad Insurance',
    text: 'With a delegate here, the boost cost of any card you lose to a pad explosion is instantly repaid.',
  },
};

// Lobby free action: activate an inactive ideology's Law for a price.
export const LOBBY_RULE = 'Pay 1 aqua and discard a delegate in an inactive ideology to use its Law.';

// Clockwise from the top, matching the mat's seating, for the hex wheel layout.
export const IDEOLOGY_ORDER = ['freedom', 'honor', 'unity', 'authority', 'equality', 'individuality'];
export const IDEOLOGY_BY_KEY = Object.fromEntries(IDEOLOGIES.map((i) => [i.key, i]));
