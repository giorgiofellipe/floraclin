import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RevenueChart } from '../revenue-chart'

// ─── Mocks ─────────────────────────────────────────────────────────

// Mock recharts to avoid canvas/SVG rendering issues in test
vi.mock('recharts', () => ({
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: ({ dataKey }: { dataKey: string }) => <div data-testid={`bar-${dataKey}`} />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  Tooltip: () => <div />,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PieChart: ({ children }: { children: React.ReactNode }) => <div data-testid="pie-chart">{children}</div>,
  Pie: () => <div />,
  Cell: () => <div />,
  Legend: () => <div />,
}))

const mockRevenueData = {
  summary: {
    totalReceived: 50000,
    totalPending: 15000,
    totalOverdue: 3000,
    totalExpenses: 12000,
  },
  monthly: [
    { month: '2026-01', total: 8000, expenses: 2000 },
    { month: '2026-02', total: 12000, expenses: 3000 },
    { month: '2026-03', total: 15000, expenses: 4000 },
  ],
  byProcedureType: [
    { procedureTypeName: 'Botox', total: 30000 },
    { procedureTypeName: 'Preenchimento', total: 20000 },
  ],
  byPaymentMethod: [
    { paymentMethod: 'pix', total: 30000 },
    { paymentMethod: 'credit_card', total: 20000 },
  ],
}

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: mockRevenueData,
    isPending: false,
  }),
}))

vi.mock('@/hooks/queries/query-keys', () => ({
  queryKeys: {
    financial: {
      revenue: () => ['test'],
    },
  },
}))

// ─── Tests ─────────────────────────────────────────────────────────

describe('RevenueChart', () => {
  it('renders summary cards including net profit', () => {
    render(<RevenueChart />)

    expect(screen.getByText('Total Recebido')).toBeInTheDocument()
    expect(screen.getByText('Total Pendente')).toBeInTheDocument()
    expect(screen.getByText('Total Atrasado')).toBeInTheDocument()
    expect(screen.getByText('Lucro Líquido')).toBeInTheDocument()
  })

  it('shows net profit card with correct calculation', () => {
    render(<RevenueChart />)

    const netProfitCard = screen.getByTestId('net-profit-card')
    expect(netProfitCard).toBeInTheDocument()
    // Net profit = 50000 - 12000 = 38000
    expect(netProfitCard).toHaveTextContent('R$ 38.000,00')
  })

  it('renders stacked bar chart with revenue and expense bars', () => {
    render(<RevenueChart />)

    expect(screen.getByTestId('bar-chart')).toBeInTheDocument()
    expect(screen.getByTestId('bar-receitas')).toBeInTheDocument()
    expect(screen.getByTestId('bar-despesas')).toBeInTheDocument()
  })

  it('renders payment method donut chart', () => {
    render(<RevenueChart />)

    expect(screen.getByText('Receita por Método de Pagamento')).toBeInTheDocument()
  })

  it('renders chart title for revenue vs expenses', () => {
    render(<RevenueChart />)

    expect(screen.getByText('Receitas x Despesas Mensal')).toBeInTheDocument()
  })
})
