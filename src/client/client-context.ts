import type { ClientContext, ISessions } from '@deepseek-ai/dsh-client-runtime/client'

/**
 * Browser Context face for a package that also compiles Host services.
 * Host and Client packages merge different `sessions` faces; this boundary
 * selects the public Client contract without weakening the other services.
 */
export type TenderClientContext = Omit<ClientContext, 'sessions'> & { readonly sessions: ISessions }

