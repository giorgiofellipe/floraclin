export default function PendingApprovalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-cream px-6">
      <div className="w-full max-w-md text-center">
        {children}
      </div>
    </div>
  )
}
