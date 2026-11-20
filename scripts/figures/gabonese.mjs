// Gabonese Mining Consortium: a boy in profile raising binoculars to the
// skyline, hand-drawn (pose after the MPFB reference). Card units 300 x 330.
export function gaboneseBoy() {
  const sk = '#6e4630', skS = '#4a2a18', skH = '#8e5c3e';
  const sh = '#f4f0e6', shS = '#cbc2b0';
  const hair = '#0e0806';
  const defs = `<linearGradient id="gb-arm" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${skS}"/><stop offset="1" stop-color="${sk}"/></linearGradient>
    <linearGradient id="gb-bin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a4e58"/><stop offset="1" stop-color="#16181c"/></linearGradient>`;
  const svg = `<g id="boy">
    <!-- far arm: forearm rising to the far barrel -->
    <path d="M166,280 C180,240 188,190 192,140 L204,142 C202,192 192,246 178,284 Z" fill="${skS}"/>
    <!-- shirt: shoulders and chest in profile, facing right -->
    <path d="M96,196 C106,186 124,184 140,186 C160,188 174,198 180,214 C186,236 184,282 180,330 L82,330 C80,290 82,240 88,214 C90,206 92,200 96,196 Z" fill="${sh}"/>
    <path d="M96,196 C90,206 86,226 84,256 C82,286 82,310 82,330 L104,330 C102,300 102,266 104,236 C106,218 104,204 96,196 Z" fill="${shS}" opacity="0.8"/>
    <path d="M130,240 C140,262 142,296 138,330" stroke="${shS}" stroke-width="2" fill="none"/>
    <!-- neck -->
    <path d="M124,148 C126,162 124,176 118,188 C128,194 144,194 152,186 C148,176 148,164 150,152 Z" fill="${skS}"/>
    <path d="M118,188 C128,196 144,195 152,186" stroke="${shS}" stroke-width="3" fill="none"/>
    <!-- head in profile, facing right -->
    <path d="M100,100 C110,86 140,83 152,97 C158,105 158,116 156,122 C158,126 161,131 165,137 C166,140 163,141 160,141 C161,144 161,146 159,148 C160,152 158,158 153,160 C147,163 139,162 133,158 C127,154 123,150 119,146 C106,144 97,131 96,118 C96,110 97,104 100,100 Z" fill="${sk}"/>
    <path d="M100,100 C97,108 96,118 98,128 C102,138 110,145 119,146 C112,136 108,124 108,112 C108,106 110,100 114,96 Z" fill="${skS}" opacity="0.55"/>
    <path d="M152,153 C155,154 157,153 158,151" stroke="#3a1a10" stroke-width="1.6" fill="none"/>
    <ellipse cx="121" cy="124" rx="6" ry="9" fill="${skS}"/><path d="M119,119 C123,122 123,127 119,130" stroke="#2a1408" stroke-width="1.2" fill="none"/>
    <!-- close-cropped hair -->
    <path d="M98,120 C93,98 109,82 131,81 C146,81 155,89 156,100 C147,95 137,95 128,99 C120,103 116,111 112,121 C108,124 102,124 98,120 Z" fill="${hair}"/>
    <!-- binoculars at the eyes: far barrel, near barrel, bridge -->
    <path d="M150,104 L198,98 C203,98 204,112 199,113 L151,118 Z" fill="url(#gb-bin)"/>
    <ellipse cx="200" cy="105.5" rx="4" ry="7.5" fill="#2a4a6a" stroke="#5a5e66" stroke-width="1.5"/>
    <path d="M148,118 L202,113 C208,113 209,131 203,132 L149,136 Z" fill="url(#gb-bin)"/>
    <ellipse cx="204.5" cy="122.5" rx="4.5" ry="9.5" fill="#3a6a9a" stroke="#5a5e66" stroke-width="1.8"/>
    <ellipse cx="203" cy="119" rx="1.5" ry="3" fill="#fff" opacity="0.8"/>
    <rect x="144" y="116" width="10" height="20" rx="3" fill="#1e2024"/>
    <!-- near arm: upper arm down from the shoulder, forearm up to the near barrel, hand round it -->
    <path d="M118,200 C126,214 136,228 144,238 L160,226 C152,214 142,202 134,194 Z" fill="${sh}" stroke="${shS}" stroke-width="2"/>
    <path d="M144,238 L160,226" stroke="${shS}" stroke-width="3"/>
    <path d="M146,236 C152,246 158,256 162,264 C166,270 176,266 174,258 L160,228 Z" fill="${skS}"/>
    <path d="M162,262 C164,232 170,186 172,142 L186,144 C184,190 180,236 176,264 C174,272 162,272 162,262 Z" fill="url(#gb-arm)"/>
    <path d="M168,144 C168,134 174,128 182,128 C190,128 194,134 192,142 C192,146 186,148 180,148 C174,148 168,148 168,144 Z" fill="${sk}"/>
    <path d="M174,132 L188,131 M173,137 L190,136 M173,142 L189,141" stroke="${skS}" stroke-width="1.4" opacity="0.7"/>
  </g>`;
  return { defs, svg };
}
