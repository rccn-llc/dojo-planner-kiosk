declare module 'react-signature-canvas' {
  interface SignatureCanvasProps {
    canvasProps?: React.CanvasHTMLAttributes<HTMLCanvasElement>;
    clearOnResize?: boolean;
    dotSize?: number | (() => number);
    maxWidth?: number;
    minWidth?: number;
    penColor?: string;
    backgroundColor?: string;
    velocityFilterWeight?: number;
    onBegin?: () => void;
    onEnd?: () => void;
  }

  interface SignatureCanvasRef {
    clear: () => void;
    isEmpty: () => boolean;
    toDataURL: (type?: string, encoderOptions?: number) => string;
  }

  const SignatureCanvas: React.ForwardRefExoticComponent<
    SignatureCanvasProps & React.RefAttributes<SignatureCanvasRef>
  >;

  export type { SignatureCanvasRef };
  export default SignatureCanvas;
}
