declare module 'speakeasy' {
  interface TOTPVerifyOptions {
    secret: string;
    encoding?: 'ascii' | 'hex' | 'base32' | 'base64';
    token: string;
    window?: number;
    time?: number;
    step?: number;
    counter?: number;
    digits?: number;
    algorithm?: 'sha1' | 'sha256' | 'sha512';
  }

  interface GenerateSecretOptions {
    length?: number;
    name?: string;
    issuer?: string;
    qr_codes?: boolean;
    google_auth_qr?: boolean;
    otpauth_url?: boolean;
    symbols?: boolean;
  }

  interface GeneratedSecret {
    ascii: string;
    hex: string;
    base32: string;
    otpauth_url?: string;
    qr_code_ascii?: string;
    qr_code_hex?: string;
    qr_code_base32?: string;
    google_auth_qr?: string;
  }

  const speakeasy: {
    generateSecret: (options?: GenerateSecretOptions) => GeneratedSecret;
    totp: {
      verify: (options: TOTPVerifyOptions) => boolean;
      generate: (options: { secret: string; encoding?: string; step?: number; time?: number }) => string;
    };
  };

  export default speakeasy;
}
