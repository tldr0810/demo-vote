// API error codes are stable identifiers; the wording lives here so it can be
// changed or translated without touching the Worker.
//
// Every message tells the person what to do next. "Invalid code" on its own
// leaves someone standing in a room holding a slip of paper with no idea
// whether to retype it or go and find a volunteer.

const MESSAGES: Record<string, string> = {
  INVALID_CODE:
    'That code was not recognised. Check the characters on your slip and try again, or ask a steward for a replacement.',
  CODE_ALREADY_USED: 'This code has already been used. Each code is good for one vote.',
  ALREADY_VOTED: 'You have already voted. One vote per person.',
  VOTING_NOT_OPEN: 'Voting has not opened yet. Wait for the organisers to announce it.',
  VOTING_CLOSED: 'Voting has closed.',
  EVENT_NOT_FOUND: 'No such event. Check the QR code or the web address.',
  NO_SESSION: 'Your session has expired. Enter your code again.',
  UNKNOWN_DEMO: 'That option is not part of this event. Refresh the page.',
  RATE_LIMITED: 'Too many attempts. Wait a minute and try again.',
  ADMIN_REQUIRED: 'Organiser access required.',
  BAD_PASSWORD: 'Incorrect password.',
  BAD_REQUEST: 'Something in that request was not valid. Check it and try again.',
  INVALID_TRANSITION: 'The event is not in a state that allows this.',
  NOT_CONFIGURED: 'This deployment is not finished being set up. Contact the organisers.',
  NETWORK: 'Could not reach the server. Check your connection and try again.',
  NOT_FOUND: 'Not found.',
}

export function messageFor(code: string): string {
  return MESSAGES[code] ?? 'Something went wrong unexpectedly. Refresh the page and try again.'
}

export const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  open: 'Voting open',
  closed: 'Closed',
  revealed: 'Revealed',
}
