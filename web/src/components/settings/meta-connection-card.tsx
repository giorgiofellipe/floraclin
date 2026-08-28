'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { toast } from 'sonner'
import { AlertTriangleIcon, ChevronDownIcon, ChevronUpIcon, Loader2Icon } from 'lucide-react'
import {
  useMetaConnection,
  useSaveMetaConnection,
  useDisconnectMeta,
  useTestMetaConnection,
  useMetaDatasets,
} from '@/hooks/queries/use-meta'

// Mirrors `ACKNOWLEDGEMENT_VERSION` in `web/src/lib/meta/oauth.ts`. Not
// imported directly: that module also imports `node:crypto` for the OAuth
// state signing, which cannot be bundled into a client component. Bump both
// together when the text below changes.
const ACKNOWLEDGEMENT_VERSION = '2026-08-v1'

const ACKNOWLEDGEMENT_TEXT =
  'A clínica é a controladora dos dados dos seus pacientes. Ao ativar esta integração, dados de contato (telefone e email) serão enviados de forma criptografada à Meta para medição de anúncios. A clínica é responsável pela base legal do tratamento perante seus pacientes.'

const EVENT_STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente',
  sent: 'Enviado',
  failed: 'Falhou',
  skipped: 'Ignorado',
}

function formatEventTime(value: string): string {
  return new Date(value).toLocaleString('pt-BR')
}

export function MetaConnectionCard() {
  const { data, isLoading } = useMetaConnection()
  const saveMutation = useSaveMetaConnection()
  const disconnectMutation = useDisconnectMeta()
  const testMutation = useTestMetaConnection()
  const datasetsMutation = useMetaDatasets()

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [datasetId, setDatasetId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [businessId, setBusinessId] = useState('')
  const [testEventCode, setTestEventCode] = useState('')

  const connection = data?.data ?? null
  const events = data?.events ?? []
  const isActive = connection?.status === 'active'

  async function handleConnect() {
    const params = new URLSearchParams({ acknowledgementVersion: ACKNOWLEDGEMENT_VERSION })
    // Solves the chicken-and-egg problem for a first-time OAuth connect:
    // `/auth/connect` requires a datasetId up front to embed in the signed
    // OAuth state, and cannot ask for one mid-redirect. Whatever the manual
    // section resolved (typed or picked) travels along.
    if (datasetId) params.set('datasetId', datasetId)
    window.location.href = `/api/integrations/meta/auth/connect?${params.toString()}`
  }

  async function handleSaveManual() {
    if (!datasetId || !accessToken) {
      toast.error('Informe o Dataset ID e o token de acesso.')
      return
    }
    try {
      await saveMutation.mutateAsync({
        datasetId,
        accessToken,
        testEventCode: testEventCode || null,
        acknowledgementVersion: ACKNOWLEDGEMENT_VERSION,
      })
      toast.success('Conexão com a Meta salva')
      setAccessToken('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao salvar conexão')
    }
  }

  async function handleFetchDatasets() {
    if (!businessId) {
      toast.error('Informe o Business ID.')
      return
    }
    try {
      const datasets = await datasetsMutation.mutateAsync({
        businessId,
        accessToken: accessToken || undefined,
      })
      if (datasets.length === 0) {
        toast.error('Nenhum dataset encontrado para este Business ID.')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao listar datasets')
    }
  }

  async function handleTest() {
    const result = await testMutation.mutateAsync()
    if (result.ok) {
      toast.success('Conexão testada com sucesso')
    } else {
      toast.error('Falha ao testar a conexão')
    }
  }

  async function handleDisconnect() {
    try {
      await disconnectMutation.mutateAsync()
      toast.success('Meta desconectado')
    } catch {
      toast.error('Erro ao desconectar')
    } finally {
      setConfirmOpen(false)
    }
  }

  async function handleToggleAdvancedMatching(checked: boolean) {
    if (!connection || connection.connectionType !== 'manual' || !accessToken) {
      toast.error('Para alterar, informe o token novamente na seção de conexão manual.')
      return
    }
    try {
      await saveMutation.mutateAsync({
        datasetId: connection.datasetId,
        accessToken,
        testEventCode: connection.testEventCode,
        advancedMatchingEnabled: checked,
        acknowledgementVersion: ACKNOWLEDGEMENT_VERSION,
      })
      toast.success(checked ? 'Correspondência avançada ativada' : 'Correspondência avançada desativada')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao atualizar configuração')
    }
  }

  if (isLoading) {
    return <div className="py-8 text-center text-sm text-mid">Carregando...</div>
  }

  return (
    <div className="space-y-6">
      {connection?.status === 'invalid_token' && (
        <div className="flex items-start gap-3 rounded-[3px] bg-amber-50 p-3">
          <AlertTriangleIcon className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-800">
            O token da Meta expirou ou foi revogado. Reconecte para retomar o envio de eventos.
            {connection.lastError ? ` Detalhe: ${connection.lastError}` : ''}
          </p>
        </div>
      )}

      {connection && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div
              className={`h-2 w-2 rounded-full ${isActive ? 'bg-green-500' : 'bg-amber-500'}`}
            />
            <span className="text-sm font-medium text-charcoal">
              {isActive ? 'Conectado' : `Status: ${connection.status}`}
            </span>
          </div>

          <div className="flex items-center gap-4 rounded-[3px] border border-[#E8ECEF] bg-white p-3">
            <Switch
              checked={connection.advancedMatchingEnabled}
              onCheckedChange={handleToggleAdvancedMatching}
            />
            <Label className="text-sm text-charcoal">Correspondência avançada</Label>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="w-full text-red-600 border-red-200 hover:bg-red-50"
            onClick={() => setConfirmOpen(true)}
          >
            Desconectar
          </Button>
        </div>
      )}

      {!isActive && (
        <div className="space-y-4 rounded-[3px] border border-[#E8ECEF] bg-white p-4">
          <div className="flex items-start gap-2">
            <Checkbox
              id="meta-acknowledgement"
              checked={acknowledged}
              onCheckedChange={(checked) => setAcknowledged(checked === true)}
              className="mt-0.5"
            />
            <Label htmlFor="meta-acknowledgement" className="text-sm text-charcoal font-normal">
              {ACKNOWLEDGEMENT_TEXT}
            </Label>
          </div>

          <Button
            onClick={handleConnect}
            disabled={!acknowledged}
            className="w-full bg-forest text-cream hover:bg-sage transition-colors"
          >
            Conectar Meta
          </Button>

          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setManualOpen((open) => !open)}
              className="flex w-full items-center justify-between text-sm font-medium text-charcoal"
            >
              Conectar manualmente
              {manualOpen ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
            </button>

            {manualOpen && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="meta-business-id" className="text-xs font-medium uppercase tracking-wider text-mid">
                    Business ID
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="meta-business-id"
                      value={businessId}
                      onChange={(e) => setBusinessId(e.target.value)}
                      placeholder="ID da conta business da Meta"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleFetchDatasets}
                      disabled={datasetsMutation.isPending}
                      className="shrink-0"
                    >
                      {datasetsMutation.isPending ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : 'Buscar datasets'}
                    </Button>
                  </div>
                </div>

                {datasetsMutation.data && datasetsMutation.data.length > 0 && (
                  <div className="space-y-1.5">
                    <Label htmlFor="meta-dataset-select" className="text-xs font-medium uppercase tracking-wider text-mid">
                      Dataset
                    </Label>
                    <select
                      id="meta-dataset-select"
                      className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-charcoal"
                      value={datasetId}
                      onChange={(e) => setDatasetId(e.target.value)}
                    >
                      <option value="">Selecione um dataset</option>
                      {datasetsMutation.data.map((dataset) => (
                        <option key={dataset.id} value={dataset.id}>
                          {dataset.name} ({dataset.id})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="meta-dataset-id" className="text-xs font-medium uppercase tracking-wider text-mid">
                    Dataset ID
                  </Label>
                  <Input
                    id="meta-dataset-id"
                    value={datasetId}
                    onChange={(e) => setDatasetId(e.target.value)}
                    placeholder="ID do dataset (pixel) da Meta"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="meta-access-token" className="text-xs font-medium uppercase tracking-wider text-mid">
                    Token de acesso
                  </Label>
                  <Input
                    id="meta-access-token"
                    type="password"
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                    placeholder="Token de acesso do sistema"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="meta-test-event-code" className="text-xs font-medium uppercase tracking-wider text-mid">
                    Código de evento de teste (opcional)
                  </Label>
                  <Input
                    id="meta-test-event-code"
                    value={testEventCode}
                    onChange={(e) => setTestEventCode(e.target.value)}
                    placeholder="TEST12345"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    onClick={handleSaveManual}
                    disabled={!acknowledged || saveMutation.isPending}
                    className="flex-1"
                  >
                    {saveMutation.isPending ? <Loader2Icon className="h-4 w-4 animate-spin" /> : 'Salvar conexão'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleTest}
                    disabled={testMutation.isPending}
                    className="flex-1"
                  >
                    {testMutation.isPending ? <Loader2Icon className="h-4 w-4 animate-spin" /> : 'Testar conexão'}
                  </Button>
                </div>

                {testMutation.data && (
                  <pre className="whitespace-pre-wrap break-all rounded-[3px] border border-[#E8ECEF] bg-cream p-3 text-xs text-charcoal">
                    {JSON.stringify(testMutation.data.body, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {connection && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-charcoal">Últimos eventos</h4>
          {events.length === 0 ? (
            <p className="text-sm text-mid">Nenhum evento enviado ainda.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Evento</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Trace ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell>{event.eventName}</TableCell>
                    <TableCell>
                      <span className="block">{EVENT_STATUS_LABELS[event.status] ?? event.status}</span>
                      {event.status === 'skipped' && event.skipReason && (
                        <span className="block text-xs text-mid">{event.skipReason}</span>
                      )}
                    </TableCell>
                    <TableCell>{formatEventTime(event.createdAt)}</TableCell>
                    <TableCell className="font-mono text-xs">{event.fbTraceId ?? '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Desconectar Meta</DialogTitle>
            <DialogDescription>
              Tem certeza? O envio de eventos de conversão para a Meta será interrompido.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button
              variant="destructive"
              onClick={handleDisconnect}
              disabled={disconnectMutation.isPending}
            >
              {disconnectMutation.isPending ? <Loader2Icon className="h-4 w-4 animate-spin" /> : 'Desconectar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
