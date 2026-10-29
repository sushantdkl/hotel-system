'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Loader } from 'lucide-react'
import { BrowserMultiFormatReader } from '@zxing/browser'

export default function BarcodeScanner({ onBarcodeDetected, onClose }) {
  const videoRef = useRef(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [detectedCode, setDetectedCode] = useState(null)
  const hasDetectedRef = useRef(false)
  const codeReaderRef = useRef(null)

  useEffect(() => {
    const startScanning = async () => {
      try {
        console.log('🔍 Starting product barcode scanner...')
        
        const codeReader = new BrowserMultiFormatReader()
        codeReaderRef.current = codeReader
        
        const videoInputDevices = await BrowserMultiFormatReader.listVideoInputDevices()
        
        console.log('📷 Found cameras:', videoInputDevices.length)
        
        if (videoInputDevices.length === 0) {
          setError('No camera found')
          setLoading(false)
          return
        }

        const selectedDevice = videoInputDevices.find(device => 
          device.label.toLowerCase().includes('back') || 
          device.label.toLowerCase().includes('rear') ||
          device.label.toLowerCase().includes('environment')
        ) || videoInputDevices[0]

        console.log('✅ Using camera:', selectedDevice.label)

        const controls = await codeReader.decodeFromVideoDevice(
          selectedDevice.deviceId,
          videoRef.current,
          (result, err) => {
            if (result && !hasDetectedRef.current) {
              const barcode = result.getText()
              console.log('🎯 PRODUCT BARCODE DETECTED:', barcode)
              hasDetectedRef.current = true
              setDetectedCode(barcode)
              onBarcodeDetected(barcode)
              
              setTimeout(() => {
                if (controls) {
                  controls.stop()
                }
                onClose()
              }, 1000)
            }
            
            if (err && !(err.name === 'NotFoundException')) {
              console.error('Barcode scanning error:', err)
            }
          }
        )
        
        setLoading(false)
        console.log('🎥 Product scanner started')
        
        codeReaderRef.current = controls
        
      } catch (err) {
        console.error('❌ Scanner error:', err)
        setError(err.message || 'Camera access denied')
        setLoading(false)
      }
    }

    if (!hasDetectedRef.current) {
      startScanning()
    }

    return () => {
      console.log('🛑 Cleaning up product scanner...')
      if (codeReaderRef.current && codeReaderRef.current.stop) {
        codeReaderRef.current.stop()
      }
    }
  }, [onBarcodeDetected, onClose])

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-background rounded-lg shadow-2xl overflow-hidden w-full max-w-2xl">
        <div className="bg-primary text-primary-foreground p-4 flex justify-between items-center">
          <h3 className="text-lg font-semibold">Scan Product Barcode</h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-primary-foreground/20 rounded transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="relative bg-black aspect-video overflow-hidden">
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            autoPlay
            playsInline
          />

          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <div className="text-center">
                <Loader className="text-white animate-spin mx-auto mb-2" size={40} />
                <p className="text-white text-sm">Starting camera...</p>
              </div>
            </div>
          )}

          <div className="absolute inset-0 flex items-center justify-center">
            <div className="border-4 border-green-500 w-48 h-32 rounded-lg animate-pulse" />
          </div>

          {detectedCode && (
            <div className="absolute bottom-4 left-4 right-4 bg-green-500 text-white p-3 rounded text-center font-semibold">
              ✓ Detected: {detectedCode}
            </div>
          )}
        </div>

        <div className="p-4 bg-muted text-center">
          {error ? (
            <p className="text-destructive font-semibold">{error}</p>
          ) : (
            <div className="space-y-2">
              <p className="font-semibold">Align barcode within the green box</p>
              <p className="text-sm text-muted-foreground">Hold steady • Good lighting • Clear barcode</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
