import type { Metadata } from 'next'
import { MotionLab } from '@/components/motion-lab'

// Internal review page: kept out of search results and unlinked from the site.
export const metadata: Metadata = {
  title: 'Motion Lab | FloraClin',
  robots: { index: false, follow: false },
}

export default function MotionLabPage() {
  return <MotionLab />
}
