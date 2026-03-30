import { useQuery } from '@tanstack/react-query'

export function useTenant() {
  return useQuery({
    queryKey: ['tenant'],
    queryFn: async () => {
      const res = await fetch('/api/tenant')
      if (!res.ok) throw new Error('Failed to fetch tenant')
      return res.json()
    },
  })
}

export function useTenantUsers() {
  return useQuery({
    queryKey: ['tenant', 'users'],
    queryFn: async () => {
      const res = await fetch('/api/tenant/users')
      if (!res.ok) throw new Error('Failed to fetch tenant users')
      return res.json()
    },
  })
}
