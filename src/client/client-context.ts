import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'

/**
 * Browser Context face for a package that also compiles Host services.
 * Host and Client packages merge different `sessions` faces; this boundary
 * selects the public Client contract without weakening the other services.
 */
export type TenderClientContext = Omit<ClientContext, 'sessions'> & { readonly sessions: ISessions }
