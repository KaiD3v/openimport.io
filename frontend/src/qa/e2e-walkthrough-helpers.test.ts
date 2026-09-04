import { describe, expect, it } from 'vitest'
import {
  auditSecretsLeak,
  createSessionArtifactSlot,
  isConfirmPostUrl,
  isContextGetUrl,
  isForbiddenBrowserUrl,
  noteImportSessionCreated,
  noteReplacementTokenIssued,
  noteTemplateCreated,
  noteAccessTokenIssued,
  pollingStopped,
  redactSecret,
  shouldReportProcessingFromConfirmCache,
  snapshotSessionArtifacts,
} from '../../scripts/e2e-walkthrough-helpers.mjs'

describe('e2e walkthrough helpers (runtime module)', () => {
  it('imports the same helpers module used by the walkthrough script', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const walkthroughSource = readFileSync(
      resolve('scripts/e2e-walkthrough.mjs'),
      'utf8',
    )
    expect(walkthroughSource).toContain(
      "from './e2e-walkthrough-helpers.mjs'",
    )
    expect(walkthroughSource).not.toMatch(/keep in sync/i)
  })

  it('redacts secrets without emitting the full value', () => {
    const secret = `oi_import_${'ab'.repeat(32)}`
    const redacted = redactSecret(secret)
    expect(redacted).not.toContain(secret)
    expect(redacted.startsWith('oi_impor')).toBe(true)
    expect(redacted.includes('…')).toBe(true)
  })

  it('detects confirm POST and context GET paths', () => {
    expect(
      isConfirmPostUrl(
        'POST',
        'http://localhost:3000/api/v1/imports/x/confirm',
      ),
    ).toBe(true)
    expect(
      isConfirmPostUrl(
        'GET',
        'http://localhost:3000/api/v1/imports/x/confirm',
      ),
    ).toBe(false)
    expect(
      isContextGetUrl(
        'GET',
        'http://localhost:3000/api/v1/imports/x/context',
      ),
    ).toBe(true)
  })

  it('flags API-key-only browser endpoints', () => {
    expect(
      isForbiddenBrowserUrl(
        'http://localhost:3000/api/v1/imports/x/valid-rows',
      ),
    ).toBe(true)
    expect(
      isForbiddenBrowserUrl(
        'http://localhost:3000/api/v1/imports/x/results',
      ),
    ).toBe(true)
    expect(
      isForbiddenBrowserUrl(
        'http://localhost:3000/api/v1/imports/x/rejected-rows',
      ),
    ).toBe(false)
  })

  it('requires processing panel before any successful context refetch', () => {
    expect(
      shouldReportProcessingFromConfirmCache({
        panelVisible: true,
        successfulContextGetsAfterConfirm: 0,
      }),
    ).toBe(true)
    expect(
      shouldReportProcessingFromConfirmCache({
        panelVisible: true,
        successfulContextGetsAfterConfirm: 1,
      }),
    ).toBe(false)
    expect(
      shouldReportProcessingFromConfirmCache({
        panelVisible: false,
        successfulContextGetsAfterConfirm: 0,
      }),
    ).toBe(false)
  })

  it('treats unchanged GET counts after a long wait as stopped polling', () => {
    expect(
      pollingStopped({
        hitsAtTerminal: 2,
        hitsAfterWait: 2,
        waitedMs: 2500,
        minWaitMs: 2000,
      }),
    ).toBe(true)
    expect(
      pollingStopped({
        hitsAtTerminal: 2,
        hitsAfterWait: 3,
        waitedMs: 2500,
        minWaitMs: 2000,
      }),
    ).toBe(false)
    expect(
      pollingStopped({
        hitsAtTerminal: 2,
        hitsAfterWait: 2,
        waitedMs: 400,
        minWaitMs: 2000,
      }),
    ).toBe(false)
  })

  it('audits every provided secret across page surfaces', () => {
    const secrets = ['oi_import_aaa', 'oi_import_bbb', 'oi_live_ccc']
    expect(
      auditSecretsLeak({
        secrets,
        consoleMessages: ['ok'],
        iframeUrl: '/imports/uuid',
        pageUrl: 'http://localhost:5173/dev',
        storage: { local: {}, session: {} },
        cookies: [],
      }),
    ).toEqual({ leaked: false, surfaces: [] })

    const hit = auditSecretsLeak({
      secrets,
      consoleMessages: ['token oi_import_bbb used'],
      iframeUrl: '/imports/uuid',
      pageUrl: 'http://localhost:5173/dev?x=oi_live_ccc',
      storage: { local: { k: 'oi_import_aaa' }, session: {} },
      cookies: [{ name: 'c', value: 'safe' }],
    })
    expect(hit.leaked).toBe(true)
    expect(hit.surfaces).toEqual(
      expect.arrayContaining(['console', 'pageUrl', 'localStorage']),
    )
  })

  it('records only templateId after template creation', () => {
    const slot = createSessionArtifactSlot()
    noteTemplateCreated(slot, 'tmpl-1')
    expect(snapshotSessionArtifacts(slot)).toEqual({
      templateId: 'tmpl-1',
      importId: null,
      token: null,
    })
  })

  it('records templateId and importId after session creation', () => {
    const slot = createSessionArtifactSlot()
    noteTemplateCreated(slot, 'tmpl-2')
    noteImportSessionCreated(slot, 'imp-2')
    expect(snapshotSessionArtifacts(slot)).toEqual({
      templateId: 'tmpl-2',
      importId: 'imp-2',
      token: null,
    })
  })

  it('records redacted token after issuance without storing the raw secret', () => {
    const slot = createSessionArtifactSlot()
    const raw = `oi_import_${'cd'.repeat(32)}`
    noteTemplateCreated(slot, 'tmpl-3')
    noteImportSessionCreated(slot, 'imp-3')
    noteAccessTokenIssued(slot, raw)
    const snap = snapshotSessionArtifacts(slot)
    expect(snap).toEqual({
      templateId: 'tmpl-3',
      importId: 'imp-3',
      token: redactSecret(raw),
    })
    expect(JSON.stringify(snap)).not.toContain(raw)
    expect(JSON.stringify(slot)).not.toContain(raw)
  })

  it('can attach a redacted replacement token on the auth-probe slot', () => {
    const slot = createSessionArtifactSlot()
    noteTemplateCreated(slot, 'tmpl-4')
    noteImportSessionCreated(slot, 'imp-4')
    noteAccessTokenIssued(slot, `oi_import_${'ee'.repeat(32)}`)
    const replacement = `oi_import_${'ff'.repeat(32)}`
    noteReplacementTokenIssued(slot, replacement)
    const snap = snapshotSessionArtifacts(slot)
    expect(snap.replacementToken).toBe(redactSecret(replacement))
    expect(JSON.stringify(snap)).not.toContain(replacement)
  })
})
