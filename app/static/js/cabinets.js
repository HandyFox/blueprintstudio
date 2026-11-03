// Kitchen Kompact product catalog — pulled from the Palmer-Donavin
// Kitchen Kompact Cabinets PDF (021624 / March 20, 2024 moulding pricing).
//
// Each entry is one specific SKU (e.g. "30B" is a 30"-wide base cabinet).
// `width`, `depth`, `height` are all in inches and match the plan view
// footprint we render on the floor plan.  `prices` maps each finish to
// the catalog list price in dollars.  `na` lists finishes the SKU is
// not available in.
//
// Layout convention:
//   - For straight cabinets, `width` is the dimension along the wall and
//     `depth` is the distance into the room.
//   - For corner cabinets, the bounding box is `width` × `depth` and the
//     `corner` flag tells the renderer to draw the L-shape footprint.
//   - For 45°-angle (diagonal) wall cabinets, `angle` is true and the
//     footprint is a triangle.

export const FINISHES = [
    'Glenwood', 'Warmwood', 'Chadwood', 'DWhite', 'Gray'];

// `category` controls how the cabinet is drawn on plan view and grouped in
// the library.  See render.js _paintCabinet.
export const CATEGORIES = [
    'wall',      // wall-mounted, drawn dashed (above counter)
    'base',      // standard base
    'corner',    // corner base (L-shape)
    'lazy',      // lazy susan (quarter-circle hint)
    'tall',      // oven / broom / pantry — full height
    'vanity',    // 21" deep
    'ada',       // ADA-accessible base/sink/etc. (UD* and H*)
    'filler',    // filler strips, cut to fit the gap
];

// --- The Catalog ---------------------------------------------------------

export const CATALOG = [
    // --- Wall cabinets, 30" high (W) ---------------------------------------
    { model: '9W',   category: 'wall', width: 9,  depth: 12, height: 30,
      doors: 1, shelves: 2, description: '9" Wall',
      prices: { Glenwood: 161, Warmwood: 161, Chadwood: 174, DWhite: 196, Gray: 204 } },
    { model: '12W',  category: 'wall', width: 12, depth: 12, height: 30,
      doors: 1, shelves: 2, description: '12" Wall',
      prices: { Glenwood: 176, Warmwood: 176, Chadwood: 192, DWhite: 209, Gray: 217 } },
    { model: '15W',  category: 'wall', width: 15, depth: 12, height: 30,
      doors: 1, shelves: 2, description: '15" Wall',
      prices: { Glenwood: 194, Warmwood: 194, Chadwood: 211, DWhite: 225, Gray: 233 } },
    { model: '18W',  category: 'wall', width: 18, depth: 12, height: 30,
      doors: 1, shelves: 2, description: '18" Wall',
      prices: { Glenwood: 208, Warmwood: 208, Chadwood: 229, DWhite: 237, Gray: 245 } },
    { model: '21W',  category: 'wall', width: 21, depth: 12, height: 30,
      doors: 1, shelves: 2, description: '21" Wall',
      prices: { Glenwood: 225, Warmwood: 225, Chadwood: 249, DWhite: 251, Gray: 259 } },
    { model: '24W',  category: 'wall', width: 24, depth: 12, height: 30,
      doors: 1, shelves: 2, description: '24" Wall',
      prices: { Glenwood: 240, Warmwood: 240, Chadwood: 266, DWhite: 264, Gray: 272 } },
    { model: '27W',  category: 'wall', width: 27, depth: 12, height: 30,
      doors: 2, shelves: 2, description: '27" Wall',
      prices: { Glenwood: 315, Warmwood: 315, Chadwood: 327, DWhite: 365, Gray: 380 } },
    { model: '30W',  category: 'wall', width: 30, depth: 12, height: 30,
      doors: 2, shelves: 2, description: '30" Wall',
      prices: { Glenwood: 328, Warmwood: 328, Chadwood: 340, DWhite: 378, Gray: 393 } },
    { model: '33W',  category: 'wall', width: 33, depth: 12, height: 30,
      doors: 2, shelves: 2, description: '33" Wall',
      prices: { Glenwood: 348, Warmwood: 348, Chadwood: 361, DWhite: 393, Gray: 408 } },
    { model: '36W',  category: 'wall', width: 36, depth: 12, height: 30,
      doors: 2, shelves: 2, description: '36" Wall',
      prices: { Glenwood: 364, Warmwood: 364, Chadwood: 378, DWhite: 406, Gray: 421 } },
    { model: '42W',  category: 'wall', width: 42, depth: 12, height: 30,
      doors: 2, shelves: 2, description: '42" Wall',
      prices: { Glenwood: 403, Warmwood: 403, Chadwood: 418, DWhite: 433, Gray: 448 } },
    { model: '48W',  category: 'wall', width: 48, depth: 12, height: 30,
      doors: 2, shelves: 2, description: '48" Wall',
      prices: { Glenwood: 441, Warmwood: 441, Chadwood: 464, DWhite: 463, Gray: 478 } },

    // --- Wall cabinets, 36" high (WT) --------------------------------------
    { model: '9WT',  category: 'wall', width: 9,  depth: 12, height: 36,
      doors: 1, shelves: 2, description: '9" Wall (36"H)',
      prices: { Glenwood: 192, Warmwood: 192, Chadwood: 211, DWhite: 217, Gray: 225 } },
    { model: '12WT', category: 'wall', width: 12, depth: 12, height: 36,
      doors: 1, shelves: 2, description: '12" Wall (36"H)',
      prices: { Glenwood: 207, Warmwood: 207, Chadwood: 226, DWhite: 232, Gray: 240 } },
    { model: '15WT', category: 'wall', width: 15, depth: 12, height: 36,
      doors: 1, shelves: 2, description: '15" Wall (36"H)',
      prices: { Glenwood: 218, Warmwood: 218, Chadwood: 246, DWhite: 247, Gray: 255 } },
    { model: '18WT', category: 'wall', width: 18, depth: 12, height: 36,
      doors: 1, shelves: 2, description: '18" Wall (36"H)',
      prices: { Glenwood: 236, Warmwood: 236, Chadwood: 268, DWhite: 262, Gray: 270 } },
    { model: '21WT', category: 'wall', width: 21, depth: 12, height: 36,
      doors: 1, shelves: 2, description: '21" Wall (36"H)',
      prices: { Glenwood: 256, Warmwood: 256, Chadwood: 293, DWhite: 276, Gray: 284 } },
    { model: '24WT', category: 'wall', width: 24, depth: 12, height: 36,
      doors: 1, shelves: 2, description: '24" Wall (36"H)',
      prices: { Glenwood: 272, Warmwood: 272, Chadwood: 313, DWhite: 292, Gray: 300 } },
    { model: '27WT', category: 'wall', width: 27, depth: 12, height: 36,
      doors: 2, shelves: 2, description: '27" Wall (36"H)',
      prices: { Glenwood: 331, Warmwood: 331, Chadwood: 384, DWhite: 398, Gray: 413 } },
    { model: '30WT', category: 'wall', width: 30, depth: 12, height: 36,
      doors: 2, shelves: 2, description: '30" Wall (36"H)',
      prices: { Glenwood: 348, Warmwood: 348, Chadwood: 401, DWhite: 412, Gray: 427 } },
    { model: '33WT', category: 'wall', width: 33, depth: 12, height: 36,
      doors: 2, shelves: 2, description: '33" Wall (36"H)',
      prices: { Glenwood: 365, Warmwood: 365, Chadwood: 423, DWhite: 426, Gray: 441 } },
    { model: '36WT', category: 'wall', width: 36, depth: 12, height: 36,
      doors: 2, shelves: 2, description: '36" Wall (36"H)',
      prices: { Glenwood: 387, Warmwood: 387, Chadwood: 445, DWhite: 445, Gray: 460 } },

    // --- Wall cabinets, 42" high (WXT) -- Chadwood NA ----------------------
    { model: '9WXT', category: 'wall', width: 9,  depth: 12, height: 42,
      doors: 1, shelves: 3, na: ['Chadwood'], description: '9" Wall (42"H)',
      prices: { Glenwood: 219, Warmwood: 219, DWhite: 258, Gray: 269 } },
    { model: '12WXT', category: 'wall', width: 12, depth: 12, height: 42,
      doors: 1, shelves: 3, na: ['Chadwood'], description: '12" Wall (42"H)',
      prices: { Glenwood: 241, Warmwood: 241, DWhite: 273, Gray: 284 } },
    { model: '15WXT', category: 'wall', width: 15, depth: 12, height: 42,
      doors: 1, shelves: 3, na: ['Chadwood'], description: '15" Wall (42"H)',
      prices: { Glenwood: 275, Warmwood: 275, DWhite: 293, Gray: 304 } },
    { model: '18WXT', category: 'wall', width: 18, depth: 12, height: 42,
      doors: 1, shelves: 3, na: ['Chadwood'], description: '18" Wall (42"H)',
      prices: { Glenwood: 307, Warmwood: 307, DWhite: 310, Gray: 321 } },
    { model: '21WXT', category: 'wall', width: 21, depth: 12, height: 42,
      doors: 1, shelves: 3, na: ['Chadwood'], description: '21" Wall (42"H)',
      prices: { Glenwood: 340, Warmwood: 340, DWhite: 327, Gray: 338 } },
    { model: '24WXT', category: 'wall', width: 24, depth: 12, height: 42,
      doors: 1, shelves: 3, na: ['Chadwood'], description: '24" Wall (42"H)',
      prices: { Glenwood: 373, Warmwood: 373, DWhite: 344, Gray: 355 } },
    { model: '27WXT', category: 'wall', width: 27, depth: 12, height: 42,
      doors: 2, shelves: 3, na: ['Chadwood'], description: '27" Wall (42"H)',
      prices: { Glenwood: 438, Warmwood: 438, DWhite: 476, Gray: 498 } },
    { model: '30WXT', category: 'wall', width: 30, depth: 12, height: 42,
      doors: 2, shelves: 3, na: ['Chadwood'], description: '30" Wall (42"H)',
      prices: { Glenwood: 472, Warmwood: 472, DWhite: 494, Gray: 516 } },
    { model: '33WXT', category: 'wall', width: 33, depth: 12, height: 42,
      doors: 2, shelves: 3, na: ['Chadwood'], description: '33" Wall (42"H)',
      prices: { Glenwood: 504, Warmwood: 504, DWhite: 512, Gray: 534 } },
    { model: '36WXT', category: 'wall', width: 36, depth: 12, height: 42,
      doors: 2, shelves: 3, na: ['Chadwood'], description: '36" Wall (42"H)',
      prices: { Glenwood: 538, Warmwood: 538, DWhite: 529, Gray: 551 } },

    // --- Wall cabinets, short (24" Z / 21" R / 18" Y / 15" X / 12" X12) ---
    { model: '24Z',  category: 'wall', width: 24, depth: 12, height: 24,
      doors: 1, na: ['Chadwood'], description: '24" Wall (24"H)',
      prices: { Glenwood: 214, Warmwood: 214, DWhite: 248, Gray: 256 } },
    { model: '30Z',  category: 'wall', width: 30, depth: 12, height: 24,
      doors: 2, na: ['Chadwood'], description: '30" Wall (24"H)',
      prices: { Glenwood: 297, Warmwood: 297, DWhite: 362, Gray: 377 } },
    { model: '36Z',  category: 'wall', width: 36, depth: 12, height: 24,
      doors: 2, na: ['Chadwood'], description: '36" Wall (24"H)',
      prices: { Glenwood: 322, Warmwood: 322, DWhite: 383, Gray: 398 } },
    { model: '24R',  category: 'wall', width: 24, depth: 12, height: 21,
      doors: 1, description: '24" Wall (21"H)',
      prices: { Glenwood: 194, Warmwood: 194, Chadwood: 213, DWhite: 223, Gray: 231 } },
    { model: '30R',  category: 'wall', width: 30, depth: 12, height: 21,
      doors: 2, description: '30" Wall (21"H)',
      prices: { Glenwood: 248, Warmwood: 248, Chadwood: 267, DWhite: 319, Gray: 334 } },
    { model: '36R',  category: 'wall', width: 36, depth: 12, height: 21,
      doors: 2, description: '36" Wall (21"H)',
      prices: { Glenwood: 273, Warmwood: 273, Chadwood: 295, DWhite: 342, Gray: 357 } },
    { model: '24Y',  category: 'wall', width: 24, depth: 12, height: 18,
      doors: 1, description: '24" Wall (18"H)',
      prices: { Glenwood: 180, Warmwood: 180, Chadwood: 196, DWhite: 211, Gray: 219 } },
    { model: '30Y',  category: 'wall', width: 30, depth: 12, height: 18,
      doors: 2, description: '30" Wall (18"H)',
      prices: { Glenwood: 230, Warmwood: 230, Chadwood: 245, DWhite: 303, Gray: 318 } },
    { model: '36Y',  category: 'wall', width: 36, depth: 12, height: 18,
      doors: 2, description: '36" Wall (18"H)',
      prices: { Glenwood: 256, Warmwood: 256, Chadwood: 274, DWhite: 327, Gray: 342 } },
    { model: '30X',  category: 'wall', width: 30, depth: 12, height: 15,
      doors: 2, description: '30" Wall (15"H)',
      prices: { Glenwood: 199, Warmwood: 199, Chadwood: 210, DWhite: 273, Gray: 288 } },
    { model: '33X',  category: 'wall', width: 33, depth: 12, height: 15,
      doors: 2, description: '33" Wall (15"H)',
      prices: { Glenwood: 209, Warmwood: 209, Chadwood: 222, DWhite: 282, Gray: 297 } },
    { model: '36X',  category: 'wall', width: 36, depth: 12, height: 15,
      doors: 2, description: '36" Wall (15"H)',
      prices: { Glenwood: 219, Warmwood: 219, Chadwood: 232, DWhite: 292, Gray: 307 } },
    { model: '30X12', category: 'wall', width: 30, depth: 12, height: 12,
      doors: 2, description: '30" Wall (12"H)',
      prices: { Glenwood: 183, Warmwood: 183, Chadwood: 193, DWhite: 257, Gray: 272 } },
    { model: '36X12', category: 'wall', width: 36, depth: 12, height: 12,
      doors: 2, description: '36" Wall (12"H)',
      prices: { Glenwood: 200, Warmwood: 200, Chadwood: 209, DWhite: 274, Gray: 289 } },

    // --- Wall Corner cabinets (each leg shown) — bounding box NxN -------
    // 30" wall corner (WC) — door swings on one side, 24/36/42 leg
    { model: '24WC',  category: 'wall', blind: true, width: 24, depth: 12, height: 30,
      doors: 1, description: 'Blind Wall Corner 24" (30"H)',
      prices: { Glenwood: 239, Warmwood: 239, Chadwood: 261, DWhite: 275, Gray: 283 } },
    { model: '36WC',  category: 'wall', blind: true, width: 36, depth: 12, height: 30,
      doors: 1, description: 'Blind Wall Corner 36" (30"H)',
      prices: { Glenwood: 304, Warmwood: 304, Chadwood: 337, DWhite: 330, Gray: 338 } },
    { model: '42WC',  category: 'wall', blind: true, width: 42, depth: 12, height: 30,
      doors: 2, description: 'Blind Wall Corner 42" (30"H)',
      prices: { Glenwood: 372, Warmwood: 372, Chadwood: 411, DWhite: 442, Gray: 457 } },
    { model: '24WCT', category: 'wall', blind: true, width: 24, depth: 12, height: 36,
      doors: 1, description: 'Blind Wall Corner 24" (36"H)',
      prices: { Glenwood: 270, Warmwood: 270, Chadwood: 305, DWhite: 305, Gray: 313 } },
    { model: '36WCT', category: 'wall', blind: true, width: 36, depth: 12, height: 36,
      doors: 1, description: 'Blind Wall Corner 36" (36"H)',
      prices: { Glenwood: 348, Warmwood: 348, Chadwood: 394, DWhite: 370, Gray: 378 } },
    { model: '24WCXT', category: 'wall', blind: true, width: 24, depth: 12, height: 42,
      doors: 1, na: ['Chadwood'], description: 'Blind Wall Corner 24" (42"H)',
      prices: { Glenwood: 327, Warmwood: 327, DWhite: 361, Gray: 372 } },
    { model: '36WCXT', category: 'wall', blind: true, width: 36, depth: 12, height: 42,
      doors: 1, na: ['Chadwood'], description: 'Blind Wall Corner 36" (42"H)',
      prices: { Glenwood: 463, Warmwood: 463, DWhite: 438, Gray: 449 } },

    // --- Angle wall cabinets (24x24 diagonal) — A / AT / AXT --------------
    { model: '24A',   category: 'wall', shape: 'angle', width: 24, depth: 24, height: 30,
      doors: 1, description: 'Diagonal Corner Wall 24" (30"H)',
      prices: { Glenwood: 327, Warmwood: 327, Chadwood: 357, DWhite: 361, Gray: 369 } },
    { model: '24AT',  category: 'wall', shape: 'angle', width: 24, depth: 24, height: 36,
      doors: 1, description: 'Diagonal Corner Wall 24" (36"H)',
      prices: { Glenwood: 361, Warmwood: 361, Chadwood: 403, DWhite: 394, Gray: 402 } },
    { model: '24AXT', category: 'wall', shape: 'angle', width: 24, depth: 24, height: 42,
      doors: 1, na: ['Chadwood'], description: 'Diagonal Corner Wall 24" (42"H)',
      prices: { Glenwood: 466, Warmwood: 466, DWhite: 484, Gray: 495 } },

    // --- Base Cabinets (B) — 24" deep, 34.5" high --------------------------
    { model: '12B', category: 'base', width: 12, depth: 24, height: 34.5,
      doors: 1, drawers: 1, description: '12" Base',
      prices: { Glenwood: 289, Warmwood: 289, Chadwood: 310, DWhite: 328, Gray: 336 } },
    { model: '15B', category: 'base', width: 15, depth: 24, height: 34.5,
      doors: 1, drawers: 1, description: '15" Base',
      prices: { Glenwood: 311, Warmwood: 311, Chadwood: 334, DWhite: 348, Gray: 356 } },
    { model: '18B', category: 'base', width: 18, depth: 24, height: 34.5,
      doors: 1, drawers: 1, description: '18" Base',
      prices: { Glenwood: 332, Warmwood: 332, Chadwood: 360, DWhite: 368, Gray: 376 } },
    { model: '21B', category: 'base', width: 21, depth: 24, height: 34.5,
      doors: 1, drawers: 1, description: '21" Base',
      prices: { Glenwood: 354, Warmwood: 354, Chadwood: 385, DWhite: 388, Gray: 396 } },
    { model: '24B', category: 'base', width: 24, depth: 24, height: 34.5,
      doors: 1, drawers: 1, description: '24" Base',
      prices: { Glenwood: 377, Warmwood: 377, Chadwood: 413, DWhite: 410, Gray: 418 } },
    { model: '27B', category: 'base', width: 27, depth: 24, height: 34.5,
      doors: 1, drawers: 1, description: '27" Base',
      prices: { Glenwood: 406, Warmwood: 406, Chadwood: 446, DWhite: 438, Gray: 446 } },
    { model: '30B', category: 'base', width: 30, depth: 24, height: 34.5,
      doors: 2, drawers: 2, description: '30" Base',
      prices: { Glenwood: 493, Warmwood: 493, Chadwood: 533, DWhite: 571, Gray: 586 } },
    { model: '33B', category: 'base', width: 33, depth: 24, height: 34.5,
      doors: 2, drawers: 2, description: '33" Base',
      prices: { Glenwood: 513, Warmwood: 513, Chadwood: 558, DWhite: 592, Gray: 607 } },
    { model: '36B', category: 'base', width: 36, depth: 24, height: 34.5,
      doors: 2, drawers: 2, description: '36" Base',
      prices: { Glenwood: 533, Warmwood: 533, Chadwood: 579, DWhite: 608, Gray: 623 } },
    { model: '42B', category: 'base', width: 42, depth: 24, height: 34.5,
      doors: 2, drawers: 2, description: '42" Base',
      prices: { Glenwood: 584, Warmwood: 584, Chadwood: 640, DWhite: 658, Gray: 673 } },
    { model: '48B', category: 'base', width: 48, depth: 24, height: 34.5,
      doors: 2, drawers: 2, description: '48" Base',
      prices: { Glenwood: 629, Warmwood: 629, Chadwood: 695, DWhite: 699, Gray: 714 } },

    // --- Tray, Drawer, Sink/Range bases ----------------------------------
    { model: '9T', category: 'base', width: 9, depth: 24, height: 34.5,
      description: '9" Tray Base',
      prices: { Glenwood: 215, Warmwood: 215, Chadwood: 234, DWhite: 252, Gray: 260 } },
    { model: '15D', category: 'base', width: 15, depth: 24, height: 34.5,
      drawers: 4, description: '15" Drawer Base (4dr stain / 3dr painted)',
      prices: { Glenwood: 516, Warmwood: 516, Chadwood: 555, DWhite: 502, Gray: 502 } },
    { model: '18D', category: 'base', width: 18, depth: 24, height: 34.5,
      drawers: 4, description: '18" Drawer Base (4dr stain / 3dr painted)',
      prices: { Glenwood: 558, Warmwood: 558, Chadwood: 607, DWhite: 540, Gray: 540 } },
    { model: '24D', category: 'base', width: 24, depth: 24, height: 34.5,
      drawers: 4, description: '24" Drawer Base (4dr stain / 3dr painted)',
      prices: { Glenwood: 641, Warmwood: 641, Chadwood: 702, DWhite: 618, Gray: 618 } },
    { model: '30RBS', category: 'base', width: 30, depth: 24, height: 34.5,
      description: '30" Range/Sink Base',
      prices: { Glenwood: 369, Warmwood: 369, Chadwood: 404, DWhite: 465, Gray: 480 } },
    { model: '33RBS', category: 'base', width: 33, depth: 24, height: 34.5,
      description: '33" Range/Sink Base',
      prices: { Glenwood: 388, Warmwood: 388, Chadwood: 429, DWhite: 485, Gray: 500 } },
    { model: '36RBS', category: 'base', width: 36, depth: 24, height: 34.5,
      description: '36" Range/Sink Base',
      prices: { Glenwood: 396, Warmwood: 396, Chadwood: 438, DWhite: 489, Gray: 504 } },
    { model: '42RBS', category: 'base', width: 42, depth: 24, height: 34.5,
      description: '42" Range/Sink Base',
      prices: { Glenwood: 436, Warmwood: 436, Chadwood: 487, DWhite: 526, Gray: 541 } },
    { model: '60SB', category: 'base', width: 60, depth: 24, height: 34.5,
      description: '60" Sink Base Combo (15-30-15)',
      prices: { Glenwood: 751, Warmwood: 751, Chadwood: 822, DWhite: 855, Gray: 885 } },
    { model: '18SF', category: 'base', width: 18, depth: 24, front: 'sinkfront', height: 34.5,
      description: '18" Sink Front (no carcass)',
      prices: { Glenwood: 141, Warmwood: 141, Chadwood: 163, DWhite: 169, Gray: 177 } },

    // --- Base Corner cabinets (39BC / 42BC) --------------------------------
    { model: '39BC', category: 'corner', blind: true, width: 39, depth: 24, height: 34.5,
      description: 'Base Corner 39" (pulls to 46")',
      prices: { Glenwood: 422, Warmwood: 422, Chadwood: 455, DWhite: 464, Gray: 472 } },
    { model: '42BC', category: 'corner', blind: true, width: 42, depth: 24, height: 34.5,
      description: 'Base Corner 42" (pulls to 49")',
      prices: { Glenwood: 462, Warmwood: 462, Chadwood: 502, DWhite: 503, Gray: 511 } },

    // --- Lazy Susan -----------------------------------------------------
    { model: '36LS', category: 'lazy', shape: 'L', width: 36, depth: 36, height: 34.5,
      description: '36" Lazy Susan Corner',
      prices: { Glenwood: 566, Warmwood: 566, Chadwood: 620, DWhite: 544, Gray: 544 } },

    // --- Peninsula Bases ---------------------------------------------------
    { model: '36B-P', category: 'corner', width: 36, depth: 24, height: 34.5,
      description: '36" Peninsula Base',
      prices: { Glenwood: 702, Warmwood: 702, Chadwood: 791, DWhite: 772, Gray: 802 } },
    { model: '48B-P', category: 'corner', width: 48, depth: 24, height: 34.5,
      description: '48" Peninsula Base',
      prices: { Glenwood: 838, Warmwood: 838, Chadwood: 967, DWhite: 895, Gray: 925 } },
    { model: '48BC-P', category: 'corner', width: 48, depth: 24, height: 34.5,
      description: '48" Blind Corner Peninsula',
      prices: { Glenwood: 756, Warmwood: 756, Chadwood: 868, DWhite: 821, Gray: 843 } },

    // --- Tall cabinets: Oven (24"d, 30"w) ----------------------------------
    { model: '30OU',   category: 'tall', width: 30, depth: 24, height: 84,
      description: '30" Oven Cabinet (84"H)',
      prices: { Glenwood: 1087, Warmwood: 1087, Chadwood: 1217, DWhite: 1192, Gray: 1207 } },
    { model: '30OUT',  category: 'tall', width: 30, depth: 24, height: 90,
      description: '30" Oven Cabinet (90"H)',
      prices: { Glenwood: 1154, Warmwood: 1154, Chadwood: 1285, DWhite: 1243, Gray: 1258 } },
    { model: '30OUXT', category: 'tall', width: 30, depth: 24, height: 96,
      na: ['Chadwood'], description: '30" Oven Cabinet (96"H)',
      prices: { Glenwood: 1271, Warmwood: 1271, DWhite: 1368, Gray: 1383 } },

    // --- Tall cabinets: Broom (BRW 12"d, BRB 24"d) -------------------------
    { model: '18BRW',   category: 'tall', width: 18, depth: 12, height: 84,
      description: '18" Broom Cabinet 12"d (84"H)',
      prices: { Glenwood: 521, Warmwood: 521, Chadwood: 576, DWhite: 585, Gray: 607 } },
    { model: '18BRWT',  category: 'tall', width: 18, depth: 12, height: 90,
      description: '18" Broom Cabinet 12"d (90"H)',
      prices: { Glenwood: 557, Warmwood: 557, Chadwood: 619, DWhite: 621, Gray: 643 } },
    { model: '18BRWXT', category: 'tall', width: 18, depth: 12, height: 96,
      na: ['Chadwood'], description: '18" Broom Cabinet 12"d (96"H)',
      prices: { Glenwood: 591, Warmwood: 591, DWhite: 644, Gray: 666 } },
    { model: '18BRB',   category: 'tall', width: 18, depth: 24, height: 84,
      description: '18" Broom Cabinet 24"d (84"H)',
      prices: { Glenwood: 701, Warmwood: 701, Chadwood: 763, DWhite: 772, Gray: 794 } },
    { model: '18BRBT',  category: 'tall', width: 18, depth: 24, height: 90,
      description: '18" Broom Cabinet 24"d (90"H)',
      prices: { Glenwood: 748, Warmwood: 748, Chadwood: 817, DWhite: 818, Gray: 840 } },
    { model: '18BRBXT', category: 'tall', width: 18, depth: 24, height: 96,
      na: ['Chadwood'], description: '18" Broom Cabinet 24"d (96"H)',
      prices: { Glenwood: 784, Warmwood: 784, DWhite: 844, Gray: 866 } },
    { model: '24BRB',   category: 'tall', width: 24, depth: 24, height: 84,
      description: '24" Broom Cabinet (84"H)',
      prices: { Glenwood: 769, Warmwood: 769, Chadwood: 847, DWhite: 827, Gray: 849 } },
    { model: '24BRBT',  category: 'tall', width: 24, depth: 24, height: 90,
      description: '24" Broom Cabinet (90"H)',
      prices: { Glenwood: 899, Warmwood: 899, Chadwood: 986, DWhite: 876, Gray: 898 } },
    { model: '24BRBXT', category: 'tall', width: 24, depth: 24, height: 96,
      na: ['Chadwood'], description: '24" Broom Cabinet (96"H)',
      prices: { Glenwood: 971, Warmwood: 971, DWhite: 913, Gray: 935 } },

    // --- Vanity Cabinets, 30.5" high, 21" deep ---------------------------
    { model: 'V12B', category: 'vanity', width: 12, depth: 21, height: 30.5,
      description: '12" Vanity Base',
      prices: { Glenwood: 253, Warmwood: 253, Chadwood: 271, DWhite: 292, Gray: 300 } },
    { model: 'V15D', category: 'vanity', width: 15, depth: 21, height: 30.5,
      drawers: 4, description: '15" Vanity Drawer',
      prices: { Glenwood: 434, Warmwood: 434, Chadwood: 451, DWhite: 459, Gray: 459 } },
    { model: 'V24S', category: 'vanity', width: 24, depth: 21, height: 30.5,
      description: '24" Vanity Sink',
      prices: { Glenwood: 282, Warmwood: 282, Chadwood: 308, DWhite: 296, Gray: 304 } },
    { model: 'V30S', category: 'vanity', width: 30, depth: 21, height: 30.5,
      description: '30" Vanity Sink',
      prices: { Glenwood: 330, Warmwood: 330, Chadwood: 359, DWhite: 404, Gray: 419 } },
    { model: 'V36S', category: 'vanity', width: 36, depth: 21, height: 30.5,
      description: '36" Vanity Sink',
      prices: { Glenwood: 360, Warmwood: 360, Chadwood: 394, DWhite: 432, Gray: 447 } },
    { model: 'V36SD', category: 'vanity', width: 36, depth: 21, height: 30.5,
      drawers: 3, description: '36" Vanity Sink + Drawers',
      prices: { Glenwood: 502, Warmwood: 502, Chadwood: 552, DWhite: 527, Gray: 535 } },
    { model: 'V42S', category: 'vanity', width: 42, depth: 21, height: 30.5,
      description: '42" Vanity Sink',
      prices: { Glenwood: 521, Warmwood: 521, Chadwood: 567, DWhite: 604, Gray: 626 } },
    { model: 'V48S', category: 'vanity', width: 48, depth: 21, height: 30.5,
      description: '48" Vanity Sink',
      prices: { Glenwood: 561, Warmwood: 561, Chadwood: 612, DWhite: 641, Gray: 663 } },

    // --- Vanity Cabinets, 34.5" high (V*T) — Chadwood NA -----------------
    { model: 'V12BT', category: 'vanity', width: 12, depth: 21, height: 34.5,
      na: ['Chadwood'], description: '12" Vanity Base (Tall)',
      prices: { Glenwood: 274, Warmwood: 274, DWhite: 312, Gray: 320 } },
    { model: 'V15DT', category: 'vanity', width: 15, depth: 21, height: 34.5,
      drawers: 4, na: ['Chadwood'], description: '15" Vanity Drawer (Tall)',
      prices: { Glenwood: 512, Warmwood: 512, DWhite: 492, Gray: 492 } },
    { model: 'V24ST', category: 'vanity', width: 24, depth: 21, height: 34.5,
      na: ['Chadwood'], description: '24" Vanity Sink (Tall)',
      prices: { Glenwood: 304, Warmwood: 304, DWhite: 320, Gray: 328 } },
    { model: 'V30ST', category: 'vanity', width: 30, depth: 21, height: 34.5,
      na: ['Chadwood'], description: '30" Vanity Sink (Tall)',
      prices: { Glenwood: 359, Warmwood: 359, DWhite: 432, Gray: 447 } },
    { model: 'V36ST', category: 'vanity', width: 36, depth: 21, height: 34.5,
      na: ['Chadwood'], description: '36" Vanity Sink (Tall)',
      prices: { Glenwood: 390, Warmwood: 390, DWhite: 460, Gray: 475 } },
    { model: 'V36SDT', category: 'vanity', width: 36, depth: 21, height: 34.5,
      drawers: 3, na: ['Chadwood'], description: '36" Vanity Sink + Drawers (Tall)',
      prices: { Glenwood: 578, Warmwood: 578, DWhite: 550, Gray: 558 } },
    { model: 'V42ST', category: 'vanity', width: 42, depth: 21, height: 34.5,
      na: ['Chadwood'], description: '42" Vanity Sink (Tall)',
      prices: { Glenwood: 565, Warmwood: 565, DWhite: 645, Gray: 667 } },
    { model: 'V48ST', category: 'vanity', width: 48, depth: 21, height: 34.5,
      na: ['Chadwood'], description: '48" Vanity Sink (Tall)',
      prices: { Glenwood: 606, Warmwood: 606, DWhite: 684, Gray: 706 } },

    // --- Universal Design / ADA accessible Base (32.5" high) -------------
    { model: 'UD12B', category: 'ada', width: 12, depth: 24, height: 32.5,
      description: 'UD 12" Base (ADA)',
      prices: { Glenwood: 347, Warmwood: 347, Chadwood: 372, DWhite: 393, Gray: 401 } },
    { model: 'UD15B', category: 'ada', width: 15, depth: 24, height: 32.5,
      description: 'UD 15" Base (ADA)',
      prices: { Glenwood: 373, Warmwood: 373, Chadwood: 401, DWhite: 418, Gray: 426 } },
    { model: 'UD18B', category: 'ada', width: 18, depth: 24, height: 32.5,
      description: 'UD 18" Base (ADA)',
      prices: { Glenwood: 399, Warmwood: 399, Chadwood: 432, DWhite: 441, Gray: 449 } },
    { model: 'UD21B', category: 'ada', width: 21, depth: 24, height: 32.5,
      description: 'UD 21" Base (ADA)',
      prices: { Glenwood: 425, Warmwood: 425, Chadwood: 462, DWhite: 466, Gray: 474 } },
    { model: 'UD24B', category: 'ada', width: 24, depth: 24, height: 32.5,
      description: 'UD 24" Base (ADA)',
      prices: { Glenwood: 452, Warmwood: 452, Chadwood: 495, DWhite: 492, Gray: 500 } },
    { model: 'UD27B', category: 'ada', width: 27, depth: 24, height: 32.5,
      description: 'UD 27" Base (ADA)',
      prices: { Glenwood: 487, Warmwood: 487, Chadwood: 535, DWhite: 526, Gray: 534 } },
    { model: 'UD30B', category: 'ada', width: 30, depth: 24, height: 32.5,
      description: 'UD 30" Base (ADA)',
      prices: { Glenwood: 591, Warmwood: 591, Chadwood: 639, DWhite: 686, Gray: 701 } },
    { model: 'UD33B', category: 'ada', width: 33, depth: 24, height: 32.5,
      description: 'UD 33" Base (ADA)',
      prices: { Glenwood: 615, Warmwood: 615, Chadwood: 670, DWhite: 710, Gray: 725 } },
    { model: 'UD36B', category: 'ada', width: 36, depth: 24, height: 32.5,
      description: 'UD 36" Base (ADA)',
      prices: { Glenwood: 639, Warmwood: 639, Chadwood: 695, DWhite: 730, Gray: 745 } },
    { model: 'UD42B', category: 'ada', width: 42, depth: 24, height: 32.5,
      description: 'UD 42" Base (ADA)',
      prices: { Glenwood: 701, Warmwood: 701, Chadwood: 768, DWhite: 789, Gray: 804 } },
    { model: 'UD48B', category: 'ada', width: 48, depth: 24, height: 32.5,
      description: 'UD 48" Base (ADA)',
      prices: { Glenwood: 754, Warmwood: 754, Chadwood: 834, DWhite: 838, Gray: 853 } },
    { model: 'UD9T', category: 'ada', width: 9, depth: 24, height: 32.5,
      description: 'UD 9" Tray Base (ADA)',
      prices: { Glenwood: 257, Warmwood: 257, Chadwood: 281, DWhite: 302, Gray: 310 } },
    { model: 'UD15D', category: 'ada', width: 15, depth: 24, height: 32.5,
      drawers: 4, description: 'UD 15" Drawer (ADA)',
      prices: { Glenwood: 620, Warmwood: 620, Chadwood: 666, DWhite: 603, Gray: 603 } },
    { model: 'UD18D', category: 'ada', width: 18, depth: 24, height: 32.5,
      drawers: 4, description: 'UD 18" Drawer (ADA)',
      prices: { Glenwood: 669, Warmwood: 669, Chadwood: 728, DWhite: 648, Gray: 648 } },
    { model: 'UD24D', category: 'ada', width: 24, depth: 24, height: 32.5,
      drawers: 4, description: 'UD 24" Drawer (ADA)',
      prices: { Glenwood: 770, Warmwood: 770, Chadwood: 842, DWhite: 742, Gray: 742 } },
    { model: 'UD30RBS', category: 'ada', width: 30, depth: 24, height: 32.5,
      description: 'UD 30" Range/Sink (ADA)',
      prices: { Glenwood: 443, Warmwood: 443, Chadwood: 485, DWhite: 558, Gray: 573 } },
    { model: 'UD33RBS', category: 'ada', width: 33, depth: 24, height: 32.5,
      description: 'UD 33" Range/Sink (ADA)',
      prices: { Glenwood: 466, Warmwood: 466, Chadwood: 515, DWhite: 582, Gray: 597 } },
    { model: 'UD36RBS', category: 'ada', width: 36, depth: 24, height: 32.5,
      description: 'UD 36" Range/Sink (ADA)',
      prices: { Glenwood: 476, Warmwood: 476, Chadwood: 525, DWhite: 587, Gray: 602 } },
    { model: 'UD42RBS', category: 'ada', width: 42, depth: 24, height: 32.5,
      description: 'UD 42" Range/Sink (ADA)',
      prices: { Glenwood: 524, Warmwood: 524, Chadwood: 584, DWhite: 631, Gray: 646 } },
    { model: 'UD39BC', category: 'ada', blind: true, width: 39, depth: 24, height: 32.5,
      description: 'UD 39" Base Corner (ADA)',
      prices: { Glenwood: 507, Warmwood: 507, Chadwood: 546, DWhite: 556, Gray: 564 } },
    { model: 'UD42BC', category: 'ada', blind: true, width: 42, depth: 24, height: 32.5,
      description: 'UD 42" Base Corner (ADA)',
      prices: { Glenwood: 555, Warmwood: 555, Chadwood: 602, DWhite: 603, Gray: 611 } },

    // --- Fillers (cut to fit). Width is the finished filler width you
    // need; the order list rolls them up into the stock pieces to buy.
    { model: 'F3-B', category: 'filler', width: 3, depth: 24, height: 34.5,
      filler: true, stock: '3F', description: 'Base filler (from 3" × 42" strip)',
      prices: { Glenwood: 41, Warmwood: 41, Chadwood: 39, DWhite: 48, Gray: 48 } },
    { model: 'F6-B', category: 'filler', width: 6, depth: 24, height: 34.5,
      filler: true, stock: '6F', description: 'Base filler (from 6" × 42" strip)',
      prices: { Glenwood: 61, Warmwood: 61, Chadwood: 80, DWhite: 74, Gray: 74 } },
    { model: 'F3-W', category: 'filler', width: 3, depth: 12, height: 30,
      filler: true, stock: '3F', description: 'Wall filler (from 3" × 42" strip)',
      prices: { Glenwood: 41, Warmwood: 41, Chadwood: 39, DWhite: 48, Gray: 48 } },
    { model: 'F6-W', category: 'filler', width: 6, depth: 12, height: 30,
      filler: true, stock: '6F', description: 'Wall filler (from 6" × 42" strip)',
      prices: { Glenwood: 61, Warmwood: 61, Chadwood: 80, DWhite: 74, Gray: 74 } },
    { model: 'F3-T', category: 'filler', width: 3, depth: 24, height: 96,
      filler: true, stock: '3F96', description: 'Tall filler (from 3" × 96" strip)',
      prices: { Glenwood: 75, Warmwood: 75, Chadwood: 95, DWhite: 87, Gray: 87 } },
];


// ------ Helpers ----------------------------------------------------------

const _byModel = new Map(CATALOG.map(c => [c.model, c]));

export function getCabinet(model) {
    return _byModel.get(model) || null;
}

export function priceFor(model, finish) {
    const c = _byModel.get(model);
    if (!c) return 0;
    return (c.prices && c.prices[finish]) || 0;
}

export function isAvailable(model, finish) {
    const c = _byModel.get(model);
    if (!c) return false;
    if (c.na && c.na.includes(finish)) return false;
    return c.prices && c.prices[finish] != null;
}

export function listByCategory(category) {
    return CATALOG.filter(c => c.category === category);
}

export function categoryLabel(category) {
    return ({
        wall: 'Wall cabinets',
        base: 'Base cabinets',
        corner: 'Corner & peninsula',
        lazy: 'Lazy Susan',
        tall: 'Tall (oven / pantry)',
        vanity: 'Vanities',
        ada: 'ADA accessible',
        filler: 'Fillers',
    })[category] || category;
}

// Height of the cabinet's BOTTOM above the floor. Wall cabinets hang so
// the standard 30/36/42" boxes start 18" above a 36" counter (54"); short
// wall boxes (12–24") line their tops up with a 30" box (84") so they sit
// over a range or refrigerator. Everything else sits on the floor.
export function defaultBottom(spec) {
    const isUpper = spec.category === 'wall' ||
        (spec.category === 'filler' && spec.depth <= 12);
    if (!isUpper) return 0;
    const h = spec.height || 30;
    return h >= 30 ? 54 : 84 - h;
}

// The "family" of a model is everything except its leading width, e.g.
// 30B → "B", 36WXT → "WXT", V36S → "V·S". Other widths in the same family
// are offered as one-click swaps in the properties panel.
export function familyOf(model) {
    const m = /^([A-Z]*?)(\d+)(.*)$/.exec(model || '');
    if (!m) return model;
    return `${m[1]}·${m[3]}`;
}

export function sizeVariants(model) {
    const fam = familyOf(model);
    const spec = _byModel.get(model);
    if (!spec) return [];
    return CATALOG
        .filter(c => familyOf(c.model) === fam && c.category === spec.category &&
                     c.height === spec.height && (c.shape || 'rect') === (spec.shape || 'rect'))
        .sort((a, b) => a.width - b.width);
}

// Doors on the front of a cabinet. Single-door boxes (<= 24" wide) get a
// hinge side; wider ones get a pair.
export function doorCount(spec) {
    if (spec.doors != null) return spec.doors;
    if (spec.filler) return 0;
    return spec.width <= 24 ? 1 : 2;
}
