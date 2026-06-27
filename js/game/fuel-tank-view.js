// Shared fuel-tank cylinder visual. Both the rocket stack's fuel-tank modal and
// the M2 Bernal's dirt-tank view draw the SAME cylinder (dry-mass block at the
// bottom, the liquid level on top, a lift-mass line, capacity ticks) - the only
// thing that differs between them is the fuel STRIP rendered beside it (user
// 2026-06-27). Keeping the markup here means there's ONE cylinder, not two.
//
// Pure UI: no DOM globals, no engine imports. The caller owns the panel + the
// strip + any controls; this just builds the cylinder and positions a level.

// The cylinder + clip / hatch defs + the level/marker/tick layers, exactly the
// markup the rocket fuel-tank modal has always used (same classes, so the
// rocket's fill animation still drives `.tank-water`).
export function fuelTankCylinderMarkup() {
  return `
      <svg viewBox="0 0 120 220" class="fuel-tank-svg" preserveAspectRatio="xMidYMid meet">
        <rect class="tank-shell" x="20" y="10" width="80" height="200" rx="14" ry="14" />
        <defs>
          <clipPath id="tank-clip">
            <rect x="20" y="10" width="80" height="200" rx="14" ry="14" />
          </clipPath>
          <pattern id="tank-dry-hatch" patternUnits="userSpaceOnUse" width="8" height="8">
            <rect width="8" height="8" fill="rgba(120, 130, 170, 0.35)"/>
            <line x1="0" y1="8" x2="8" y2="0" stroke="rgba(180, 190, 210, 0.55)" stroke-width="1"/>
          </pattern>
        </defs>
        <g clip-path="url(#tank-clip)">
          <rect class="tank-dry" x="20" y="200" width="80" height="10" fill="url(#tank-dry-hatch)" />
        </g>
        <g class="tank-drops" clip-path="url(#tank-clip)"></g>
        <g clip-path="url(#tank-clip)">
          <rect class="tank-water" x="20" y="200" width="80" height="10" />
          <rect class="tank-water-foam" x="20" y="195" width="80" height="6" />
        </g>
        <line class="tank-lift-line" x1="20" y1="0" x2="100" y2="0"
              stroke="#fbbf24" stroke-width="1.5" stroke-dasharray="3 3" opacity="0" />
        <g class="tank-ticks"></g>
      </svg>`;
}

// The geometry the cylinder draws against: 200px of fill height from y=210
// (empty) up to y=10 (full = `cap` wet mass).
const TOP_Y = 10, BOT_Y = 210, FILL_H = 200;
const yFor = (v, cap) => BOT_Y - Math.max(0, Math.min(cap, v)) / Math.max(1, cap) * FILL_H;

// Position the dry-mass block, the liquid level, the lift line, and the ticks
// for a STATIC reading (no animation). dryMass = hull mass (the immovable block);
// wet = dry + fuel in the tank; cap = max wet mass (32); thrust = the lift line.
export function setFuelTankLevel(root, { dryMass = 0, wet = 0, cap = 32, thrust = null } = {}) {
  if (!root) return;
  const dry = Math.max(0, Math.min(cap, dryMass));
  const wetM = Math.max(dry, Math.min(cap, wet));
  const dryTop = yFor(dry, cap);
  const wetTop = yFor(wetM, cap);
  const dryRect = root.querySelector('.tank-dry');
  if (dryRect) { dryRect.setAttribute('y', String(dryTop)); dryRect.setAttribute('height', String(BOT_Y - dryTop)); }
  const water = root.querySelector('.tank-water');
  if (water) { water.setAttribute('y', String(wetTop)); water.setAttribute('height', String(Math.max(0, dryTop - wetTop))); }
  const foam = root.querySelector('.tank-water-foam');
  if (foam) {
    const show = wetM > dry + 1e-6;
    foam.setAttribute('y', String(wetTop - 2));
    foam.style.opacity = show ? '1' : '0';
  }
  const lift = root.querySelector('.tank-lift-line');
  if (lift) {
    if (Number.isFinite(thrust) && thrust > 0 && thrust < cap) {
      const ly = yFor(thrust, cap);
      lift.setAttribute('y1', String(ly)); lift.setAttribute('y2', String(ly));
      lift.setAttribute('opacity', '0.95');
    } else {
      lift.setAttribute('opacity', '0');
    }
  }
  const ticks = root.querySelector('.tank-ticks');
  if (ticks) {
    // Match the rocket fuel-tank ticks exactly (right edge, every 5 units): the
    // bernal tank and the rocket tank read identically (user 2026-06-27).
    let p = '';
    for (let v = 5; v <= cap; v += 5) {
      const ty = yFor(v, cap);
      p += `<line x1="100" y1="${ty}" x2="110" y2="${ty}" stroke="rgba(125,211,252,0.55)" stroke-width="1.5"/>`;
    }
    ticks.innerHTML = p;
  }
}
