'use client'

import { useState, type ReactNode } from 'react'
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
  useMetaBusinesses,
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
  pending_dataset: 'Aguardando conjunto de dados',
  invalid_token: 'Token expirado ou revogado',
  disabled: 'Desativado',
}

const TRUNCATED_BUSINESSES_NOTICE =
  'A lista foi cortada porque a conta tem portfólios demais. Se o seu não aparecer, use a conexão manual.'

const TRUNCATED_DATASETS_NOTICE =
  'A lista foi cortada porque o portfólio tem conjuntos de dados demais. Se o seu não aparecer, informe o ID manualmente.'

const SKIP_REASON_LABELS: Record<string, string> = {
  no_connection: 'Meta não conectada',
  no_external_id_secret: 'Chave de identificação não configurada',
  opted_out: 'Paciente optou por não compartilhar dados',
}

// Rendered either for an active connection or inside the manual block, never
// both at once, so the input keeps a single id.
function TestEventCodeField({
  value,
  onChange,
  action,
}: {
  value: string
  onChange: (value: string) => void
  action?: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="meta-test-event-code" className="text-xs font-medium uppercase tracking-wider text-mid">
        Código de evento de teste (opcional)
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id="meta-test-event-code"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="TEST12345"
        />
        {action}
      </div>
      <p className="text-xs text-mid">
        O código aparece no Gerenciador de Eventos da Meta, na aba &quot;Testar eventos&quot;. Sem ele o evento de
        teste continua sendo enviado, ele apenas não aparece nessa janela.
      </p>
    </div>
  )
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
  // Null means the owner has not typed anything, so the stored code shows.
  const [testEventCodeDraft, setTestEventCodeDraft] = useState<string | null>(null)
  const [pendingAdvancedMatching, setPendingAdvancedMatching] = useState<boolean | null>(null)

  const connection = data?.data ?? null
  const events = data?.events ?? []
  const isActive = connection?.status === 'active'
  const isPendingDataset = connection?.status === 'pending_dataset'
  const businessesQuery = useMetaBusinesses(isPendingDataset)
  const testEventCode = testEventCodeDraft ?? connection?.testEventCode ?? ''

  async function handleConnect() {
    const params = new URLSearchParams({ acknowledgementVersion: ACKNOWLEDGEMENT_VERSION })
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
      if (datasets.items.length === 0) {
        toast.error('Nenhum dataset encontrado para este Business ID.')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao listar datasets')
    }
  }

  async function handleSelectBusiness(nextBusinessId: string) {
    setBusinessId(nextBusinessId)
    setDatasetId('')
    if (!nextBusinessId) return
    try {
      const datasets = await datasetsMutation.mutateAsync({ businessId: nextBusinessId })
      if (datasets.items.length === 0) {
        toast.error('Nenhum conjunto de dados encontrado neste portfólio.')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao listar conjuntos de dados')
    }
  }

  async function handleSaveDataset() {
    if (!datasetId) {
      toast.error('Selecione um conjunto de dados.')
      return
    }
    try {
      // No acknowledgementVersion: the owner accepted it before authorizing,
      // and the callback already recorded it.
      await saveMutation.mutateAsync({ datasetId })
      toast.success('Conjunto de dados salvo')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao salvar conjunto de dados')
    }
  }

  async function handleSaveTestEventCode() {
    if (!connection?.datasetId) return
    try {
      await saveMutation.mutateAsync({
        datasetId: connection.datasetId,
        testEventCode: testEventCode || null,
        acknowledgementVersion: ACKNOWLEDGEMENT_VERSION,
      })
      toast.success('Código de evento de teste salvo')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao salvar o código de evento de teste')
    }
  }

  async function handleTest() {
    try {
      const result = await testMutation.mutateAsync()
      if (result.ok) {
        toast.success('Conexão testada com sucesso')
      } else {
        toast.error(`Falha ao testar a conexão: ${result.message}`)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao testar a conexão')
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
    if (!connection?.datasetId || pendingAdvancedMatching === null) return
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

          {isPendingDataset ? (
            <div className="space-y-3 rounded-[3px] border border-[#E8ECEF] bg-white p-4">
              <p className="text-sm text-charcoal">Conexão autorizada. Escolha o conjunto de dados.</p>

              <div className="space-y-1.5">
                <Label
                  htmlFor="meta-pending-business-select"
                  className="text-xs font-medium uppercase tracking-wider text-mid"
                >
                  Portfólio empresarial
                </Label>
                <select
                  id="meta-pending-business-select"
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-charcoal"
                  value={businessId}
                  disabled={businessesQuery.isLoading}
                  onChange={(e) => handleSelectBusiness(e.target.value)}
                >
                  <option value="">
                    {businessesQuery.isLoading ? 'Carregando portfólios...' : 'Selecione um portfólio'}
                  </option>
                  {(businessesQuery.data?.items ?? []).map((business) => (
                    <option key={business.id} value={business.id}>
                      {business.name} ({business.id})
                    </option>
                  ))}
                </select>
                {businessesQuery.data?.truncated && (
                  <p className="text-xs text-amber-700">{TRUNCATED_BUSINESSES_NOTICE}</p>
                )}
                {businessesQuery.isError && (
                  <p className="text-xs text-red-600">
                    {businessesQuery.error instanceof Error
                      ? businessesQuery.error.message
                      : 'Erro ao listar portfólios'}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="meta-pending-dataset-select"
                  className="text-xs font-medium uppercase tracking-wider text-mid"
                >
                  Conjunto de dados
                </Label>
                <select
                  id="meta-pending-dataset-select"
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-charcoal"
                  value={datasetId}
                  disabled={!businessId || datasetsMutation.isPending}
                  onChange={(e) => setDatasetId(e.target.value)}
                >
                  <option value="">
                    {datasetsMutation.isPending
                      ? 'Carregando conjuntos de dados...'
                      : 'Selecione um conjunto de dados'}
                  </option>
                  {(datasetsMutation.data?.items ?? []).map((dataset) => (
                    <option key={dataset.id} value={dataset.id}>
                      {dataset.name} ({dataset.id})
                    </option>
                  ))}
                </select>
                {datasetsMutation.data?.truncated && (
                  <p className="text-xs text-amber-700">{TRUNCATED_DATASETS_NOTICE}</p>
                )}
              </div>

              <Button
                type="button"
                onClick={handleSaveDataset}
                disabled={!datasetId || saveMutation.isPending}
                className="w-full bg-forest text-cream hover:bg-sage transition-colors"
              >
                {saveMutation.isPending ? (
                  <Loader2Icon className="h-4 w-4 animate-spin" />
                ) : (
                  'Salvar conjunto de dados'
                )}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-4 rounded-[3px] border border-[#E8ECEF] bg-white p-3">
              <Switch
                checked={connection.advancedMatchingEnabled}
                onCheckedChange={handleToggleAdvancedMatching}
              />
              <Label className="text-sm text-charcoal">Correspondência avançada</Label>
            </div>
          )}

          {isActive && (
            <TestEventCodeField
              value={testEventCode}
              onChange={setTestEventCodeDraft}
              action={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleSaveTestEventCode}
                  disabled={saveMutation.isPending}
                  className="shrink-0"
                >
                  {saveMutation.isPending ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : 'Salvar código'}
                </Button>
              }
            />
          )}

          <div className="flex items-center gap-2">
            {!isPendingDataset && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleTest}
                disabled={testMutation.isPending}
                className="flex-1"
              >
                {testMutation.isPending ? <Loader2Icon className="h-4 w-4 animate-spin" /> : 'Testar conexão'}
              </Button>
            )}
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
            <div className="space-y-1 rounded-[3px] border border-[#E8ECEF] bg-cream p-3 text-xs">
              {testMutation.data.ok ? (
                <p className="text-charcoal">A Meta recebeu o evento de teste.</p>
              ) : (
                <>
                  <p className="font-medium text-red-600">
                    {testMutation.data.errorUserTitle ?? 'A Meta recusou o evento de teste.'}
                  </p>
                  <p className="text-charcoal">{testMutation.data.message}</p>
                </>
              )}
              {testMutation.data.fbTraceId && (
                <p className="font-mono text-mid">Trace ID: {testMutation.data.fbTraceId}</p>
              )}
            </div>
          )}
        </div>
      )}

      {!isActive && !isPendingDataset && (
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

                {datasetsMutation.data && datasetsMutation.data.items.length > 0 && (
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
                      {datasetsMutation.data.items.map((dataset) => (
                        <option key={dataset.id} value={dataset.id}>
                          {dataset.name} ({dataset.id})
                        </option>
                      ))}
                    </select>
                    {datasetsMutation.data.truncated && (
                      <p className="text-xs text-amber-700">{TRUNCATED_DATASETS_NOTICE}</p>
                    )}
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

                <TestEventCodeField value={testEventCode} onChange={setTestEventCodeDraft} />

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
