/**
 * Pure helpers for scripts/e2e-walkthrough.mjs — no I/O, no credentials logged.
 * Canonical module: imported by the walkthrough runtime and by Vitest.
 */

/**
 * @typedef {{
 *   templateId: string | null,
 *   importId: string | null,
 *   token: string | null,
 *   replacementToken?: string | null,
 * }} SessionArtifactSlot
 */

/**
 * @param {string} value
 * @returns {string}
 */
export function redactSecret(value) {
  if (typeof value !== 'string' || value.length < 12) return '[redacted]'
  return `${value.slice(0, 8)}…${value.slice(-4)}`
}

/**
 * @param {string} method
 * @param {string} url
 * @returns {boolean}
 */
export function isConfirmPostUrl(method, url) {
  return method === 'POST' && /\/imports\/[^/]+\/confirm(?:\?|$)/.test(url)
}

/**
 * @param {string} method
 * @param {string} url
 * @returns {boolean}
 */
export function isContextGetUrl(method, url) {
  return method === 'GET' && /\/imports\/[^/]+\/context(?:\?|$)/.test(url)
}

/**
 * @param {string} url
 * @returns {boolean}
 */
export function isForbiddenBrowserUrl(url) {
  return /\/imports\/[^/]+\/(valid-rows|results)(?:\/|\?|$)/.test(url)
}

/**
 * @param {{ panelVisible: boolean, successfulContextGetsAfterConfirm: number }} input
 * @returns {boolean}
 */
export function shouldReportProcessingFromConfirmCache(input) {
  return (
    input.panelVisible === true &&
    input.successfulContextGetsAfterConfirm === 0
  )
}

/**
 * @param {{
 *   hitsAtTerminal: number,
 *   hitsAfterWait: number,
 *   waitedMs: number,
 *   minWaitMs: number,
 * }} input
 * @returns {boolean}
 */
export function pollingStopped(input) {
  if (input.waitedMs < input.minWaitMs) return false
  return input.hitsAtTerminal === input.hitsAfterWait
}

/**
 * @param {{
 *   secrets: string[],
 *   consoleMessages: string[],
 *   iframeUrl: string | null | undefined,
 *   pageUrl: string,
 *   storage: { local?: Record<string, string>, session?: Record<string, string> },
 *   cookies: Array<{ name?: string, value?: string }>,
 * }} input
 * @returns {{ leaked: boolean, surfaces: string[] }}
 */
export function auditSecretsLeak(input) {
  const surfaces = []
  const secrets = input.secrets.filter(
    (secret) => typeof secret === 'string' && secret.length > 0,
  )

  const has = (haystack) =>
    secrets.some((secret) => String(haystack ?? '').includes(secret))

  if (input.consoleMessages.some((line) => has(line))) {
    surfaces.push('console')
  }
  if (has(input.iframeUrl)) {
    surfaces.push('iframeUrl')
  }
  if (has(input.pageUrl)) {
    surfaces.push('pageUrl')
  }
  if (has(JSON.stringify(input.storage.local ?? {}))) {
    surfaces.push('localStorage')
  }
  if (has(JSON.stringify(input.storage.session ?? {}))) {
    surfaces.push('sessionStorage')
  }
  if (
    (input.cookies ?? []).some(
      (cookie) => has(cookie?.value) || has(cookie?.name),
    )
  ) {
    surfaces.push('cookies')
  }

  return { leaked: surfaces.length > 0, surfaces }
}

/**
 * @returns {SessionArtifactSlot}
 */
export function createSessionArtifactSlot() {
  return {
    templateId: null,
    importId: null,
    token: null,
  }
}

/**
 * @param {SessionArtifactSlot} slot
 * @returns {SessionArtifactSlot}
 */
export function snapshotSessionArtifacts(slot) {
  /** @type {SessionArtifactSlot} */
  const snap = {
    templateId: slot.templateId,
    importId: slot.importId,
    token: slot.token,
  }
  if (Object.prototype.hasOwnProperty.call(slot, 'replacementToken')) {
    snap.replacementToken = slot.replacementToken ?? null
  }
  return snap
}

/**
 * @param {SessionArtifactSlot} slot
 * @param {string} templateId
 * @returns {SessionArtifactSlot}
 */
export function noteTemplateCreated(slot, templateId) {
  slot.templateId = templateId
  return slot
}

/**
 * @param {SessionArtifactSlot} slot
 * @param {string} importId
 * @returns {SessionArtifactSlot}
 */
export function noteImportSessionCreated(slot, importId) {
  slot.importId = importId
  return slot
}

/**
 * Stores only a redacted token. Never keeps the raw secret on the slot.
 * @param {SessionArtifactSlot} slot
 * @param {string} accessToken
 * @returns {SessionArtifactSlot}
 */
export function noteAccessTokenIssued(slot, accessToken) {
  slot.token = redactSecret(accessToken)
  return slot
}

/**
 * @param {SessionArtifactSlot} slot
 * @param {string} accessToken
 * @returns {SessionArtifactSlot}
 */
export function noteReplacementTokenIssued(slot, accessToken) {
  slot.replacementToken = redactSecret(accessToken)
  return slot
}
