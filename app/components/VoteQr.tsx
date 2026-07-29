import { useEffect, useState } from 'react'

/**
 * The QR code attendees scan, rendered straight in the dashboard.
 *
 * The encoder is loaded with a dynamic import so it lands in its own chunk.
 * Only the organiser ever opens /admin; making two hundred phones download a QR
 * library they will never run, over the same congested venue wifi they are
 * trying to vote on, would be a poor trade for one image.
 */
export function VoteQr({ url }: { url: string }) {
  const [dataUri, setDataUri] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function render() {
      try {
        const QRCode = await import('qrcode')
        const svg = await QRCode.toString(url, {
          type: 'svg',
          margin: 2,
          // Highest correction level: this gets printed on paper, photocopied,
          // and photographed off a projector at an angle.
          errorCorrectionLevel: 'H',
          width: 512,
          // Pinned black on white rather than inheriting the theme. A QR code
          // rendered in the dark palette would be unscannable, and the printed
          // version has to be black on white regardless.
          color: { dark: '#000000', light: '#ffffff' },
        })
        if (!cancelled) setDataUri(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`)
      } catch {
        // The URL is still shown as text above, so the organiser is not stuck.
        if (!cancelled) setFailed(true)
      }
    }

    void render()
    return () => {
      cancelled = true
    }
  }, [url])

  if (failed) return <p className="hint">Could not render the QR code. Use the URL above.</p>
  if (!dataUri) return <div className="qr qr--loading" aria-hidden="true" />

  return (
    <div className="qr-block">
      <img className="qr" src={dataUri} alt={`QR code linking to ${url}`} width={220} height={220} />
      <a className="btn btn--ghost btn--sm" href={dataUri} download="vote-qr.svg">
        Download SVG
      </a>
    </div>
  )
}
