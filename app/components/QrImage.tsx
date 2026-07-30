import { useEffect, useState } from 'react'

/**
 * Renders one URL as a QR code and hands back an inline data URI.
 *
 * The encoder is loaded with a dynamic import so it lands in its own chunk.
 * Only the organiser ever opens /admin; making two hundred phones download a QR
 * library they will never run, over the same congested venue wifi they are
 * trying to vote on, would be a poor trade for one image.
 *
 * Options live here rather than at each call site because the print sheet and
 * the dashboard have to produce the same image. A per-attendee slip that scanned
 * on the organiser's screen and not off the paper would be discovered by the
 * person holding the paper, in a room, once.
 */
export async function renderQrSvg(url: string): Promise<string> {
  const QRCode = await import('qrcode')
  const svg = await QRCode.toString(url, {
    type: 'svg',
    margin: 2,
    // Highest correction level: this gets printed on paper, photocopied, and
    // photographed off a projector at an angle.
    errorCorrectionLevel: 'H',
    width: 512,
    // Pinned black on white rather than inheriting the theme. A QR code
    // rendered in the dark palette would be unscannable, and the printed
    // version has to be black on white regardless.
    color: { dark: '#000000', light: '#ffffff' },
  })
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

export function useQrDataUri(url: string): { dataUri: string | null; failed: boolean } {
  const [dataUri, setDataUri] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    renderQrSvg(url)
      .then((uri) => {
        if (!cancelled) setDataUri(uri)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [url])

  return { dataUri, failed }
}
