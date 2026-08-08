/* ==========================================================================
   plate.js — every card face is drawn at runtime onto a 2D canvas.

   The flythrough build ships zero image assets and generates its concrete and
   inscriptions the same way; keeping that here means a new lens costs one
   <article> in the HTML and nothing else. It also means the plates can be
   redrawn when the colour mode flips, instead of shipping two sets.
   ========================================================================== */

const RATIO = 4 / 3;             // h / w — portrait plate, reads in both orientations
const PAD = 0.085;               // inset as a fraction of plate width

/* Characters that must not begin a line (simplified kinsoku shori). */
const NO_START = '、。，．・：；？！ゝゞーぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ）」』】〉》”’';

/* Japanese breaks per character, Latin does not. Splitting "Dialogue" across
   two lines as "Dial / ogue" is what a per-character wrap does to a mixed
   string, so Latin/digit runs are kept whole as single tokens. */
const LATIN = /[A-Za-z0-9._'&@+-]/;
/* Punctuation a Japanese line may end on. Keeping these as run terminators
   gives the word pass a clause boundary to aim at, so 研究者であり、実践者。
   breaks after the comma instead of mid-word at であ / り、. */
const BREAK_AFTER = '、。・：；？！';

function tokenize(text, glueCJK) {
  const out = [];
  let run = '';
  let runIsLatin = false;
  const flush = () => { if (run) { out.push(run); run = ''; } };
  for (const ch of text) {
    const latin = LATIN.test(ch);
    if (latin || (glueCJK && ch !== ' ' && ch !== '\n')) {
      if (run && latin !== runIsLatin) flush();
      run += ch;
      runIsLatin = latin;
      if (glueCJK && BREAK_AFTER.includes(ch)) flush();
      continue;
    }
    flush();
    out.push(ch);
  }
  flush();
  return out;
}

function layoutLines(ctx, text, maxWidth, glueCJK) {
  const lines = [];
  let line = '';
  for (const tok of tokenize(text, glueCJK)) {
    if (tok === '\n') { lines.push(line); line = ''; continue; }
    if (!line && tok === ' ') continue;
    const next = line + tok;
    if (ctx.measureText(next).width > maxWidth && line) {
      if (NO_START.includes(tok)) {
        lines.push(next);          // pull the offender up rather than orphan it
        line = '';
      } else {
        lines.push(line.replace(/\s+$/, ''));
        line = tok === ' ' ? '' : tok;
      }
    } else {
      line = next;
    }
  }
  if (line) lines.push(line.replace(/\s+$/, ''));
  return lines;
}

/**
 * Wrap, then even the lines out.
 *
 * A greedy wrap fills line one to the brim: 合同会社BWH総合研究所 came out as
 * 合同会社BWH総 / 合研究所, splitting 総合 down the middle. Guessing a target
 * width (half the total, say) does not work either — the first guess I tried
 * overshot into three lines and silently fell back to the greedy result.
 *
 * So: binary-search the *narrowest* measure that still fits the same number
 * of lines. Whatever that is, it is by definition the break furthest from the
 * brim, which is the balanced one.
 */
function balance(ctx, text, maxWidth, glueCJK) {
  const lines = layoutLines(ctx, text, maxWidth, glueCJK);
  if (lines.length < 2) return lines;
  let best = lines;
  let lo = ctx.measureText(text).width / (lines.length + 1);
  let hi = maxWidth;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    const cand = layoutLines(ctx, text, mid, glueCJK);
    if (cand.length <= lines.length) { best = cand; hi = mid; } else { lo = mid; }
  }
  return best;
}

export function wrap(ctx, text, maxWidth) {
  /* Break at a space or a script boundary when the string offers one.
     Balancing alone is not enough: minimising the widest line turned
     "一般社団法人 e-donuts" into 一般社団法 / 人 e-donuts, which is narrower
     and worse. Only fall through to per-character breaking — the normal rule
     for Japanese — when no word-level split fits. */
  const byWord = balance(ctx, text, maxWidth, true);
  if (byWord.every((l) => ctx.measureText(l).width <= maxWidth)) return byWord;
  return balance(ctx, text, maxWidth, false);
}

function grain(ctx, w, h, alpha) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * alpha;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * @param {{num:string,cat:string,title:string,tags:string}} lens
 * @param {{width:number, ink:string, field:string, dim:string}} opt
 * @returns {HTMLCanvasElement}
 */
export function drawPlate(lens, opt) {
  const w = opt.width;
  const h = Math.round(w * RATIO);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');

  /* Field with a soft top-down fall so the plate has a light direction even
     though nothing in the scene casts one. */
  const g = ctx.createLinearGradient(0, 0, w * 0.35, h);
  g.addColorStop(0, opt.plateHi);
  g.addColorStop(1, opt.plateLo);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  grain(ctx, w, h, 16);

  const pad = w * PAD;
  const inner = w - pad * 2;

  /* Hairline frame — the only ornament. */
  ctx.strokeStyle = opt.line;
  ctx.lineWidth = Math.max(1, w / 512);
  ctx.strokeRect(pad * 0.55, pad * 0.55, w - pad * 1.1, h - pad * 1.1);

  /* Header row: numeral left, category right. */
  const meta = Math.round(w * 0.045);
  ctx.font = `400 ${meta}px "JetBrains Mono", ui-monospace, monospace`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = opt.ink;
  ctx.fillText(lens.num, pad, pad + meta);
  ctx.textAlign = 'right';
  ctx.fillStyle = opt.dim;
  ctx.fillText(lens.cat.toUpperCase(), w - pad, pad + meta);
  ctx.textAlign = 'left';

  /* Title — mincho, set large, wrapped, bottom-anchored above the tag rule.

     Shrink-to-fit rather than accept a bad break: at a fixed size
     "株式会社ツカイシ" overflowed the measure by a few pixels and stranded a
     single ジ on its own line. Step down until the last line has company. */
  let size = Math.round(w * (lens.title.length > 14 ? 0.085 : 0.105));
  let lines;
  for (let pass = 0; pass < 6; pass++) {
    ctx.font = `500 ${size}px "Zen Old Mincho", "Noto Serif JP", serif`;
    lines = wrap(ctx, lens.title, inner);
    const orphan = lines.length > 1 && [...lines[lines.length - 1]].length < 2;
    if (!orphan && lines.length <= 4) break;
    size = Math.round(size * 0.92);
  }
  const lead = size * 1.42;
  /* The rule has to clear the frame by more than the tag block is tall: at
     0.09w the second tag line landed on the hairline border. */
  const ruleY = h - pad - w * 0.155;
  let y = ruleY - w * 0.055 - (lines.length - 1) * lead;
  ctx.fillStyle = opt.ink;
  for (const l of lines) { ctx.fillText(l, pad, y); y += lead; }

  /* Tag rule + tags. */
  ctx.strokeStyle = opt.line;
  ctx.beginPath();
  ctx.moveTo(pad, ruleY);
  ctx.lineTo(w - pad, ruleY);
  ctx.stroke();

  const tag = Math.round(w * 0.036);
  ctx.font = `400 ${tag}px "JetBrains Mono", ui-monospace, monospace`;
  ctx.fillStyle = opt.dim;
  const tagLines = wrap(ctx, lens.tags, inner);
  let ty = ruleY + tag * 1.8;
  for (const l of tagLines.slice(0, 2)) { ctx.fillText(l, pad, ty); ty += tag * 1.45; }

  return cv;
}

export const PLATE_RATIO = RATIO;
