export type Brush = CanvasRenderingContext2D;

export function fill(g: Brush, color: string | CanvasGradient, d: string) {
  g.fillStyle = color;
  g.fill(new Path2D(d));
}

export function stroke(
  g: Brush,
  color: string | CanvasGradient,
  width: number,
  d: string,
) {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.stroke(new Path2D(d));
}

export function rect(
  g: Brush,
  color: string | CanvasGradient,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  g.fillStyle = color;
  g.fillRect(x, y, w, h);
}

export function ellipse(
  g: Brush,
  color: string | CanvasGradient,
  x: number,
  y: number,
  rx: number,
  ry: number,
) {
  if (rx <= 0 || ry <= 0) return;
  g.fillStyle = color;
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  g.fill();
}

export function metal(
  g: Brush,
  top: number,
  bottom: number,
  ...stops: [number, string][]
) {
  const grad = g.createLinearGradient(0, top, 0, bottom);
  for (const [at, color] of stops) grad.addColorStop(at, color);
  return grad;
}

export function polygon(g: Brush, color: string, coords: number[]) {
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(coords[0]!, coords[1]!);
  for (let i = 2; i < coords.length; i += 2)
    g.lineTo(coords[i]!, coords[i + 1]!);
  g.closePath();
  g.fill();
}

export function type(
  g: Brush,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = "left",
  weight = 700,
) {
  g.save();
  g.font = `${weight} ${size}px "Barlow Condensed","Arial Narrow",sans-serif`;
  g.fillStyle = color;
  g.textAlign = align;
  g.fillText(text, x, y);
  g.restore();
}

export function setup(canvas: HTMLCanvasElement) {
  const width = canvas.clientWidth || 800,
    height = canvas.clientHeight || 450;
  const dpr = Math.min(
    2,
    canvas.ownerDocument.defaultView?.devicePixelRatio ?? 1,
  );
  const pixelsWide = Math.round(width * dpr),
    pixelsHigh = Math.round(height * dpr);
  if (canvas.width !== pixelsWide) canvas.width = pixelsWide;
  if (canvas.height !== pixelsHigh) canvas.height = pixelsHigh;
  const g = canvas.getContext("2d");
  if (!g) return;
  const h = 540,
    w = (width / height) * h;
  g.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);
  return { g, w, h };
}

export function noise(n: number) {
  const a = Math.sin(n * 12.9898 + 4.1414) * 43758.5453;
  return a - Math.floor(a);
}
