import { describe, expect, it } from 'vitest'
import {
  ADMIN_HOME,
  ADMIN_NEW,
  adminEventPath,
  adminPrintPath,
  adminRoute,
} from '../app/adminRoute'

/**
 * The organiser's own addresses.
 *
 * Worth a table because these paths are the one thing in the app an organiser
 * can bookmark, mistype, or arrive at from a link somebody sent them last month,
 * and because the print sheet and an event dashboard live one segment apart.
 */

describe('reading a path under /admin', () => {
  it('puts an organiser on the event list', () => {
    expect(adminRoute('/admin')).toEqual({ kind: 'home' })
  })

  it('reads an event id out of its own path', () => {
    expect(adminRoute('/admin/event/evt_abc')).toEqual({ kind: 'event', id: 'evt_abc' })
  })

  it('keeps the print sheet out of the event dashboard', () => {
    // These differ by one segment and the print sheet is the one that gets sent
    // to a printer, so a path that resolved to both would be a page of QR slips
    // where a dashboard should be, or worse.
    expect(adminRoute('/admin/print/evt_abc')).toEqual({ kind: 'print', id: 'evt_abc' })
  })

  it('reads the set-up form', () => {
    expect(adminRoute('/admin/new')).toEqual({ kind: 'new' })
  })

  it('does not read an event id out of a path that names something deeper', () => {
    // `/admin/event/x/y` names no screen here. Answering it with event `x` would
    // leave an organiser on a dashboard whose address bar disagrees with it,
    // which matters because that address is what they copy to come back.
    expect(adminRoute('/admin/event/evt_abc/extra')).toEqual({ kind: 'home' })
    expect(adminRoute('/admin/event/')).toEqual({ kind: 'home' })
    expect(adminRoute('/admin/event')).toEqual({ kind: 'home' })
  })

  it('falls to the event list rather than to an error', () => {
    // A mistyped or out-of-date bookmark should land on the events, which is one
    // click from anywhere the organiser might have meant. Includes the shape the
    // dashboard used to have, when the event was a query parameter and the path
    // was always plain /admin.
    expect(adminRoute('/admin/nonsense')).toEqual({ kind: 'home' })
    expect(adminRoute('/admin/event//evt_abc')).toEqual({ kind: 'home' })
  })

  it('ignores a trailing slash', () => {
    expect(adminRoute('/admin/')).toEqual({ kind: 'home' })
    expect(adminRoute('/admin/new/')).toEqual({ kind: 'new' })
    expect(adminRoute('/admin/event/evt_abc/')).toEqual({ kind: 'event', id: 'evt_abc' })
  })

  it('round-trips the paths it builds', () => {
    // The builders and the reader are used at opposite ends of a navigation, so
    // a disagreement between them is a link that goes to the wrong screen.
    expect(adminRoute(adminEventPath('evt_xyz'))).toEqual({ kind: 'event', id: 'evt_xyz' })
    expect(adminRoute(adminPrintPath('evt_xyz'))).toEqual({ kind: 'print', id: 'evt_xyz' })
    expect(adminRoute(ADMIN_NEW)).toEqual({ kind: 'new' })
    expect(adminRoute(ADMIN_HOME)).toEqual({ kind: 'home' })
  })
})
