import type { OpenImportApiError } from '../../api/errors.ts'
import type { HostInitError } from '../../embed/use-host-session.ts'

export type ScreenCopy = {
  title: string
  body: string
  retry: boolean
  traceId?: string
  code?: string
}

export function copyForInitError(error: HostInitError): ScreenCopy {
  if (error.code === 'OPENIMPORT.LIVE_API_KEY_REJECTED') {
    return {
      title: 'Credencial inválida',
      body: 'Esta interface aceita somente o token temporário da importação. Reabra a sessão pelo sistema de origem.',
      retry: false,
      code: error.code,
    }
  }

  if (error.code === 'OPENIMPORT.INVALID_IMPORT_TOKEN') {
    return {
      title: 'Token inválido',
      body: 'O token recebido não está no formato esperado. Solicite um novo token temporário no sistema de origem.',
      retry: false,
      code: error.code,
    }
  }

  if (error.code === 'OPENIMPORT.IMPORT_ID_MISMATCH') {
    return {
      title: 'Sessão divergente',
      body: 'O identificador enviado pelo sistema de origem não corresponde a esta importação.',
      retry: false,
      code: error.code,
    }
  }

  if (error.code === 'OPENIMPORT.UNSUPPORTED_VERSION') {
    return {
      title: 'Protocolo incompatível',
      body: 'O sistema de origem enviou uma versão de inicialização que esta interface não reconhece.',
      retry: false,
      code: error.code,
    }
  }

  return {
    title: 'Inicialização inválida',
    body: 'A mensagem do sistema de origem foi recusada. Não foi feita nenhuma chamada à API.',
    retry: false,
    code: error.code,
  }
}

export function copyForApiError(error: OpenImportApiError): ScreenCopy {
  const base = { traceId: error.traceId, code: error.code }

  switch (error.code) {
    case 'AUTH.INVALID_IMPORT_TOKEN':
    case 'AUTH.MISSING_BEARER':
      return {
        ...base,
        title: 'Sessão expirada',
        body: 'A sessão expirou e precisa ser reaberta pelo sistema de origem.',
        retry: false,
      }
    case 'AUTH.INSUFFICIENT_SCOPE':
      return {
        ...base,
        title: 'Acesso negado',
        body: 'Esta credencial não tem permissão para acessar esta importação.',
        retry: false,
      }
    case 'IMPORT.NOT_FOUND':
      return {
        ...base,
        title: 'Importação indisponível',
        body: 'A importação está indisponível ou não foi encontrada.',
        retry: false,
      }
    case 'VALIDATION.FAILED':
      return {
        ...base,
        title: 'Dados inválidos',
        body: 'A requisição não passou na validação. Verifique o arquivo ou o mapping e tente novamente.',
        retry: false,
      }
    case 'IMPORT.FILE_ALREADY_UPLOADED':
      return {
        ...base,
        title: 'Arquivo já enviado',
        body: 'Esta sessão já possui um arquivo. O contexto será atualizado.',
        retry: false,
      }
    case 'IMPORT.UPLOAD_NOT_ALLOWED':
      return {
        ...base,
        title: 'Envio não permitido',
        body: 'Esta sessão não aceita novo arquivo. Reabra ou crie outra sessão pelo sistema de origem.',
        retry: false,
      }
    case 'IMPORT.FILE_TOO_LARGE':
      return {
        ...base,
        title: 'Arquivo grande demais',
        body: 'O arquivo excede o limite permitido. Reduza o tamanho e tente novamente nesta sessão, se ela ainda estiver aberta.',
        retry: false,
      }
    case 'IMPORT.INVALID_CSV':
      return {
        ...base,
        title: 'CSV inválido',
        body: 'O arquivo não pôde ser interpretado como CSV válido. Esta sessão pode ter sido encerrada; confirme o status antes de tentar de novo.',
        retry: false,
      }
    case 'IMPORT.MAPPING_NOT_ALLOWED':
      return {
        ...base,
        title: 'Mapping indisponível',
        body: 'O mapping só fica disponível depois de um envio bem-sucedido.',
        retry: false,
      }
    case 'IMPORT.MAPPING_REVISION_CONFLICT':
      return {
        ...base,
        title: 'Conflito de revisão',
        body: 'Outra alteração do mapping foi salva. Recarregamos a versão atual; revise e salve novamente se necessário.',
        retry: false,
      }
    case 'IMPORT.MAPPING_INVALID':
      return {
        ...base,
        title: 'Mapping inválido',
        body: 'O mapping enviado é inválido. Verifique colunas e campos sem duplicar associações.',
        retry: false,
      }
    case 'IMPORT.MAPPING_INCOMPLETE':
      return {
        ...base,
        title: 'Mapping incompleto',
        body: 'Associe todos os campos obrigatórios e salve antes de continuar.',
        retry: false,
      }
    case 'IMPORT.CONFIRMATION_NOT_ALLOWED':
      return {
        ...base,
        title: 'Confirmação indisponível',
        body: 'Esta sessão não aceita confirmação no estado atual. O contexto será atualizado.',
        retry: false,
      }
    case 'IMPORT.PROCESSING_UNAVAILABLE':
      return {
        ...base,
        title: 'Fila temporariamente indisponível',
        body: 'O processamento não pôde ser enfileirado agora. Você pode tentar confirmar novamente com segurança.',
        retry: true,
      }
    case 'IMPORT.PREVIEW_NOT_ALLOWED':
      return {
        ...base,
        title: 'Preview indisponível',
        body: 'O preview só pode ser executado com a sessão pronta e o mapping completo.',
        retry: false,
      }
    case 'IMPORT.FILE_CHANGED':
      return {
        ...base,
        title: 'Arquivo alterado',
        body: 'O conteúdo do arquivo mudou em relação ao mapping. Recarregue o contexto e revise as associações.',
        retry: false,
      }
    case 'IMPORT.PREVIEW_UNAVAILABLE':
      return {
        ...base,
        title: 'Preview temporariamente indisponível',
        body: 'O armazenamento ou o stream não respondeu. Tente novamente em instantes.',
        retry: true,
      }
    case 'OPENIMPORT.INCOMPATIBLE_RESPONSE':
      return {
        ...base,
        title: 'Resposta incompatível',
        body: 'A resposta do servidor é incompatível com esta versão da interface.',
        retry: false,
      }
    case 'OPENIMPORT.NETWORK_FAILURE':
      return {
        ...base,
        title: 'Falha de conexão',
        body: 'Não foi possível conectar ao OpenImport. Verifique a rede e tente novamente.',
        retry: true,
      }
    default:
      break
  }

  if (error.status === 401) {
    return {
      ...base,
      title: 'Sessão expirada',
      body: 'A sessão expirou e precisa ser reaberta pelo sistema de origem.',
      retry: false,
    }
  }

  if (error.status === 403) {
    return {
      ...base,
      title: 'Acesso negado',
      body: 'Esta credencial não tem permissão para acessar esta importação.',
      retry: false,
    }
  }

  if (error.status === 404) {
    return {
      ...base,
      title: 'Importação indisponível',
      body: 'A importação está indisponível ou não foi encontrada.',
      retry: false,
    }
  }

  if (error.status === 503 || error.status === 0) {
    return {
      ...base,
      title: 'Falha de conexão',
      body: 'Não foi possível concluir a operação. Verifique a rede e tente novamente.',
      retry: true,
    }
  }

  return {
    ...base,
    title: 'Não foi possível concluir',
    body: 'A operação falhou. Se o problema continuar, informe o código de rastreio ao suporte.',
    retry: false,
  }
}

export function sessionStatusLabel(
  status:
    | 'created'
    | 'uploaded'
    | 'upload_failed'
    | 'queued'
    | 'processing'
    | 'ready'
    | 'processing_failed',
) {
  if (status === 'created') return 'Sessão criada'
  if (status === 'uploaded') return 'Arquivo recebido'
  if (status === 'queued') return 'Na fila'
  if (status === 'processing') return 'Processando'
  if (status === 'ready') return 'Pronto'
  if (status === 'processing_failed') return 'Processamento falhou'
  return 'Envio falhou — sessão encerrada'
}

export const UPLOAD_FAILED_NOTICE = {
  title: 'Falha no envio',
  body: 'Esta sessão não aceita novo arquivo. O envio anterior falhou e a importação foi interrompida.',
  nextAction:
    'Reabra ou crie outra sessão pelo sistema de origem para tentar novamente com um novo arquivo.',
} as const

export const PROCESSING_FAILED_NOTICE = {
  title: 'Falha no processamento',
  body: 'O worker não concluiu esta importação. Não há retry automático nesta interface.',
  nextAction:
    'Crie uma nova sessão pelo sistema integrador ou fale com o suporte do produto cliente.',
} as const

export function abbreviateHash(hash: string) {
  if (hash.length <= 16) return hash
  return `${hash.slice(0, 8)}…${hash.slice(-8)}`
}

export function fieldTypeLabel(type: 'string' | 'integer' | 'currency') {
  if (type === 'string') return 'texto'
  if (type === 'integer') return 'inteiro'
  return 'moeda'
}
