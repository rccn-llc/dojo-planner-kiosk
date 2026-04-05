'use client';

import type { SignatureCanvasRef } from 'react-signature-canvas';
import { useCallback, useRef, useState } from 'react';
import SignatureCanvas from 'react-signature-canvas';

interface SignatureCaptureProps {
  label?: string;
  onSignatureChange: (dataUrl: string | null) => void;
}

export function SignatureCapture({ label = 'Signature', onSignatureChange }: SignatureCaptureProps) {
  const sigRef = useRef<SignatureCanvasRef | null>(null);
  const [hasSignature, setHasSignature] = useState(false);

  const handleEnd = useCallback(() => {
    if (sigRef.current && !sigRef.current.isEmpty()) {
      setHasSignature(true);
      onSignatureChange(sigRef.current.toDataURL('image/png'));
    }
  }, [onSignatureChange]);

  const handleClear = useCallback(() => {
    if (sigRef.current) {
      sigRef.current.clear();
    }
    setHasSignature(false);
    onSignatureChange(null);
  }, [onSignatureChange]);

  return (
    <div>
      <p className="mb-2 text-lg font-semibold text-black">{label}</p>
      <div className="rounded-2xl border-2 border-gray-300 bg-white p-1">
        <SignatureCanvas
          ref={sigRef}
          canvasProps={{
            className: 'w-full h-32 sm:h-40',
            style: { width: '100%', height: '160px' },
          }}
          penColor="black"
          backgroundColor="white"
          onEnd={handleEnd}
        />
      </div>
      <div className="mt-2 flex items-center justify-between">
        <p className="text-sm text-gray-400">
          {hasSignature ? 'Signature captured' : 'Sign above with your finger or stylus'}
        </p>
        {hasSignature && (
          <button
            type="button"
            onClick={handleClear}
            className="cursor-pointer text-sm font-semibold text-red-500 transition-colors hover:text-red-700"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
