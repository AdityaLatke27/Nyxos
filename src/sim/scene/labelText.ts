/** Text with a soft dark halo so it stays legible over sunlit and shadowed ground alike. */
export function haloText(g: CanvasRenderingContext2D, text: string, x: number, y: number, fill: string) {
  g.lineJoin = 'round'
  g.strokeStyle = 'rgba(0,0,0,0.62)'
  g.lineWidth = 3.2
  g.strokeText(text, x, y)
  g.fillStyle = fill
  g.fillText(text, x, y)
}
