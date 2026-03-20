// Browser-side telemetry helpers for Langfuse score submission.
// All calls are fire-and-forget -- failures are logged but never block the UI.

const SCORE_URL = '/api/score'

async function postScore(body: Record<string, unknown>): Promise<void> {
  try {
    await fetch(SCORE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    console.warn('[telemetry] score submission failed:', err)
  }
}

/** Submit a score tied to a Langfuse session. */
export function scoreSession(
  sessionId: string,
  name: string,
  value: number,
  comment?: string,
): void {
  postScore({ sessionId, name, value, comment })
}

/** Submit a score tied to a Langfuse trace. */
export function scoreTrace(
  traceId: string,
  name: string,
  value: number,
  dataType?: string,
): void {
  postScore({ traceId, name, value, dataType })
}
