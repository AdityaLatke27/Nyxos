/**
 * Lays out the NYXOS wordmark in an SVG from measured glyph ink bounds.
 *
 * The pivot (0,0) of the wordmark is the center of the "O". While the moon
 * plays the O, the pivot sits on the moon's projected center and the gap
 * between "X" and "S" is driven every frame by the moon's exact on-screen
 * radius. Letter baselines sit at +capHeight/2, so the capitals are centered
 * on the moon vertically too.
 */

const REF = 100 // reference font size the SVG text is set at; scaled via transform
const FONT = '700 100px Orbitron'
const SPACING = 15 // ink-to-ink gap between letters, reference units

interface Glyph {
  left: number // ink extent left of the origin
  right: number // ink extent right of the origin
}

export interface LogoFrame {
  width: number
  height: number
  moonRadiusPx: number
  opacity: number
  settle: number
  oMix: number
  oOpacity: number
  tagline: number
}

export class LogoController {
  private glyphs: Record<string, Glyph> = {}
  private capHeight = 72
  private ready = false
  private svg: SVGSVGElement
  private group: SVGGElement
  private letters: Record<'N' | 'Y' | 'X' | 'O' | 'S', SVGTextElement>
  private tagline: SVGTextElement

  constructor(
    svg: SVGSVGElement,
    group: SVGGElement,
    letters: Record<'N' | 'Y' | 'X' | 'O' | 'S', SVGTextElement>,
    tagline: SVGTextElement,
  ) {
    this.svg = svg
    this.group = group
    this.letters = letters
    this.tagline = tagline
  }

  async init() {
    await document.fonts.load(FONT, 'NYXOS')
    const ctx = document.createElement('canvas').getContext('2d')!
    ctx.font = FONT
    for (const ch of 'NYXOSH') {
      const m = ctx.measureText(ch)
      this.glyphs[ch] = { left: m.actualBoundingBoxLeft, right: m.actualBoundingBoxRight }
      if (ch === 'H') this.capHeight = m.actualBoundingBoxAscent
    }
    for (const el of Object.values(this.letters)) el.setAttribute('y', String(this.capHeight / 2))
    this.tagline.setAttribute('y', String(this.capHeight / 2 + 58))
    this.ready = true
  }

  private inkWidth(ch: string) {
    const g = this.glyphs[ch]
    return g.left + g.right
  }

  /** x positions (text origins) for each letter given the gap half-width. */
  private layout(gapHalf: number) {
    const g = this.glyphs
    const xX = -gapHalf - g.X.right
    const xY = xX - g.X.left - SPACING - g.Y.right
    const xN = xY - g.Y.left - SPACING - g.N.right
    const xS = gapHalf + g.S.left
    const xO = (g.O.left - g.O.right) / 2
    return { xN, xY, xX, xS, xO, leftEdge: xN - g.N.left }
  }

  private centeredFontPx(w: number, h: number) {
    return Math.max(42, Math.min(w * 0.11, h * 0.2, 168))
  }

  /** On-screen moon radius at which it reads as the "O": a touch taller than the caps. */
  moonAsORadiusPx(w: number, h: number) {
    return (this.capHeight * 1.14 * (this.centeredFontPx(w, h) / REF)) / 2
  }

  /**
   * Returns how far (px, +right) the moon should be shifted on screen so the
   * whole word — not just the moon — is centered while it plays the "O".
   */
  render(f: LogoFrame): number {
    if (!this.ready) return 0
    const { width: W, height: H } = f

    const s0 = this.centeredFontPx(W, H) / REF
    const s1 = (W < 640 ? 22 : 27) / REF
    const s = Math.exp(Math.log(s0) + (Math.log(s1) - Math.log(s0)) * f.settle)

    const oGap = this.inkWidth('O') / 2 + SPACING
    const moonGap = f.moonRadiusPx / s + SPACING * 0.95
    const gap = moonGap + (oGap - moonGap) * f.oMix
    const L = this.layout(gap)

    // Letters slide in from the screen edges as the moon shrinks below the
    // viewport; they only become visible once there is room for them.
    const room = Math.min(1, Math.max(0, (W * 0.42 - f.moonRadiusPx) / (W * 0.12)))

    // "NYX" is wider than "S", so center the word's ink box rather than the O.
    const rightEdge = L.xS + this.glyphs.S.right
    const wordShift = -((L.leftEdge + rightEdge) / 2) * s
    const shift = wordShift * room * room * (3 - 2 * room) * (1 - f.settle)

    const finalLayout = this.layout(oGap)
    const marginX = W < 640 ? 22 : 34
    const marginY = W < 640 ? 22 : 30
    const x1 = marginX - finalLayout.leftEdge * s1
    const y1 = marginY + (this.capHeight / 2) * s1
    const x0 = W / 2 + shift
    const cx = x0 + (x1 - x0) * f.settle
    const cy = H / 2 + (y1 - H / 2) * f.settle

    this.letters.N.setAttribute('x', L.xN.toFixed(2))
    this.letters.Y.setAttribute('x', L.xY.toFixed(2))
    this.letters.X.setAttribute('x', L.xX.toFixed(2))
    this.letters.S.setAttribute('x', L.xS.toFixed(2))
    this.letters.O.setAttribute('x', L.xO.toFixed(2))
    this.letters.O.style.opacity = String(f.oOpacity)
    this.tagline.setAttribute('x', (((L.leftEdge + L.xS + this.glyphs.S.right) / 2)).toFixed(2))

    const opacity = f.opacity * (f.settle > 0 ? 1 : room)

    this.group.setAttribute('transform', `translate(${cx.toFixed(2)} ${cy.toFixed(2)}) scale(${s.toFixed(4)})`)
    this.svg.style.opacity = String(opacity)
    this.tagline.style.opacity = String(f.tagline)
    return shift
  }
}
