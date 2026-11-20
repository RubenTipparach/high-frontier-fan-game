// Teleoperators: the operator, hand-drawn (owner 2026-11-20: the generated
// figures were mannequins). Pose after the posed MPFB reference: body turned to
// her left, short hair, VR visor, fitted dark tee, right arm reaching out to the
// robot. Card units (300 x 330).
export function teleoperator() {
  const sk = '#7a4e34', skS = '#5a3420', skH = '#9a6a4c';
  const top = '#2e3138', topS = '#1b1d22', topH = '#4a4e58';
  const hair = '#1a100a', hairH = '#3a261a';
  const defs = `<linearGradient id="op-vz" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#cfe6f8"/><stop offset="0.6" stop-color="#f4faff"/><stop offset="1" stop-color="#8ab4d8"/></linearGradient>
    <linearGradient id="op-arm" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${skS}"/><stop offset="0.5" stop-color="${sk}"/><stop offset="1" stop-color="${skH}"/></linearGradient>`;
  const svg = `<g id="operator">
    <!-- far (left) arm, hanging: sleeve then the arm -->
    <path d="M14,232 C11,262 13,292 17,330 L33,330 C33,296 35,262 35,232 Z" fill="${skS}"/>
    <path d="M22,186 C10,190 6,212 10,236 L36,236 C36,214 34,196 30,188 Z" fill="${topS}"/>
    <!-- torso, turned to her left -->
    <path d="M70,164 C50,166 30,172 21,186 C14,200 14,222 18,242 C21,272 23,302 25,330 L114,330 C113,300 116,262 119,232 C121,212 117,196 112,186 C107,176 101,169 96,166 Z" fill="${top}"/>
    <path d="M96,166 C104,172 110,180 112,188 C117,200 120,214 118,232 C116,262 113,300 114,330 L96,330 C98,296 100,262 101,236 C102,214 100,196 96,182 Z" fill="${topH}" opacity="0.55"/>
    <path d="M30,250 C40,262 46,290 44,330" stroke="${topS}" stroke-width="2.5" fill="none" opacity="0.8"/>
    <path d="M58,212 C70,226 94,228 112,214" stroke="${topS}" stroke-width="2" fill="none" opacity="0.7"/>
    <!-- near (right) arm reaching out: sleeve, arm, hand -->
    <path d="M96,168 C112,166 130,172 139,183 L135,198 C124,196 110,194 103,192 Z" fill="${top}"/>
    <path d="M135,183 C158,177 192,167 220,157 C224,156 226,165 222,167 C196,176 162,188 133,198 Z" fill="url(#op-arm)"/>
    <path d="M150,187 C170,181 196,172 218,164" stroke="${skS}" stroke-width="1.5" fill="none" opacity="0.5"/>
    <path d="M219,156 C230,151 244,150 257,152 C264,153 265,158 258,159.5 C250,160.5 243,161 238,162 C244,163 250,164 254,166 C258,168 255,171 250,170 C243,169 233,168 224,168 Z" fill="${sk}"/>
    <path d="M226,157 C230,154 236,152 240,152" stroke="${skS}" stroke-width="1.2" fill="none" opacity="0.6"/>
    <!-- head and neck, sized to the pose reference (wider, a little left) -->
    <g transform="translate(-14,-4) scale(1.16) translate(2,0)">
    <!-- neck and collar -->
    <path d="M74,138 C77,150 76,160 71,168 C80,174 92,174 99,167 C96,158 96,150 97,142 Z" fill="${skS}"/>
    <path d="M70,166 C78,175 92,176 99,167" stroke="${topS}" stroke-width="3" fill="none"/>
    <!-- head, three-quarter to her left -->
    <path d="M64,96 C66,82 84,77 97,85 C105,91 107,103 105,112 C106,118 110,124 111,129 C111,132 107,133 105,134 C107,137 107,139 105,141 C104,146 100,151 94,152 C86,153 78,149 72,143 C66,137 62,125 62,114 C61,106 62,100 64,96 Z" fill="${sk}"/>
    <path d="M64,96 C62,104 61,112 62,118 C64,130 68,140 74,146 C68,138 66,124 68,112 C69,104 72,98 76,94 Z" fill="${skS}" opacity="0.6"/>
    <path d="M103,127 C105,129 107,130 108,130" stroke="${skS}" stroke-width="1.6" fill="none"/>
    <path d="M97,141 C100,142 103,141 105,140" stroke="#4a2418" stroke-width="2" fill="none" stroke-linecap="round"/>
    <ellipse cx="69" cy="120" rx="5" ry="8" fill="${skS}"/>
    <!-- short hair -->
    <path d="M60,120 C55,102 60,84 78,78 C93,74 106,81 106,93 C99,89 91,89 85,93 C79,97 75,104 73,112 C71,117 66,121 60,120 Z" fill="${hair}"/>
    <path d="M70,84 C78,80 90,79 98,83" stroke="${hairH}" stroke-width="2" fill="none" opacity="0.7"/>
    <!-- VR visor wrapping the eyes, strap to the back -->
    <path d="M66,110 C64,104 66,100 70,99" stroke="#20242c" stroke-width="4" fill="none"/>
    <path d="M70,103 C80,99 98,98 109,100 C112,101 112,111 109,112 C98,114 82,115 72,114 C69,113 69,104 70,103 Z" fill="url(#op-vz)" stroke="#5a7a9a" stroke-width="1"/>
    <path d="M76,104 C86,102 96,102 104,103" stroke="#ffffff" stroke-width="1.8" fill="none" opacity="0.9"/>
    </g>
  </g>`;
  return { defs, svg };
}
