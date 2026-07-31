// The organiser's shell: who is signed in, what events exist, and which of the
// three screens under /admin is on.
//
// Everything that draws is in ./admin. This file owns the two pieces of state
// they all need — the session and the event list — and the one way anything is
// written, so that "act, then refetch" exists once rather than per screen.

import { useCallback, useEffect, useState } from 'react'
import { api, type AdminEvent } from '../api'
import { Skeleton, SkeletonRows } from '../components/Skeleton'
import { Toasts, useToasts } from '../components/Toasts'
import { EventPicker } from '../components/EventPicker'
import { listedEvents } from '../adminEvents'
import { ADMIN_HOME, ADMIN_NEW, adminEventPath, adminRoute } from '../adminRoute'
import { dashboardStatus } from '../adminStatus'
import { STATUS_LABEL, messageFor } from '../messages'
import { navigate, usePathname } from '../router'
import { CreateEvent, type DemoDraft } from './admin/CreateEvent'
import { DashboardSkeleton, EventDashboard } from './admin/EventDashboard'
import { EventList } from './admin/EventList'
import { SignIn } from './admin/SignIn'

export function Admin() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [events, setEvents] = useState<AdminEvent[]>([])
  const [busy, setBusy] = useState(false)
  // Archived events stay out of the way until asked for. By the twentieth event
  // the list is mostly history, and the one being run today is the only one
  // anybody is looking for.
  const [showArchived, setShowArchived] = useState(false)

  const route = adminRoute(usePathname())
  const { toasts, push } = useToasts()

  const refreshState = useCallback(async () => {
    const result = await api.get<{ events: AdminEvent[] }>('/api/admin/state')
    if (!result.ok) {
      if (result.status === 401) setAuthed(false)
      return
    }
    setAuthed(true)
    setEvents(result.data.events)
  }, [])

  useEffect(() => {
    void refreshState()
  }, [refreshState])

  // The event list carries counts and a status per event and does not poll, so
  // coming back to this tab after running something in another one would show a
  // page of stale pills. One request, and only when the list is what is on
  // screen: the dashboard has its own two-second poll and does not need this.
  useEffect(() => {
    if (route.kind !== 'home' || !authed) return
    const refresh = () => {
      if (document.visibilityState === 'visible') void refreshState()
    }
    document.addEventListener('visibilitychange', refresh)
    return () => document.removeEventListener('visibilitychange', refresh)
  }, [route.kind, authed, refreshState])

  const selected = route.kind === 'event' ? events.find((row) => row.id === route.id) : undefined

  // An id that is not in the list once the list has arrived: a bookmark to an
  // event that has since been deleted from the database, or a typo. The events
  // are one click away and the address bar should agree with what is on screen,
  // so this corrects the URL rather than leaving an organiser on a path that no
  // longer means anything.
  //
  // Above the early returns below, with the rest of the hooks. It was under them
  // for one edit, which is a conditional hook call: the sign-in screen renders a
  // different number of hooks from the dashboard, and React counts.
  useEffect(() => {
    if (route.kind !== 'event' || selected || events.length === 0) return
    navigate(ADMIN_HOME)
  }, [route.kind, selected, events.length])

  async function login(submitted: React.FormEvent) {
    submitted.preventDefault()
    setBusy(true)
    setError(null)
    const result = await api.post('/api/admin/session', { password })
    setBusy(false)
    if (!result.ok) {
      setError(messageFor(result.error))
      return
    }
    setPassword('')
    await refreshState()
  }

  /**
   * Every write in the dashboard, and the refetch behind it.
   *
   * Returns null on failure, so a caller can tell "it worked and produced
   * nothing" from "it did not work" — CodesPanel needs the codes it generated,
   * and creating an event needs the id to navigate to.
   */
  async function act(path: string, body?: unknown) {
    setBusy(true)
    setError(null)
    const result = await api.post(path, body)
    setBusy(false)
    if (!result.ok) {
      setError(messageFor(result.error))
      return null
    }
    await refreshState()
    return result.data
  }

  if (authed === null) {
    return (
      <div className="shell shell--wide">
        <div className="stack" aria-busy="true">
          <span className="visually-hidden" role="status">
            Loading the dashboard
          </span>
          <Skeleton height="2.5rem" width="14rem" />
          <Skeleton height="9rem" radius="var(--radius-surface)" />
          <SkeletonRows rows={3} height="7rem" />
        </div>
      </div>
    )
  }

  if (!authed) {
    return (
      <SignIn
        busy={busy}
        error={error}
        password={password}
        onPassword={setPassword}
        onSubmit={login}
      />
    )
  }

  async function create(name: string, windowSeconds: number, demos: DemoDraft[]) {
    const created = await act('/api/admin/event', { name, windowSeconds, demos })
    if (created && typeof created === 'object' && 'eventId' in created) {
      // Straight into the event that was just set up. It is a draft with no
      // codes, so the next thing to do is on its dashboard.
      navigate(adminEventPath((created as { eventId: string }).eventId))
    }
  }

  return (
    <>
      <header className="appbar">
        <span className="appbar__mark">
          Demo<span>·</span>Vote
        </span>
        <span className="label appbar__role">Organiser</span>

        <span className="appbar__spacer" />

        {route.kind === 'event' ? (
          <>
            <a
              className="btn btn--ghost btn--sm"
              href={ADMIN_HOME}
              onClick={(clicked) => {
                if (clicked.metaKey || clicked.ctrlKey || clicked.shiftKey) return
                clicked.preventDefault()
                navigate(ADMIN_HOME)
              }}
            >
              ← All events
            </a>

            {/* Kept even though there is a list one click away. Two rooms can
                vote at once and an organiser working both wants to hop between
                them without going back out to the front page each time. */}
            {events.length > 1 ? (
              <EventPicker
                compact
                label="Event"
                value={route.id}
                options={listedEvents(events, showArchived).map((event) => ({
                  id: event.id,
                  label: `${event.name} · ${
                    event.archivedAt ? 'Archived' : STATUS_LABEL[dashboardStatus(event, event)]
                  }`,
                }))}
                onChange={(id) => navigate(adminEventPath(id))}
              />
            ) : null}
          </>
        ) : route.kind === 'home' && events.length > 0 ? (
          <button className="btn btn--sm" type="button" onClick={() => navigate(ADMIN_NEW)}>
            Create an event
          </button>
        ) : null}

        <button
          className="btn btn--ghost btn--sm"
          type="button"
          onClick={async () => {
            await api.del('/api/admin/session')
            setAuthed(false)
          }}
        >
          Sign out
        </button>
      </header>

      {route.kind === 'new' ? (
        <div className="shell shell--wide">
          {/* Cancel goes to the event list, which is the only place this form can
              be reached from now that New event has left the event bar. */}
          <CreateEvent busy={busy} onCreate={create} onDone={() => navigate(ADMIN_HOME)} />
        </div>
      ) : route.kind === 'event' ? (
        selected ? (
          <EventDashboard
            key={selected.id}
            event={selected}
            busy={busy}
            error={error}
            onToast={push}
            onStatus={(status) => act(`/api/admin/event/${selected.id}/status`, { status })}
            onGenerate={(count) => act(`/api/admin/event/${selected.id}/codes`, { count })}
          />
        ) : (
          <DashboardSkeleton />
        )
      ) : (
        <EventList
          events={events}
          busy={busy}
          showArchived={showArchived}
          onShowArchived={setShowArchived}
          onArchive={(event, archived) =>
            act(`/api/admin/event/${event.id}/archive`, { archived })
          }
          onNew={() => navigate(ADMIN_NEW)}
          onToast={push}
        />
      )}

      <Toasts toasts={toasts} />
    </>
  )
}
