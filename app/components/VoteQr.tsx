import { useQrDataUri } from './QrImage'

/**
 * The event's own QR code, rendered straight in the dashboard.
 *
 * This one carries no voting code: it is the sign for the wall and the running
 * order slide, the fallback for anyone whose personal slip failed, and it lands
 * them on the code entry screen. The per-attendee codes are on the print sheet.
 */
export function VoteQr({ url }: { url: string }) {
  const { dataUri, failed } = useQrDataUri(url)

  if (failed) return <p className="hint">Could not render the QR code. Use the URL above.</p>
  if (!dataUri) return <div className="qr qr--loading" aria-hidden="true" />

  return (
    <div className="qr-block">
      <img className="qr" src={dataUri} alt={`QR code linking to ${url}`} width={220} height={220} />
      <a className="btn btn--ghost btn--sm" href={dataUri} download="vote-qr.svg">
        Save SVG
      </a>
    </div>
  )
}
