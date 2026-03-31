"""
Build Quiflotz color bitmap font from character sheet images.
Steps: 1) Split sheets into glyphs  2) Remove backgrounds  3) Build font  4) Export TTF + WOFF2
"""

import cv2
import numpy as np
from PIL import Image
import os
import struct
import io
import base64
from pathlib import Path
from fontTools.ttLib import TTFont, newTable
from fontTools.ttLib.tables._g_l_y_f import Glyph

# ── Paths ──
BASE = Path(r"c:\Users\user\Documents\eytan-workspace\the-system-v8\p-projects\quiflotz\output\public\assets\fonts")
GLYPHS = BASE / "glyphs"
SRC = Path(r"C:\Users\user\Documents\nano-banana-images")

EN_IMG = SRC / "generated-2026-03-28T12-30-40-024Z-pka89r.png"
DIGITS_IMG = SRC / "generated-2026-03-28T12-31-11-103Z-dk6pni.png"
HE_IMG = SRC / "generated-2026-03-28T12-31-49-667Z-sxhizm.png"

GLYPH_SIZE = 128  # uniform size for all glyphs in the font

# ═══════════════════════════════════════════
# HELPER FUNCTIONS
# ═══════════════════════════════════════════

def extract_contours(image_path, min_area=800, dilate_iter=3):
    """Find character contours and return bounding boxes + original image."""
    img = cv2.imread(str(image_path))
    if img is None:
        raise FileNotFoundError(f"Cannot read {image_path}")
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY_INV)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    dilated = cv2.dilate(thresh, kernel, iterations=dilate_iter)
    contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    boxes = []
    for c in contours:
        x, y, w, h = cv2.boundingRect(c)
        if w * h >= min_area and w > 12 and h > 12:
            boxes.append((x, y, w, h))
    return boxes, img


def sort_into_rows(boxes, direction='ltr', row_tolerance=None):
    """Sort boxes into rows. direction='ltr' or 'rtl'."""
    if not boxes:
        return []
    heights = [h for _, _, _, h in boxes]
    median_h = sorted(heights)[len(heights) // 2]
    if row_tolerance is None:
        row_tolerance = median_h * 0.5

    sorted_by_y = sorted(boxes, key=lambda b: b[1])
    rows = []
    cur_row = [sorted_by_y[0]]
    cur_y = sorted_by_y[0][1]

    for box in sorted_by_y[1:]:
        if abs(box[1] - cur_y) < row_tolerance:
            cur_row.append(box)
        else:
            rows.append(cur_row)
            cur_row = [box]
            cur_y = box[1]
    rows.append(cur_row)

    result = []
    for row in rows:
        if direction == 'ltr':
            result.extend(sorted(row, key=lambda b: b[0]))
        else:
            result.extend(sorted(row, key=lambda b: -b[0]))
    return result


def merge_vertical_pairs(boxes, x_overlap_thresh=0.5, y_gap_max_ratio=2.0):
    """Merge vertically-stacked small components (dots of : ; ! ? i j)."""
    if len(boxes) < 2:
        return boxes

    areas = [w * h for _, _, w, h in boxes]
    median_area = sorted(areas)[len(areas) // 2]

    merged = list(boxes)
    changed = True
    while changed:
        changed = False
        new_list = []
        used = set()
        for i in range(len(merged)):
            if i in used:
                continue
            bx, by, bw, bh = merged[i]
            b_area = bw * bh
            for j in range(i + 1, len(merged)):
                if j in used:
                    continue
                ox, oy, ow, oh = merged[j]
                o_area = ow * oh

                # Check horizontal overlap
                overlap_x = min(bx + bw, ox + ow) - max(bx, ox)
                min_w = min(bw, ow)
                if min_w > 0 and overlap_x / min_w > x_overlap_thresh:
                    # Check vertical proximity
                    v_gap = abs((by + bh) - oy) if oy > by else abs((oy + oh) - by)
                    max_h = max(bh, oh)
                    if v_gap < max_h * y_gap_max_ratio:
                        # At least one should be small
                        if b_area < median_area * 0.4 or o_area < median_area * 0.4:
                            nx = min(bx, ox)
                            ny = min(by, oy)
                            nx2 = max(bx + bw, ox + ow)
                            ny2 = max(by + bh, oy + oh)
                            bx, by, bw, bh = nx, ny, nx2 - nx, ny2 - ny
                            used.add(j)
                            changed = True
            new_list.append((bx, by, bw, bh))
            used.add(i)
        merged = new_list
    return merged


def crop_glyph(img, box, padding=10):
    """Crop a glyph with padding."""
    x, y, w, h = box
    ih, iw = img.shape[:2]
    x1 = max(0, x - padding)
    y1 = max(0, y - padding)
    x2 = min(iw, x + w + padding)
    y2 = min(ih, y + h + padding)
    return img[y1:y2, x1:x2]


def process_and_save(img_bgr, path, size=GLYPH_SIZE):
    """Remove white bg, resize to uniform size, save as transparent PNG."""
    # Convert to BGRA
    rgba = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2BGRA)
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    # White -> transparent
    rgba[gray > 235, 3] = 0

    # Resize maintaining aspect ratio, center on canvas
    h, w = rgba.shape[:2]
    margin = 4
    scale = min((size - margin * 2) / w, (size - margin * 2) / h)
    nw, nh = int(w * scale), int(h * scale)
    resized = cv2.resize(rgba, (nw, nh), interpolation=cv2.INTER_AREA)

    canvas = np.zeros((size, size, 4), dtype=np.uint8)
    xo = (size - nw) // 2
    yo = (size - nh) // 2
    canvas[yo:yo + nh, xo:xo + nw] = resized

    cv2.imwrite(str(path), canvas)


# ═══════════════════════════════════════════
# STEP 1: EXTRACT ENGLISH A-Z
# ═══════════════════════════════════════════
print("=== Extracting English A-Z ===")
en_boxes, en_img = extract_contours(EN_IMG, min_area=1000)
en_sorted = sort_into_rows(en_boxes, 'ltr')

ENGLISH = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
print(f"  Found {len(en_sorted)} contours for 26 letters")

if len(en_sorted) > 26:
    by_area = sorted(en_sorted, key=lambda b: b[2] * b[3], reverse=True)[:26]
    en_sorted = sort_into_rows(by_area, 'ltr')
    print(f"  Filtered to {len(en_sorted)}")

for i, letter in enumerate(ENGLISH):
    if i < len(en_sorted):
        crop = crop_glyph(en_img, en_sorted[i])
        process_and_save(crop, GLYPHS / "en" / f"{letter}.png")
        print(f"  {letter}", end="")
print()

# ═══════════════════════════════════════════
# STEP 1: EXTRACT DIGITS + PUNCTUATION
# ═══════════════════════════════════════════
print("\n=== Extracting Digits & Punctuation ===")
dig_boxes, dig_img = extract_contours(DIGITS_IMG, min_area=300, dilate_iter=2)

img_h = dig_img.shape[0]
img_w = dig_img.shape[1]
title_cutoff = int(img_h * 0.10)
dig_filtered = [b for b in dig_boxes if b[1] > title_cutoff]

# Sort into rows
dig_raw_sorted = sort_into_rows(dig_filtered, 'ltr')
rows_dig = []
if dig_raw_sorted:
    heights = [h for _, _, _, h in dig_raw_sorted]
    median_h = sorted(heights)[len(heights) // 2]
    tol = median_h * 0.4
    cur_row = [dig_raw_sorted[0]]
    cur_y = dig_raw_sorted[0][1]
    for b in dig_raw_sorted[1:]:
        if abs(b[1] - cur_y) < tol:
            cur_row.append(b)
        else:
            rows_dig.append(sorted(cur_row, key=lambda b: b[0]))
            cur_row = [b]
            cur_y = b[1]
    rows_dig.append(sorted(cur_row, key=lambda b: b[0]))

print(f"  Raw rows: {len(rows_dig)} with counts {[len(r) for r in rows_dig]}")

# Rows 0-1 = digits (5 each), the rest = punctuation
# Extract digits from first two rows
digit_boxes = []
for r in rows_dig[:2]:
    digit_boxes.extend(r)

for i in range(min(10, len(digit_boxes))):
    crop = crop_glyph(dig_img, digit_boxes[i])
    process_and_save(crop, GLYPHS / "digits" / f"{i}.png")
    print(f"  digit {i}", end="")
print()

# For punctuation, use column-based grid extraction.
# The digit rows have 5 evenly-spaced items. Use their X centers to define columns.
# Then crop each punct cell by column boundaries.
digit_bottom = max(b[1] + b[3] for b in digit_boxes) + 10

# Get column centers from digit row 0 (most reliable)
dig_row0 = digit_boxes[:5]
col_centers = [(b[0] + b[2] // 2) for b in dig_row0]
col_width = (col_centers[-1] - col_centers[0]) / (len(col_centers) - 1)

# Build column boundaries
col_bounds = []
for cx in col_centers:
    x1 = int(cx - col_width * 0.55)
    x2 = int(cx + col_width * 0.55)
    col_bounds.append((max(0, x1), min(img_w, x2)))

print(f"  Column centers: {col_centers}, width~{col_width:.0f}")
print(f"  Column bounds: {col_bounds}")

# Punct row 1: y from digit_bottom to ~75% height
# Punct row 2: y from ~75% to bottom
mid_y = int(img_h * 0.78)  # slightly lower to avoid comma bleeding into plus

# The image shows:
# Punct row 1 has 6 items: : , ! ? : ; (but image only has 5 columns)
# Actually looking at the image more carefully, it has 5 items in different positions
# Let me check: from the debug image, row 1 has: :  ,  !  ?  ;
# with : at col1, , at col2, ! at col3, ? at col4, ; at col5
# BUT these aren't aligned to digit columns since there are fewer of them
# Let me just use contour detection but with proper vertical merging

# Alternative: just crop the two punct rows as whole strips and detect within each
punct_r1_img = dig_img[digit_bottom:mid_y, :]
punct_r2_img = dig_img[mid_y:, :]

def extract_punct_row(row_img, y_offset, min_area=200):
    """Extract characters from a single punct row, merging vertical pairs."""
    gray = cv2.cvtColor(row_img, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY_INV)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    dilated = cv2.dilate(thresh, kernel, iterations=2)
    contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    boxes = []
    for c in contours:
        x, y, w, h = cv2.boundingRect(c)
        if w * h >= min_area and w > 8 and h > 8:
            boxes.append((x, y + y_offset, w, h))

    # Group by X overlap (merge vertically-stacked components like : ; ! ?)
    boxes = sorted(boxes, key=lambda b: b[0])
    merged = []
    used = set()
    for i in range(len(boxes)):
        if i in used:
            continue
        bx, by, bw, bh = boxes[i]
        for j in range(i + 1, len(boxes)):
            if j in used:
                continue
            ox, oy, ow, oh = boxes[j]
            # Check X overlap
            overlap = min(bx + bw, ox + ow) - max(bx, ox)
            if overlap > min(bw, ow) * 0.3:
                # Merge
                nx = min(bx, ox)
                ny = min(by, oy)
                bw = max(bx + bw, ox + ow) - nx
                bh = max(by + bh, oy + oh) - ny
                bx, by = nx, ny
                used.add(j)
        merged.append((bx, by, bw, bh))
        used.add(i)

    return sorted(merged, key=lambda b: b[0])

row1_boxes = extract_punct_row(punct_r1_img, digit_bottom)
row2_boxes = extract_punct_row(punct_r2_img, mid_y)

print(f"  Punct row 1: {len(row1_boxes)} items, row 2: {len(row2_boxes)} items")

punct_rows = [row1_boxes, row2_boxes]

# Row 1 items from the image (L-to-R): broken-colon, comma, exclamation, question, colon, semicolon
# The first colon's upper dot merged with digit 5 above, so skip it.
# Row 2: hyphen, plus, equals, at, hash
PUNCT_ROW2_NAMES = ['hyphen', 'plus', 'equals', 'at', 'hash']

punct_saved = 0
if len(punct_rows) >= 1:
    row1 = punct_rows[0]
    # Map the 6 items: [0]=broken dot (skip), [1]=comma, [2]=!, [3]=?, [4]=colon, [5]=semicolon
    if len(row1) >= 6:
        row1_map = [
            (1, 'comma'), (2, 'exclamation'), (3, 'question'),
            (4, 'colon'), (5, 'semicolon'),
        ]
    elif len(row1) == 5:
        # If exactly 5, assume they're already correct: comma, !, ?, colon, semicolon
        row1_map = [
            (0, 'comma'), (1, 'exclamation'), (2, 'question'),
            (3, 'colon'), (4, 'semicolon'),
        ]
    else:
        row1_map = [(i, f'punct{i}') for i in range(len(row1))]

    for idx, name in row1_map:
        if idx < len(row1):
            crop = crop_glyph(dig_img, row1[idx])
            process_and_save(crop, GLYPHS / "punct" / f"{name}.png")
            print(f"  {name}", end="")
            punct_saved += 1

if len(punct_rows) >= 2:
    row2 = punct_rows[1]
    for i, name in enumerate(PUNCT_ROW2_NAMES):
        if i < len(row2):
            crop = crop_glyph(dig_img, row2[i])
            process_and_save(crop, GLYPHS / "punct" / f"{name}.png")
            print(f"  {name}", end="")
            punct_saved += 1

print()
print(f"  Saved {punct_saved}/10 punctuation marks")

PUNCT_LABELS = [
    ('colon', ':'), ('comma', ','), ('exclamation', '!'),
    ('question', '?'), ('semicolon', ';'),
    ('hyphen', '-'), ('plus', '+'), ('equals', '='),
    ('at', '@'), ('hash', '#'),
]

# ═══════════════════════════════════════════
# STEP 1: EXTRACT HEBREW
# ═══════════════════════════════════════════
print("\n=== Extracting Hebrew ===")

HEBREW_MAP = [
    ('alef', 0x05D0), ('bet', 0x05D1), ('gimel', 0x05D2), ('dalet', 0x05D3),
    ('he', 0x05D4), ('vav', 0x05D5), ('zayin', 0x05D6),
    ('chet', 0x05D7), ('tet', 0x05D8), ('yod', 0x05D9), ('kaf', 0x05DB),
    ('lamed', 0x05DC), ('mem', 0x05DE), ('nun', 0x05E0),
    ('samekh', 0x05E1), ('ayin', 0x05E2), ('pe', 0x05E4), ('tsadi', 0x05E6),
    ('qof', 0x05E7), ('resh', 0x05E8), ('shin', 0x05E9),
    ('tav', 0x05EA), ('mem_sofit', 0x05DD), ('nun_sofit', 0x05DF),
    ('pe_sofit', 0x05E3), ('kaf_sofit', 0x05DA), ('tsadi_sofit', 0x05E5),
]

# Try multiple dilation levels to find the one giving closest to 27
# The bottom text is at ~95% height, Hebrew letters go down to ~90%
best_sorted = []
for dilate in [1, 2, 3, 4]:
    he_boxes, he_img = extract_contours(HE_IMG, min_area=400, dilate_iter=dilate)
    he_h = he_img.shape[0]
    text_cutoff = int(he_h * 0.92)  # skip only the label text at very bottom
    he_filtered = [b for b in he_boxes if b[1] + b[3] < text_cutoff]
    # Don't merge Hebrew - letters are self-contained and merging eats small ones like yod
    he_sorted_try = sort_into_rows(he_filtered, 'rtl')
    print(f"  dilate={dilate}: {len(he_filtered)} raw -> {len(he_sorted_try)} sorted")
    if abs(len(he_sorted_try) - 27) < abs(len(best_sorted) - 27):
        best_sorted = he_sorted_try
he_sorted = best_sorted

# If still more than needed, filter by size
if len(he_sorted) > len(HEBREW_MAP):
    by_area = sorted(he_sorted, key=lambda b: b[2] * b[3], reverse=True)[:len(HEBREW_MAP)]
    he_sorted = sort_into_rows(by_area, 'rtl')

for i, (name, cp) in enumerate(HEBREW_MAP):
    if i < len(he_sorted):
        crop = crop_glyph(he_img, he_sorted[i])
        process_and_save(crop, GLYPHS / "he" / f"{name}.png")
        print(f"  {name}(U+{cp:04X})", end="")
    else:
        print(f"  MISSING:{name}", end="")
print()

# ═══════════════════════════════════════════
# STEP 3 & 4: BUILD FONT
# ═══════════════════════════════════════════
print("\n=== Building Quiflotz Font ===")

# Load all glyph PNGs
glyph_data = {}  # glyph_name -> png_bytes

def load_png(path):
    if path.exists():
        return path.read_bytes()
    return None

# Build character map
char_map = {}  # unicode -> glyph_name

# English
for letter in ENGLISH:
    path = GLYPHS / "en" / f"{letter}.png"
    gname = f"uni{ord(letter):04X}"
    data = load_png(path)
    if data:
        char_map[ord(letter)] = gname
        char_map[ord(letter.lower())] = f"uni{ord(letter.lower()):04X}"
        glyph_data[gname] = data
        glyph_data[f"uni{ord(letter.lower()):04X}"] = data  # same image for lowercase

# Digits
for d in range(10):
    path = GLYPHS / "digits" / f"{d}.png"
    gname = f"uni{ord(str(d)):04X}"
    data = load_png(path)
    if data:
        char_map[ord(str(d))] = gname
        glyph_data[gname] = data

# Punctuation
PUNCT_UNICODE = {
    'colon': ord(':'), 'comma': ord(','), 'exclamation': ord('!'),
    'question': ord('?'), 'semicolon': ord(';'),
    'hyphen': ord('-'), 'plus': ord('+'), 'equals': ord('='),
    'at': ord('@'), 'hash': ord('#'),
}
for name, cp in PUNCT_UNICODE.items():
    path = GLYPHS / "punct" / f"{name}.png"
    gname = f"uni{cp:04X}"
    data = load_png(path)
    if data:
        char_map[cp] = gname
        glyph_data[gname] = data

# Also add period (.) - we don't have it from the sheet, create from comma or use empty
# Actually let's skip period since it wasn't in the source images

# Hebrew
for name, cp in HEBREW_MAP:
    path = GLYPHS / "he" / f"{name}.png"
    gname = f"uni{cp:04X}"
    data = load_png(path)
    if data:
        char_map[cp] = gname
        glyph_data[gname] = data

# Space
char_map[0x20] = 'space'

print(f"  Glyphs with images: {len(glyph_data)}")
print(f"  Unicode mappings: {len(char_map)}")

# ── Build TrueType font ──
font = TTFont()
upem = 1024
ascent = 900
descent = -200

# Glyph order
glyph_names = ['.notdef', 'space']
seen = set()
for cp in sorted(char_map.keys()):
    gname = char_map[cp]
    if gname not in seen and gname != 'space':
        glyph_names.append(gname)
        seen.add(gname)

font.setGlyphOrder(glyph_names)

# head
head = newTable('head')
head.tableVersion = 1.0
head.fontRevision = 1.0
head.magicNumber = 0x5F0F3CF5
head.flags = 0x000B
head.unitsPerEm = upem
head.created = 0
head.modified = 0
head.xMin = 0
head.yMin = descent
head.xMax = upem
head.yMax = ascent
head.macStyle = 0
head.lowestRecPPEM = 8
head.fontDirectionHint = 2
head.indexToLocFormat = 0
head.glyphDataFormat = 0
head.checkSumAdjustment = 0
font['head'] = head

# hhea
hhea = newTable('hhea')
hhea.tableVersion = 0x00010000
hhea.ascent = ascent
hhea.descent = descent
hhea.lineGap = 0
hhea.advanceWidthMax = upem
hhea.minLeftSideBearing = 0
hhea.minRightSideBearing = 0
hhea.xMaxExtent = upem
hhea.caretSlopeRise = 1
hhea.caretSlopeRun = 0
hhea.caretOffset = 0
hhea.reserved0 = 0
hhea.reserved1 = 0
hhea.reserved2 = 0
hhea.reserved3 = 0
hhea.metricDataFormat = 0
hhea.numberOfHMetrics = len(glyph_names)
font['hhea'] = hhea

# maxp
maxp = newTable('maxp')
maxp.tableVersion = 0x00010000
maxp.numGlyphs = len(glyph_names)
maxp.maxZones = 1
maxp.maxTwilightPoints = 0
maxp.maxStorage = 0
maxp.maxFunctionDefs = 0
maxp.maxInstructionDefs = 0
maxp.maxStackElements = 0
maxp.maxSizeOfInstructions = 0
maxp.maxComponentElements = 0
maxp.maxComponentDepth = 0
maxp.maxPoints = 0
maxp.maxContours = 0
maxp.maxCompositePoints = 0
maxp.maxCompositeContours = 0
font['maxp'] = maxp

# OS/2
os2 = newTable('OS/2')
os2.version = 4
os2.xAvgCharWidth = upem
os2.usWeightClass = 400
os2.usWidthClass = 5
os2.fsType = 0
os2.ySubscriptXSize = 650
os2.ySubscriptYSize = 600
os2.ySubscriptXOffset = 0
os2.ySubscriptYOffset = 75
os2.ySuperscriptXSize = 650
os2.ySuperscriptYSize = 600
os2.ySuperscriptXOffset = 0
os2.ySuperscriptYOffset = 350
os2.yStrikeoutSize = 50
os2.yStrikeoutPosition = 300
os2.sFamilyClass = 0
from fontTools.ttLib.tables.O_S_2f_2 import Panose
os2.panose = Panose()
os2.ulUnicodeRange1 = 0xE000002F
os2.ulUnicodeRange2 = 0x00000000
os2.ulUnicodeRange3 = 0x00000000
os2.ulUnicodeRange4 = 0x00000000
os2.achVendID = 'QFLZ'
os2.fsSelection = 0x0040
os2.usFirstCharIndex = min(cp for cp in char_map if cp > 0)
os2.usLastCharIndex = min(max(char_map.keys()), 0xFFFF)
os2.sTypoAscender = ascent
os2.sTypoDescender = descent
os2.sTypoLineGap = 0
os2.usWinAscent = ascent
os2.usWinDescent = abs(descent)
os2.ulCodePageRange1 = 0x00000001
os2.ulCodePageRange2 = 0x00000000
os2.sxHeight = 500
os2.sCapHeight = 700
os2.usDefaultChar = 0
os2.usBreakChar = 32
os2.usMaxContext = 0
font['OS/2'] = os2

# name
name_table = newTable('name')
name_table.names = []
for nid, val in {
    0: "Copyright 2026 Quiflotz",
    1: "Quiflotz", 2: "Regular", 3: "Quiflotz-Regular",
    4: "Quiflotz Regular", 5: "Version 1.0", 6: "Quiflotz-Regular",
    9: "Quiflotz Project", 16: "Quiflotz", 17: "Regular",
}.items():
    name_table.setName(val, nid, 3, 1, 0x0409)
font['name'] = name_table

# post
post = newTable('post')
post.formatType = 3.0
post.italicAngle = 0
post.underlinePosition = -100
post.underlineThickness = 50
post.isFixedPitch = 0
post.minMemType42 = 0
post.maxMemType42 = 0
post.minMemType1 = 0
post.maxMemType1 = 0
font['post'] = post

# cmap
from fontTools.ttLib.tables._c_m_a_p import cmap_format_4
cmap_table = newTable('cmap')
cmap_table.tableVersion = 0

# Windows Unicode BMP subtable
subtable_win = cmap_format_4(4)
subtable_win.platformID = 3  # Windows
subtable_win.platEncID = 1   # Unicode BMP
subtable_win.format = 4
subtable_win.reserved = 0
subtable_win.language = 0
subtable_win.cmap = {cp: gname for cp, gname in char_map.items()}

# Unicode subtable
subtable_uni = cmap_format_4(4)
subtable_uni.platformID = 0  # Unicode
subtable_uni.platEncID = 3   # Unicode 2.0 BMP
subtable_uni.format = 4
subtable_uni.reserved = 0
subtable_uni.language = 0
subtable_uni.cmap = {cp: gname for cp, gname in char_map.items()}

cmap_table.tables = [subtable_uni, subtable_win]
font['cmap'] = cmap_table

# hmtx
hmtx = newTable('hmtx')
hmtx.metrics = {}
for gname in glyph_names:
    if gname == 'space':
        hmtx.metrics[gname] = (upem // 3, 0)
    else:
        hmtx.metrics[gname] = (upem, 0)
font['hmtx'] = hmtx

# glyf + loca (minimal empty glyphs required for valid TrueType)
font['loca'] = newTable('loca')
glyf = newTable('glyf')
glyf.glyphs = {}
glyf.glyphOrder = glyph_names
for gname in glyph_names:
    glyf.glyphs[gname] = Glyph()
font['glyf'] = glyf

# ── sbix table (Apple-style color bitmaps) ──
print("  Adding sbix table...")
from fontTools.ttLib.tables._s_b_i_x import table__s_b_i_x
from fontTools.ttLib.tables.sbixStrike import Strike
from fontTools.ttLib.tables.sbixGlyph import Glyph as SbixGlyph

sbix = table__s_b_i_x()
sbix.version = 1
sbix.flags = 1

strike = Strike(ppem=GLYPH_SIZE, resolution=72)
strike.glyphs = {}

for gname in glyph_names:
    img_data = glyph_data.get(gname, b'')
    g = SbixGlyph(
        glyphName=gname,
        graphicType='png ' if img_data else None,
        originOffsetX=0,
        originOffsetY=0,
        imageData=img_data if img_data else None,
    )
    strike.glyphs[gname] = g

sbix.strikes = {GLYPH_SIZE: strike}
font['sbix'] = sbix

# ── SVG table (broader compatibility: Chrome, Firefox) ──
print("  Adding SVG table...")
from fontTools.ttLib.tables.S_V_G_ import table_S_V_G_

svg_table = table_S_V_G_()
svg_docs = []

for gname, data in glyph_data.items():
    if not data:
        continue
    try:
        gid = glyph_names.index(gname)
    except ValueError:
        continue

    b64 = base64.b64encode(data).decode('ascii')
    svg_doc = (
        f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'
        f' viewBox="0 {-ascent} {upem} {upem}">'
        f'<image x="0" y="{-ascent}" width="{upem}" height="{upem}"'
        f' xlink:href="data:image/png;base64,{b64}"/>'
        f'</svg>'
    )
    svg_docs.append((svg_doc, gid, gid))

svg_table.docList = sorted(svg_docs, key=lambda x: x[1])
font['SVG '] = svg_table

# ── SAVE ──
ttf_path = BASE / "Quiflotz.ttf"
print(f"\n  Saving TTF -> {ttf_path}")
font.save(str(ttf_path))
print(f"  TTF size: {os.path.getsize(ttf_path):,} bytes")

woff2_path = BASE / "Quiflotz.woff2"
print(f"  Saving WOFF2 -> {woff2_path}")
font.flavor = 'woff2'
font.save(str(woff2_path))
print(f"  WOFF2 size: {os.path.getsize(woff2_path):,} bytes")

# ── SUMMARY ──
en_count = sum(1 for l in ENGLISH if (GLYPHS / 'en' / f'{l}.png').exists())
dig_count = sum(1 for d in range(10) if (GLYPHS / 'digits' / f'{d}.png').exists())
pct_count = sum(1 for n in PUNCT_UNICODE if (GLYPHS / 'punct' / f'{n}.png').exists())
he_count = sum(1 for n, _ in HEBREW_MAP if (GLYPHS / 'he' / f'{n}.png').exists())

print("\n" + "=" * 60)
print("QUIFLOTZ FONT BUILD COMPLETE")
print("=" * 60)
print(f"  English A-Z:    {en_count}/26")
print(f"  Digits 0-9:     {dig_count}/10")
print(f"  Punctuation:    {pct_count}/{len(PUNCT_UNICODE)}")
print(f"  Hebrew:         {he_count}/{len(HEBREW_MAP)}")
print(f"  Total glyphs:   {len(glyph_data)} (with images)")
print(f"  Unicode maps:   {len(char_map)} (incl. lowercase aliases)")
print(f"  Font tables:    sbix + SVG (dual color bitmap)")
print(f"  Output:         {ttf_path}")
print(f"                  {woff2_path}")
