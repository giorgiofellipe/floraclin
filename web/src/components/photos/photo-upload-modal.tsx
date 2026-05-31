'use client'

import { useEffect, useState } from 'react'
import { Upload, Camera } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { PhotoUploader } from '@/components/photos/photo-uploader'
import { CaptureContent } from '@/components/photos/capture-pose-guide'

interface PhotoUploadModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  patientId: string
  defaultTab?: 'upload' | 'capture'
  onComplete?: () => void
}

export function PhotoUploadModal({
  open,
  onOpenChange,
  patientId,
  defaultTab = 'upload',
  onComplete,
}: PhotoUploadModalProps) {
  const [activeTab, setActiveTab] = useState(defaultTab)

  useEffect(() => {
    if (open) setActiveTab(defaultTab)
  }, [open, defaultTab])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl sm:max-w-2xl max-h-[100dvh] p-0 overflow-hidden flex flex-col"
        showCloseButton={true}
      >
        <DialogHeader className="shrink-0 px-4 pt-4 pb-0">
          <DialogTitle>
            {activeTab === 'upload' ? 'Enviar Fotos' : 'Capturar'}
          </DialogTitle>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as 'upload' | 'capture')}
          className="flex flex-col min-h-0 flex-1"
        >
          <TabsList className="shrink-0 mx-4 mt-2 mb-0">
            <TabsTrigger value="capture" className="gap-1.5">
              <Camera className="size-3.5" />
              Capturar
            </TabsTrigger>
            <TabsTrigger value="upload" className="gap-1.5">
              <Upload className="size-3.5" />
              Enviar
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="flex-1 overflow-y-auto p-4">
            <PhotoUploader
              patientId={patientId}
              onUploadComplete={() => {
                onComplete?.()
              }}
            />
          </TabsContent>

          <TabsContent value="capture" className="flex flex-col min-h-0 flex-1">
            <CaptureContent
              active={open && activeTab === 'capture'}
              patientId={patientId}
              onCaptured={() => {
                onComplete?.()
              }}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
