export type LabCta =
  | { kind: 'lab'; href: '/dev'; label: 'Abrir laboratório' }
  | { kind: 'github'; href: string; label: 'Ver no GitHub' }
  | { kind: 'pipeline'; href: '#pipeline'; label: 'Como funciona' }

export function resolveLabCta(
  isDevelopment: boolean,
  repositoryUrl: string | null,
): LabCta {
  if (isDevelopment) {
    return {
      kind: 'lab',
      href: '/dev',
      label: 'Abrir laboratório',
    }
  }

  if (repositoryUrl) {
    return {
      kind: 'github',
      href: repositoryUrl,
      label: 'Ver no GitHub',
    }
  }

  return {
    kind: 'pipeline',
    href: '#pipeline',
    label: 'Como funciona',
  }
}
