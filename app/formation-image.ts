import { PITCH, PITCH_MARKINGS, RUN_KINDS, runArrow, type PitchPoint } from '@/lib/formation';

// A marker as the shared image shows it. photo is a same-origin URL, so drawing it keeps the canvas exportable.
// attack and defend are the arrowheads of the runs to draw, if any.
export type ImageMarker = { name: string; initials: string; photo: string | null; x: number; y: number; attack: PitchPoint | null; defend: PitchPoint | null };

const WIDTH = 1080, HEADER = 190, PAD = 40, SCALE = (WIDTH - 2 * PAD) / (PITCH.width + 2 * PITCH.margin), DISC = 46;
// Run line widths and the defensive dash, in pitch metres, as the on-screen arrows in motion.css draw them.
const RUN = { casing: 1, line: 0.55, head: 0.45, dash: [1.6, 1.1] };

// Draws the formation as a PNG: a header with the team and formation names, then the pitch and its markers.
// Colours come from the on-screen pitch's CSS variables, so the image matches the theme.
export async function formationImage(pitch: HTMLElement, team: string, formation: string, markers: ImageMarker[]): Promise<Blob> {
  const css = getComputedStyle(pitch), color = (name: string) => css.getPropertyValue(name).trim();
  const fieldTop = HEADER + PITCH.margin * SCALE, fieldLeft = PAD + PITCH.margin * SCALE;
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEADER + (PITCH.length + 2 * PITCH.margin) * SCALE + PAD;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw the formation image.');
  const font = getComputedStyle(document.body).fontFamily;
  ctx.fillStyle = color('--pitch-page');
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = color('--pitch-heading');
  ctx.textBaseline = 'alphabetic';
  ctx.font = `800 64px ${font}`;
  ctx.fillText(formation, PAD, 100, WIDTH - 2 * PAD);
  ctx.font = `600 34px ${font}`;
  ctx.fillText(team, PAD, 150, WIDTH - 2 * PAD);

  ctx.fillStyle = color('--pitch-grass');
  ctx.fillRect(PAD, HEADER, WIDTH - 2 * PAD, (PITCH.length + 2 * PITCH.margin) * SCALE);
  ctx.save();
  ctx.translate(fieldLeft, fieldTop);
  ctx.scale(SCALE, SCALE);
  ctx.strokeStyle = color('--pitch-line');
  ctx.fillStyle = color('--pitch-line');
  ctx.lineWidth = 0.35;
  for (const [x, y, w, h] of PITCH_MARKINGS.rects) ctx.strokeRect(x, y, w, h);
  for (const [x1, y1, x2, y2] of PITCH_MARKINGS.lines) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
  for (const [x, y, r] of PITCH_MARKINGS.circles) { ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.stroke(); }
  for (const [x, y] of PITCH_MARKINGS.spots) { ctx.beginPath(); ctx.arc(x, y, 0.5, 0, 2 * Math.PI); ctx.fill(); }
  for (const marker of markers) for (const kind of RUN_KINDS) {
    const head = marker[kind], arrow = head && runArrow(marker, head);
    if (arrow) drawRun(ctx, arrow, kind === 'defend', color(kind === 'attack' ? '--run-attack' : '--run-defend'), color('--run-casing'));
  }
  ctx.restore();

  const photos = await Promise.all(markers.map(m => m.photo ? loadImage(m.photo) : null));
  ctx.textAlign = 'center';
  markers.forEach((marker, i) => {
    const cx = fieldLeft + marker.x * PITCH.width * SCALE, cy = fieldTop + marker.y * PITCH.length * SCALE;
    ctx.beginPath();
    ctx.arc(cx, cy, DISC, 0, 2 * Math.PI);
    ctx.fillStyle = color('--team-color');
    ctx.fill();
    const photo = photos[i];
    if (photo) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, DISC - 5, 0, 2 * Math.PI);
      ctx.clip();
      const side = Math.min(photo.naturalWidth, photo.naturalHeight);
      ctx.drawImage(photo, (photo.naturalWidth - side) / 2, (photo.naturalHeight - side) / 2, side, side, cx - DISC + 5, cy - DISC + 5, 2 * (DISC - 5), 2 * (DISC - 5));
      ctx.restore();
    } else {
      ctx.fillStyle = color('--team-ink');
      ctx.font = `800 34px ${font}`;
      ctx.textBaseline = 'middle';
      ctx.fillText(marker.initials, cx, cy + 1);
    }
    ctx.font = `700 26px ${font}`;
    ctx.textBaseline = 'top';
    const label = marker.name, width = Math.min(ctx.measureText(label).width + 20, 230);
    ctx.fillStyle = color('--pitch-label');
    ctx.beginPath();
    ctx.roundRect(cx - width / 2, cy + DISC + 6, width, 36, 10);
    ctx.fill();
    ctx.fillStyle = color('--pitch-label-ink');
    ctx.fillText(label, cx, cy + DISC + 11, 210);
  });
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The formation image could not be made.')), 'image/png'));
}

// Attack is a solid line and defence a dashed one, each over a dark casing so it reads on the grass, with a head.
function drawRun(ctx: CanvasRenderingContext2D, arrow: NonNullable<ReturnType<typeof runArrow>>, dashed: boolean, fill: string, casing: string) {
  const [x1, y1, x2, y2] = arrow.line;
  ctx.lineCap = 'butt';
  ctx.setLineDash(dashed ? RUN.dash : []);
  for (const [style, width] of [[casing, RUN.casing], [fill, RUN.line]] as const) {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.beginPath();
  arrow.head.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = casing;
  ctx.lineWidth = RUN.head;
  ctx.stroke();
  ctx.fillStyle = fill;
  ctx.fill();
}

// A photo that fails to load is drawn as initials instead.
function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}
