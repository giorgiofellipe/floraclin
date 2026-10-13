import type { FormListResponse, FormQuestion } from '@/lib/forms/types'

export function ListAnswerTable({
  question,
  rows,
  className,
}: {
  question: FormQuestion
  rows: FormListResponse
  className?: string
}) {
  const columns = question.columns ?? []
  return (
    <table className={className}>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.id}>{column.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {columns.map((column) => (
              <td key={column.id}>{row[column.id] ?? ''}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
