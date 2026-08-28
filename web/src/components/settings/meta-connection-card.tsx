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
import { ACKNOWLEDGEMENT_TEXT, ACKNOWLEDGEMENT_VERSION } from '@/lib/meta/acknowledgement'
import { formatDateTime } from '@/lib/utils'

const EVENT_STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente',
  sent: 'Enviado',
  failed: 'Falhou',
  skipped: 'Ignorado',
}

const CONNECTION_STATUS_LABELS: Record<string, string> = {
  active: 'Conectado',
  invalid_token: 'Token expirado ou revogado',
  disabled: 'Desativado',
}

const SKIP_REASON_LABELS: Record<string, string> = {
  no_connection: 'Meta não conectada',
  no_external_id_secret: 'Chave de identificação não configurada',
  opted_out: 'Paciente optou por não compartilhar dados',
  marketing_opt_out: 'Paciente optou por não compartilhar dados',
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
  const [pendingAdvancedMatching, setPendingAdvancedMatching] = useState<boolean | null>(null)

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

  function handleToggleAdvancedMatching(checked: boolean) {
    setPendingAdvancedMatching(checked)
  }

  async function handleConfirmAdvancedMatching() {
    if (!connection || pendingAdvancedMatching === null) return
    try {
      // No accessToken: this keeps the stored credentials and the connection
      // type, so an OAuth clinic can change the setting without reconnecting.
      await saveMutation.mutateAsync({
        datasetId: connection.datasetId,
        testEventCode: connection.testEventCode,
        advancedMatchingEnabled: pendingAdvancedMatching,
        acknowledgementVersion: ACKNOWLEDGEMENT_VERSION,
      })
      toast.success(
        pendingAdvancedMatching ? 'Correspondência avançada ativada' : 'Correspondência avançada desativada',
      )
      setPendingAdvancedMatching(null)
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
              {CONNECTION_STATUS_LABELS[connection.status] ?? 'Status desconhecido'}
            </span>
          </div>

          <div className="flex items-center gap-4 rounded-[3px] border border-[#E8ECEF] bg-white p-3">
            <Switch
              checked={connection.advancedMatchingEnabled}
              onCheckedChange={handleToggleAdvancedMatching}
            />
            <Label className="text-sm text-charcoal">Correspondência avançada</Label>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={testMutation.isPending}
              className="flex-1"
            >
              {testMutation.isPending ? <Loader2Icon className="h-4 w-4 animate-spin" /> : 'Testar conexão'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-red-600 border-red-200 hover:bg-red-50"
              onClick={() => setConfirmOpen(true)}
            >
              Desconectar
            </Button>
          </div>

          {testMutation.data && (
            <pre className="whitespace-pre-wrap break-all rounded-[3px] border border-[#E8ECEF] bg-cream p-3 text-xs text-charcoal">
              {JSON.stringify(testMutation.data.body, null, 2)}
            </pre>
          )}
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

                <Button
                  type="button"
                  onClick={handleSaveManual}
                  disabled={!acknowledged || saveMutation.isPending}
                  className="w-full"
                >
                  {saveMutation.isPending ? <Loader2Icon className="h-4 w-4 animate-spin" /> : 'Salvar conexão'}
                </Button>
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
                        <span className="block text-xs text-mid">
                          {SKIP_REASON_LABELS[event.skipReason] ?? 'Motivo não identificado'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{formatDateTime(event.createdAt)}</TableCell>
                    <TableCell className="font-mono text-xs">{event.fbTraceId ?? '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      <Dialog
        open={pendingAdvancedMatching !== null}
        onOpenChange={(open) => {
          if (!open) setPendingAdvancedMatching(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingAdvancedMatching ? 'Ativar correspondência avançada' : 'Desativar correspondência avançada'}
            </DialogTitle>
            <DialogDescription>
              {pendingAdvancedMatching
                ? 'Os dados de contato do paciente voltam a ser enviados à Meta de forma criptografada.'
                : 'A Meta passa a receber apenas os identificadores de clique. A conexão continua ativa.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
            <Button onClick={handleConfirmAdvancedMatching} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? <Loader2Icon className="h-4 w-4 animate-spin" /> : 'Confirmar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
