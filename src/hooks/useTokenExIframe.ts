'use client';

import type { TokenizationIframeConfig } from '../lib/iqpro';

import { useCallback, useEffect, useRef, useState } from 'react';

interface TokenExGlobal {
  Iframe: new (containerId: string, config: Record<string, unknown>) => TokenExIframeInstance;
}

interface TokenExIframeInstance {
  load: () => void;
  tokenize: () => void;
  remove: () => void;
  on: (event: string, callback: (...args: unknown[]) => void) => void;
}

interface UseTokenExIframeOptions {
  containerId: string;
  cvvContainerId?: string;
  config: TokenizationIframeConfig | null;
}

interface TokenizeResult {
  token: string;
  firstSix?: string;
  lastFour?: string;
}

interface UseTokenExIframeReturn {
  isLoaded: boolean;
  isValid: boolean;
  isCvvValid: boolean;
  error: string | null;
  tokenize: () => Promise<TokenizeResult>;
}

export function useTokenExIframe({ containerId, cvvContainerId, config }: UseTokenExIframeOptions): UseTokenExIframeReturn {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isValid, setIsValid] = useState(false);
  const [isCvvValid, setIsCvvValid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<TokenExIframeInstance | null>(null);
  const tokenizeResolveRef = useRef<((result: TokenizeResult) => void) | null>(null);
  const tokenizeRejectRef = useRef<((error: Error) => void) | null>(null);

  useEffect(() => {
    if (!config) {
      return;
    }

    let cancelled = false;
    let scriptEl: HTMLScriptElement | null = null;

    function getTokenEx(): TokenExGlobal | undefined {
      return (window as unknown as { TokenEx?: TokenExGlobal }).TokenEx;
    }

    async function init() {
      if (!getTokenEx()) {
        scriptEl = document.createElement('script');
        scriptEl.src = config!.iframeScriptUrl;
        scriptEl.async = true;

        await new Promise<void>((resolve, reject) => {
          scriptEl!.onload = () => resolve();
          scriptEl!.onerror = () => reject(new Error('Failed to load TokenEx script'));
          document.head.appendChild(scriptEl!);
        });
      }

      const tokenEx = getTokenEx();
      if (cancelled || !tokenEx) {
        return;
      }
      if (!document.getElementById(containerId)) {
        return;
      }

      const enableCvv = !!cvvContainerId;

      // Kiosk-adapted styles: large text, white bg, black text, no border (border is on container)
      const baseStyle = [
        'font-family: ui-sans-serif, system-ui, sans-serif',
        'font-size: 20px',
        'line-height: 28px',
        'padding: 14px 16px',
        'color: #000000',
        'background-color: #ffffff',
        'border: none',
        'outline: none',
        'width: 100%',
        'box-sizing: border-box',
      ].join('; ');

      const iframe = new tokenEx.Iframe(containerId, {
        origin: config!.origin || window.location.origin,
        authenticationKey: config!.authenticationKey,
        tokenExID: config!.tokenizationId,
        tokenScheme: config!.tokenScheme,
        timestamp: config!.timestamp,
        pci: true,
        enablePrettyFormat: true,
        enableValidateOnKeyUp: true,
        enableValidateOnCvvKeyUp: enableCvv,
        debug: process.env.NODE_ENV === 'development',
        inputType: 'text',
        placeholder: 'Card number',
        cvvContainerID: cvvContainerId || '',
        cvv: enableCvv,
        cvvInputType: 'text',
        cvvPlaceholder: 'CVV',
        styles: {
          base: baseStyle,
          focus: 'outline: none; border: none',
          error: 'color: hsl(0 84% 60%)',
          cvv: {
            base: baseStyle,
            focus: 'outline: none; border: none',
            error: 'color: hsl(0 84% 60%)',
          },
        },
      });

      iframeRef.current = iframe;

      iframe.on('load', () => {
        if (!cancelled) {
          setIsLoaded(true);
          setError(null);
        }
      });

      iframe.on('validate', (data: unknown) => {
        if (!cancelled) {
          const d = data as { isValid?: boolean; isCvvValid?: boolean };
          setIsValid(!!d.isValid);
          if (enableCvv) {
            setIsCvvValid(!!d.isCvvValid);
          }
        }
      });

      iframe.on('tokenize', (data: unknown) => {
        const d = data as Record<string, unknown>;
        const token = (d.token ?? d.Token) as string | undefined;
        const firstSix = (d.firstSix ?? d.FirstSix ?? d.firstsix ?? d.cardBin) as string | undefined;
        const lastFour = (d.lastFour ?? d.LastFour ?? d.lastfour ?? d.cardNumber) as string | undefined;
        if (token && tokenizeResolveRef.current) {
          tokenizeResolveRef.current({ token, firstSix: firstSix?.slice(0, 6), lastFour: lastFour?.slice(-4) });
          tokenizeResolveRef.current = null;
          tokenizeRejectRef.current = null;
        }
        else if (tokenizeResolveRef.current) {
          tokenizeRejectRef.current?.(new Error(`Tokenize event missing token. Keys: ${Object.keys(d).join(', ')}`));
          tokenizeResolveRef.current = null;
          tokenizeRejectRef.current = null;
        }
      });

      iframe.on('error', (data: unknown) => {
        const d = data as { message?: string };
        const msg = d.message || 'TokenEx iframe error';
        if (!cancelled) {
          setError(msg);
        }
        if (tokenizeRejectRef.current) {
          tokenizeRejectRef.current(new Error(msg));
          tokenizeResolveRef.current = null;
          tokenizeRejectRef.current = null;
        }
      });

      iframe.load();
    }

    init().catch((err: unknown) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : 'Failed to initialize payment field');
      }
    });

    return () => {
      cancelled = true;
      if (iframeRef.current) {
        iframeRef.current.remove();
        iframeRef.current = null;
      }
      if (scriptEl?.parentNode) {
        scriptEl.parentNode.removeChild(scriptEl);
      }
    };
  }, [containerId, cvvContainerId, config]);

  const tokenize = useCallback((): Promise<TokenizeResult> => {
    return new Promise((resolve, reject) => {
      if (!iframeRef.current) {
        reject(new Error('TokenEx iframe not initialized'));
        return;
      }

      const timeout = setTimeout(() => {
        if (tokenizeResolveRef.current) {
          tokenizeResolveRef.current = null;
          tokenizeRejectRef.current = null;
          reject(new Error('Tokenization timed out. Please try again.'));
        }
      }, 15_000);

      tokenizeResolveRef.current = (result: TokenizeResult) => {
        clearTimeout(timeout);
        resolve(result);
      };
      tokenizeRejectRef.current = (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      };

      iframeRef.current.tokenize();
    });
  }, []);

  return { isLoaded, isValid, isCvvValid, error, tokenize };
}
